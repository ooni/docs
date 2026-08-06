import { collapseOutcomes, OK } from "./outcomes";
import type { EventLabel } from "./types";

/**
 * The only network the event editor does, over two existing endpoints — there
 * is no event API, no write endpoint and no auth surface, by design.
 *
 * - the timeline reads `/api/v1/aggregation/observations`: what the probes
 *   actually got, per bucket, broken down by failure
 * - the coverage check reads `/api/v1/aggregation/analysis`: how many
 *   *measurements* exist in scope, which is the question `scoreable` asks
 */

interface AggRow {
  count?: number;
  probe_asn?: number | string;
  measurement_start_day?: string;
  loni?: { blocked_probability_mean?: number | null; blocked_max?: number | null } | null;
  [k: string]: unknown;
}

/**
 * The deployed aggregation API reports the LoNI as per-layer values plus
 * `blocked_max`; other builds expose `blocked_probability_mean`. Read
 * whichever is present — picking one silently draws an empty line and a
 * coverage report with no P(blocked) in it, which reads as "no signal" rather
 * than "wrong field name".
 */
const blockedProb = (row: AggRow): number | null => {
  const v = row.loni?.blocked_probability_mean ?? row.loni?.blocked_max;
  return typeof v === "number" ? v : null;
};

const agg = async (apiBase: string, q: URLSearchParams): Promise<AggRow[]> => {
  const base = apiBase.replace(/\/$/, "");
  const r = await fetch(`${base}/api/v1/aggregation/analysis?${q}`);
  if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
  const data = await r.json();
  return data.results || [];
};

/** Scope, as both queries need to read it. */
const scopeOf = (e: EventLabel) => {
  const asns = new Set((e.asn_scope || []).map(Number));
  return {
    // One request per target; `null` means "any target in the country".
    targets:
      e.target_set_kind === "enumerated" && e.target_set.length ? e.target_set : ([null] as (string | null)[]),
    asns,
    scoped: e.asn_scope_kind === "listed" && asns.size > 0,
  };
};

// ---------------------------------------------------------------- timeseries

interface ObsRow {
  observation_count?: number;
  failure?: string | null;
  timestamp?: string | null;
  [k: string]: unknown;
}

/** One time bucket, as a breakdown of what the probes got. */
export interface OutcomeBucket {
  t: Date;
  total: number;
  counts: Record<string, number>; // failure string, `none` for a clean observation
}

/** How the series is split into panels. */
export type FacetMode = "none" | "target" | "asn";

export interface FacetSeries {
  key: string;
  label: string;
  buckets: OutcomeBucket[];
  total: number;
}

export interface SeriesResult {
  facets: FacetSeries[];
  /** Display order: ok first, then failure kinds by volume, then `other`. */
  outcomes: string[];
  note: string;
}

const MAX_LEGEND_OUTCOMES = 8;
const MAX_FACETS = 8;

/**
 * Per-observation outcomes per bucket: DNS/TCP/TLS/HTTP failure strings and
 * `none`, straight from `obs_web` via the observations aggregation.
 *
 * This deliberately does *not* plot the analysis layer's blocking
 * probabilities. Two reasons. An onset read off a calibrated score is read off
 * the thing the corpus exists to evaluate, which is the circularity
 * requirement V1 exists to prevent — the bracket would be anchored to the
 * pipeline's own opinion of when blocking started. And a score is an
 * indirection: "tls.connection_reset replaced none at 14:00" is a fact about
 * the network, whereas "P(blocked) rose to 0.8" is a fact about the scoring
 * rules, which change under you.
 *
 * The scope goes into one request: this endpoint takes repeated `hostname` and
 * `probe_asn` parameters, so a listed-ASN, many-target event is expressed
 * exactly rather than approximated by a country-wide query.
 */
