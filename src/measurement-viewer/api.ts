import type {
  AggregationEntry,
  CtrlGroundTruthEntry,
  MeasurementAnalysis,
  MeasurementMeta,
  WebObservation,
} from "./types";

// apiBase "" means same-origin; in dev the astro server proxies /api to a
// locally running oonimeasurements instance (see astro.config.mjs).
const url = (apiBase: string, path: string): string =>
  apiBase.replace(/\/$/, "") + "/api" + path;

async function getJSON<T>(fullUrl: string): Promise<T> {
  const r = await fetch(fullUrl);
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

export async function fetchMeasurementMeta(
  apiBase: string,
  measurementUid: string
): Promise<MeasurementMeta> {
  const q = new URLSearchParams({ measurement_uid: measurementUid });
  const meta = await getJSON<MeasurementMeta>(
    url(apiBase, "/v1/measurement_meta?" + q)
  );
  if (!meta.report_id) {
    throw new Error(`No measurement found for uid ${measurementUid}`);
  }
  return meta;
}

// /v1/observations cannot filter on measurement_uid directly, so we fetch by
// the report_id resolved from measurement_meta and filter client-side (a
// report may bundle several measurements).
export async function fetchObservations(
  apiBase: string,
  measurementUid: string
): Promise<WebObservation[]> {
  const limit = 500;
  const maxPages = 10;
  const rows: WebObservation[] = [];
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({
      measurement_uid: measurementUid,
      limit: String(limit),
      offset: String(page * limit),
    });
    const data = await getJSON<{ results: WebObservation[] }>(
      url(apiBase, "/v1/observations?" + q)
    );
    rows.push(
      ...data.results.filter((r) => r.measurement_uid === measurementUid)
    );
    if (data.results.length < limit) break;
  }
  return rows.sort((a, b) => a.observation_idx - b.observation_idx);
}

// The analysis is computed asynchronously after a measurement lands, so it may
// legitimately not exist yet — the caller gets null rather than an error.
export async function fetchAnalysis(
  apiBase: string,
  measurementUid: string
): Promise<MeasurementAnalysis | null> {
  const q = new URLSearchParams({ measurement_uid: measurementUid });
  const data = await getJSON<{ results: MeasurementAnalysis[] }>(
    url(apiBase, "/v1/analysis?" + q)
  );
  return (
    data.results.find((r) => r.measurement_uid === measurementUid) ?? null
  );
}

export async function fetchCtrlGroundTruth(
  apiBase: string,
  hostnames: string[],
  since: string,
  until: string
): Promise<CtrlGroundTruthEntry[]> {
  const q = new URLSearchParams({ since, until });
  for (const h of hostnames) q.append("hostname", h);
  const data = await getJSON<{ results: CtrlGroundTruthEntry[] }>(
    url(apiBase, "/v1/aggregation/observations/ctrl?" + q)
  );
  return data.results;
}

export interface AggregationParams {
  // A target can span several hostnames; the per-day buckets sum across them
  hostnames: string[];
  probeASN: number;
  // When set the aggregation is restricted to observations whose resolver_asn
  // matches; when undefined every resolver is included.
  resolverASN?: number;
  since: string;
  until: string;
  timeGrain?: "hour" | "day" | "week" | "month";
}

export async function fetchAggregatedObservations(
  apiBase: string,
  p: AggregationParams
): Promise<AggregationEntry[]> {
  const q = new URLSearchParams({
    since: p.since,
    until: p.until,
    time_grain: p.timeGrain ?? "day",
  });
  q.append("group_by", "timestamp");
  q.append("group_by", "failure");
  for (const h of p.hostnames) q.append("hostname", h);
  q.append("probe_asn", String(p.probeASN));
  if (p.resolverASN !== undefined) {
    q.append("resolver_asn", String(p.resolverASN));
  }
  const data = await getJSON<{ results: AggregationEntry[] }>(
    url(apiBase, "/v1/aggregation/observations?" + q)
  );
  return data.results;
}
