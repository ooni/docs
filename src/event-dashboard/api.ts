import { fetchCtrlGroundTruth } from "../measurement-viewer/api";
import type {
  CtrlGroundTruthEntry,
  MeasurementAnalysis,
  WebObservation,
} from "../measurement-viewer/types";
import type {
  ChangepointParams,
  ChangepointResponse,
  Country,
  DomainEntry,
  FastpathRow,
  ObservationAggRow,
  RuleCountsResponse,
} from "./types";

const join = (base: string, path: string): string =>
  base.replace(/\/$/, "") + path;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

// The OONI API rate limits bursts (an hour of observations is dozens of
// calls), so a 429 waits — Retry-After when given, else backing off — and
// tries again a few times before giving up
async function getJSON<T>(fullUrl: string, signal?: AbortSignal): Promise<T> {
  let r = await fetch(fullUrl, { signal });
  for (let attempt = 1; r.status === 429 && attempt <= 4; attempt++) {
    const retryAfter = Number(r.headers.get("retry-after"));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt, signal);
    r = await fetch(fullUrl, { signal });
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    // FastAPI validation errors carry a list of {msg, loc} under detail
    const detail = Array.isArray(body?.detail)
      ? body.detail.map((d: { msg: string }) => d.msg).join("; ")
      : body?.detail ?? body?.msg;
    throw new Error(detail || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

// Same endpoints OONI Explorer uses for its country and domain listings
export async function fetchCountries(ooniApi: string): Promise<Country[]> {
  const data = await getJSON<{ countries: Country[] }>(
    join(ooniApi, "/api/_/countries")
  );
  return data.countries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchDomains(ooniApi: string): Promise<DomainEntry[]> {
  const data = await getJSON<{ results: DomainEntry[] }>(
    join(ooniApi, "/api/_/domains")
  );
  // A domain is listed once per category it belongs to; keep the first
  const seen = new Set<string>();
  return data.results.filter((d) => {
    if (seen.has(d.domain_name)) return false;
    seen.add(d.domain_name);
    return true;
  });
}

// asn -> org name, for labelling the network grid. The listing is global
// (~2MB), so it is fetched once and in the background.
export async function fetchNetworkNames(
  ooniApi: string
): Promise<Map<number, string>> {
  const data = await getJSON<{
    results: { probe_asn: number; org_name: string }[];
  }>(join(ooniApi, "/api/_/networks"));
  const names = new Map<number, string>();
  for (const n of data.results) {
    if (n.org_name) names.set(n.probe_asn, n.org_name);
  }
  return names;
}

export async function fetchChangepoints(
  changepointApi: string,
  p: ChangepointParams,
  signal?: AbortSignal
): Promise<ChangepointResponse> {
  const q = new URLSearchParams({
    probe_cc: p.probe_cc,
    domain: p.domain,
    start_date: p.start_date,
    end_date: p.end_date,
  });
  return getJSON<ChangepointResponse>(
    join(changepointApi, "/changepoints?" + q),
    signal
  );
}

// ------------------------------------------------------------ inspector
// Everything below serves the per-network inspector: one (probe_asn,
// resolver_asn) pair of one domain, hour by hour.

export interface PairScope {
  probeCc: string;
  probeAsn: number;
  resolverAsn: number;
  domain: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD, inclusive
}

const nextDay = (d: string): string =>
  new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);

// The rules that scored each measurement, per hour and layer. Resolver
// specific: this is the evidence the changepoint detector itself consumed.
export async function fetchRuleCounts(
  changepointApi: string,
  p: PairScope,
  signal?: AbortSignal
): Promise<RuleCountsResponse> {
  const q = new URLSearchParams({
    probe_cc: p.probeCc,
    probe_asn: String(p.probeAsn),
    resolver_asn: String(p.resolverAsn),
    domain: p.domain,
    start_date: p.startDate,
    end_date: p.endDate,
  });
  return getJSON(join(changepointApi, "/rule_counts?" + q), signal);
}

// Fastpath anomaly counts per hour. The fastpath knows nothing about
// resolvers, so these cover the whole probe network. Hourly grain is only
// served for ranges of up to 7 days, so the window is fetched in chunks.
export async function fetchFastpathHourly(
  ooniApi: string,
  p: PairScope,
  signal?: AbortSignal
): Promise<FastpathRow[]> {
  const chunks: [string, string][] = [];
  const end = nextDay(p.endDate);
  for (let since = p.startDate; since < end; ) {
    const until = new Date(Date.parse(since + "T00:00:00Z") + 7 * 864e5)
      .toISOString()
      .slice(0, 10);
    chunks.push([since, until < end ? until : end]);
    since = until;
  }
  const parts = await Promise.all(
    chunks.map(([since, until]) => {
      const q = new URLSearchParams({
        axis_x: "measurement_start_day",
        time_grain: "hour",
        probe_cc: p.probeCc,
        probe_asn: `AS${p.probeAsn}`,
        domain: p.domain,
        since,
        until,
      });
      return getJSON<{ result: FastpathRow[] }>(
        join(ooniApi, "/api/v1/aggregation?" + q),
        signal
      );
    })
  );
  return parts.flatMap((d) => d.result);
}

const obsScope = (p: PairScope, since: string, until: string) => {
  const q = new URLSearchParams({ since, until, time_grain: "hour" });
  q.append("probe_cc", p.probeCc);
  q.append("probe_asn", String(p.probeAsn));
  q.append("resolver_asn", String(p.resolverAsn));
  q.append("hostname", p.domain);
  return q;
};

// Observation counts per hour, failure string and measurement, for this
// resolver only. The measurement_uid grouping is what later lets an hour's
// observations be fetched without asking which measurements it holds.
export async function fetchObservationsHourly(
  ooniApi: string,
  p: PairScope,
  signal?: AbortSignal
): Promise<ObservationAggRow[]> {
  const q = obsScope(p, p.startDate + "T00:00:00", nextDay(p.endDate) + "T00:00:00");
  q.append("group_by", "timestamp");
  q.append("group_by", "failure");
  q.append("group_by", "measurement_uid");
  const data = await getJSON<{ results: ObservationAggRow[] }>(
    join(ooniApi, "/api/v1/aggregation/observations?" + q),
    signal
  );
  return data.results;
}

export interface HourMeasurement {
  measurement_uid: string;
  measurement_start_time: string;
  test_name: string;
}

export interface HourObservations {
  measurements: HourMeasurement[];
  observations: WebObservation[];
  // control ground truth for the domain around the hour, as the measurement
  // viewer pulls it for one measurement
  ctrl: CtrlGroundTruthEntry[];
  // measurement_uid -> analysis; null when not computed (yet)
  analysis: Record<string, MeasurementAnalysis | null>;
  // measurements in the hour beyond the requested limit, not fetched
  skipped: number;
}

// Each measurement costs one observation listing, so an hour loads this many
// first
export const HOUR_MEASUREMENTS_STEP = 10;

export interface HourProgress {
  done: number;
  total: number;
}

// Runs fn over items with at most `limit` calls in flight
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Every observation of the measurements of one hour.
 *
 * The hour's measurement_uids come from the hourly observation aggregation.
 * Everything else is fetched by hour or by uid, always together with
 * probe_cc, probe_asn and a time range, so each query stays on the tables'
 * sort keys (obs_web is ordered by start time, country, network, uid) — never
 * by report_id, which is not indexed:
 *
 * - /v1/analysis for the hour: the analysis rows, in one call
 * - /v1/observations per measurement_uid, within the hour's day
 * - the control ground truth for the hostnames those observations touched
 */
export async function fetchHourObservations(
  ooniApi: string,
  p: PairScope,
  hourMs: number,
  allUids: string[],
  maxMeasurements: number,
  onProgress: (p: HourProgress) => void,
  signal?: AbortSignal
): Promise<HourObservations> {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
  const uids = [...allUids].sort().slice(0, maxMeasurements);
  const wanted = new Set(uids);
  const since = iso(hourMs);
  const until = iso(hourMs + 3600e3);
  const day = since.slice(0, 10);

  // analysis + one observation listing per uid + control
  const total = uids.length + 2;
  let done = 0;
  const tick = () => onProgress({ done: ++done, total });
  onProgress({ done, total });

  // The analysis list cannot filter on domain, so the hour of the whole
  // network is paged through and kept to the wanted uids
  const analysisP = (async () => {
    const out: Record<string, MeasurementAnalysis | null> = {};
    const limit = 1000;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({
        probe_cc: p.probeCc,
        probe_asn: String(p.probeAsn),
        since,
        until,
        limit: String(limit),
        offset: String(page * limit),
      });
      const data = await getJSON<{ results: MeasurementAnalysis[] }>(
        join(ooniApi, "/api/v1/analysis?" + q),
        signal
      ).catch(() => ({ results: [] as MeasurementAnalysis[] }));
      for (const a of data.results) {
        if (wanted.has(a.measurement_uid) && !out[a.measurement_uid]) out[a.measurement_uid] = a;
      }
      if (data.results.length < limit) break;
    }
    tick();
    return out;
  })();

  const perUid = await pool(uids, 4, async (uid) => {
    const q = new URLSearchParams({
      measurement_uid: uid,
      probe_cc: p.probeCc,
      probe_asn: String(p.probeAsn),
      since: day,
      until: nextDay(day),
      limit: "1000",
    });
    const data = await getJSON<{ results: WebObservation[] }>(
      join(ooniApi, "/api/v1/observations?" + q),
      signal
    );
    tick();
    return data.results.filter((o) => o.measurement_uid === uid);
  });
  const observations = perUid.flat();

  // Control for every hostname the measurements touched (redirects included),
  // one hour either side. Missing control only hides the comparison.
  const hostnames = [
    ...new Set([p.domain, ...observations.map((o) => o.hostname).filter((h): h is string => !!h)]),
  ];
  const ctrl = await fetchCtrlGroundTruth(ooniApi, hostnames, iso(hourMs - 3600e3), iso(hourMs + 2 * 3600e3))
    .catch(() => [] as CtrlGroundTruthEntry[])
    .finally(tick);

  const analysis = await analysisP;
  // One entry per measurement, from its own observations: the fastpath
  // verdict is read off the hourly aggregation instead of per measurement
  const measurements: HourMeasurement[] = uids.flatMap((uid) => {
    const o = observations.find((x) => x.measurement_uid === uid);
    return o
      ? [{ measurement_uid: uid, measurement_start_time: o.measurement_start_time, test_name: o.test_name }]
      : [];
  });
  return {
    measurements: measurements.sort((a, b) =>
      a.measurement_start_time.localeCompare(b.measurement_start_time)
    ),
    observations,
    ctrl,
    analysis,
    skipped: allUids.length - uids.length,
  };
}