export async function fetchSeries(
  apiBase: string,
  e: EventLabel,
  opts: {
    grain: "hour" | "day";
    padDays: number;
    facet: FacetMode;
    /** Explicit window, in ms — what "load the zoomed range" passes. */
    window?: { lo: number; hi: number } | null;
  }
): Promise<SeriesResult> {
  const { targets, asns, scoped } = scopeOf(e);

  const anchorLo = Date.parse((e.onset_earliest || "") + "Z") || Date.now();
  const anchorHi =
    Date.parse((e.resolution_latest || e.onset_latest || e.onset_earliest || "") + "Z") || anchorLo;
  // A zoomed reload re-queries just the visible span, which is how you get
  // hourly resolution on a window the API would time out on at full width.
  const since = opts.window
    ? new Date(opts.window.lo).toISOString().slice(0, 19)
    : new Date(anchorLo - opts.padDays * 864e5).toISOString().slice(0, 10);
  const until = opts.window
    ? new Date(opts.window.hi).toISOString().slice(0, 19)
    : new Date(anchorHi + opts.padDays * 864e5).toISOString().slice(0, 10);

  const q = new URLSearchParams({ since, until, time_grain: opts.grain });
  q.append("group_by", "timestamp");
  q.append("group_by", "failure");
  // Faceting is a server-side group_by, so a per-ASN view costs the same one
  // request a summed view does.
  if (opts.facet === "target") q.append("group_by", "hostname");
  if (opts.facet === "asn") q.append("group_by", "probe_asn");
  if (e.probe_cc) q.append("probe_cc", e.probe_cc);
  for (const t of targets) if (t) q.append("hostname", t);
  if (scoped) for (const a of asns) q.append("probe_asn", String(a));
  for (const t of e.test_names || []) q.append("test_name", t);

  const base = apiBase.replace(/\/$/, "");
  const r = await fetch(`${base}/api/v1/aggregation/observations?${q}`);
  if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
  const rows: ObsRow[] = (await r.json()).results || [];

  const facetOf = (row: ObsRow): string => {
    if (opts.facet === "asn") return row.probe_asn != null ? "AS" + row.probe_asn : "unknown ASN";
    if (opts.facet === "target") return String(row.hostname || "unknown target");
    return "all";
  };

  const byFacet = new Map<string, Map<string, Record<string, number>>>();
  const timestamps = new Set<string>();
  let total = 0;
  for (const row of rows) {
    const k = row.timestamp;
    if (!k) continue;
    timestamps.add(k);
    const fk = facetOf(row);
    const byTs = byFacet.get(fk) || new Map<string, Record<string, number>>();
    const counts = byTs.get(k) || {};
    const n = row.observation_count || 0;
    counts[row.failure || OK] = (counts[row.failure || OK] || 0) + n;
    total += n;
    byTs.set(k, counts);
    byFacet.set(fk, byTs);
  }

  let facets: FacetSeries[] = [...byFacet.entries()]
    .map(([key, byTs]) => {
      const buckets = [...byTs.entries()]
        .map(([k, counts]) => ({
          t: new Date(k.endsWith("Z") ? k : k + "Z"),
          counts,
          total: Object.values(counts).reduce((a, b) => a + b, 0),
        }))
        .sort((a, b) => a.t.getTime() - b.t.getTime());
      return {
        key,
        label: key,
        buckets,
        total: buckets.reduce((s, b) => s + b.total, 0),
      };
    })
    .sort((a, b) => b.total - a.total);

  // Outcomes are collapsed across every panel at once, so one colour means the
  // same failure in all of them and the legend is shared.
  const outcomes = collapseOutcomes(facets.flatMap((f) => f.buckets), MAX_LEGEND_OUTCOMES);

  const hiddenFacets = Math.max(facets.length - MAX_FACETS, 0);
  if (hiddenFacets) facets = facets.slice(0, MAX_FACETS);

  const note = facets.length
    ? [
        `${timestamps.size} ${opts.grain} buckets · ${total.toLocaleString()} observations`,
        opts.facet === "none"
          ? [
              e.target_set_kind === "enumerated" && e.target_set.length
                ? `${e.target_set.length} target${e.target_set.length > 1 ? "s" : ""}`
                : "any target",
              scoped ? `${asns.size} ASN${asns.size > 1 ? "s" : ""}` : "country-wide",
            ].join(", ") + ", summed"
          : `${facets.length}${hiddenFacets ? ` of ${facets.length + hiddenFacets}` : ""} ` +
            `${opts.facet === "asn" ? "ASNs" : "targets"}, by volume`,
        (e.test_names || []).length ? (e.test_names || []).join("/") : "",
      ]
        .filter(Boolean)
        .join("  ·  ")
    : "no observations in this window";

  return { facets, outcomes, note };
}

// ---------------------------------------------------------------- coverage

export interface CoverageResult {
  lines: string[];
  inScope: number;
  scoreable: "yes" | "no_coverage";
  since: string;
  until: string;
}

/**
 * Makes `no_coverage` an observation rather than a guess: an event on networks
 * OONI never measured during the window cannot be detected by any detector,
 * and scoring it as a miss makes recall meaninglessly pessimistic.
 *
 * One request per target, broken down by ASN server-side, rather than
 * target × ASN requests — a five-domain, twenty-ASN event is 5 calls here and
 * 100 the other way.
 */
export async function checkCoverage(apiBase: string, e: EventLabel): Promise<CoverageResult> {
  const day = (d: string | null | undefined) => String(d || "").slice(0, 10);
  const plusDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);

  const since = day(e.onset_earliest) || day(new Date().toISOString());
  // The aggregation frame is half-open, so a same-day bracket needs a day
  // added or it selects nothing and every event reads as no_coverage.
  let until = day(e.resolution_latest || e.onset_latest || e.onset_earliest);
  if (!until || until <= since) until = plusDay(since);

  const { targets, asns, scoped } = scopeOf(e);
  const lines: string[] = [];
  let inScope = 0;

  for (const d of targets) {
    const q = new URLSearchParams({ axis_x: "probe_asn", since, until, probe_cc: e.probe_cc });
    if (d) q.set("domain", d);
    const rows = await agg(apiBase, q);
    const all = rows.reduce((s, x) => s + (x.count || 0), 0);
    const hit = scoped ? rows.filter((x) => asns.has(Number(x.probe_asn))) : rows;
    const n = hit.reduce((s, x) => s + (x.count || 0), 0);
    const den = hit.reduce((s, x) => s + (blockedProb(x) != null ? x.count || 0 : 0), 0);
    const mean = den
      ? hit.reduce((s, x) => s + (blockedProb(x) || 0) * (x.count || 0), 0) / den
      : null;
    inScope += n;
    lines.push(
      `${(d || "any target").padEnd(30)} n=${n}` +
        (scoped ? ` of ${all} in ${e.probe_cc}` : "") +
        (mean != null ? `  mean P(blocked)=${mean.toFixed(3)}` : "") +
        (scoped && !n && all ? "   ← none on the listed ASNs" : "")
    );
  }

  lines.push("");
  lines.push(
    inScope === 0
      ? `no measurements in scope over ${since}..${until} → scoreable = no_coverage`
      : `${inScope} measurements in scope over ${since}..${until} → scoreable = yes`
  );

  return { lines, inScope, scoreable: inScope === 0 ? "no_coverage" : "yes", since, until };
}
