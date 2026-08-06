import { collapseOutcomes, OK } from "../event-labeler/outcomes";
import type { FacetSeries, OutcomeBucket } from "../event-labeler/api";
import type { IntervalReveal, IntervalRow, IntervalSampleResponse } from "./types";

/**
 * Three calls, over two endpoints that already exist plus one that had to.
 *
 * - the queue comes from `/api/v1/labeling/interval_sample`, which is the one
 *   thing the browser cannot do honestly on its own: a weight is a fact about
 *   a process that has already run, so the frame and the population have to be
 *   recorded by whatever draws from them
 * - the timeline reads `/api/v1/aggregation/observations`, the same endpoint
 *   the event editor plots, so there is no interval-specific candidate view to
 *   keep blinded — failure strings are all it returns
 * - the reveal reads `/api/v1/labeling/interval_reveal`, and is called only
 *   after the analyst commits
 */

const labeling = (apiBase: string, path: string): string =>
  apiBase.replace(/\/$/, "") + "/api/v1/labeling" + path;

export interface IntervalDrawParams {
  strata: string[];
  replicate: number;
  limit: number;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  probeCC?: string;
  domain?: string;
  domainList: "detector" | "all";
  minMeasurements: number;
}

export async function drawIntervalSample(
  apiBase: string,
  p: IntervalDrawParams
): Promise<IntervalSampleResponse> {
  const q = new URLSearchParams({
    strata: p.strata.join(","),
    replicate: String(p.replicate || 1),
    limit: String(p.limit),
    since: p.since + "T00:00:00",
    until: p.until + "T00:00:00",
    domain_list: p.domainList,
    min_measurements: String(p.minMeasurements),
  });
  if (p.probeCC) q.set("probe_cc", p.probeCC.toUpperCase());
  if (p.domain) q.set("domain", p.domain);
  const r = await fetch(labeling(apiBase, "/interval_sample?" + q));
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail || r.statusText);
  }
  return r.json();
}

export async function fetchIntervalReveal(
  apiBase: string,
  row: IntervalRow,
  padDays: number
): Promise<IntervalReveal> {
  const q = new URLSearchParams({
    probe_cc: row.probe_cc,
    probe_asn: String(row.probe_asn),
    domain: row.domain,
    window_start: row.window_start,
    window_end: row.window_end,
    pad_days: String(padDays),
  });
  const r = await fetch(labeling(apiBase, "/interval_reveal?" + q));
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail || r.statusText);
  }
  return r.json();
}

// ---------------------------------------------------------------- timeseries

export interface CellSeries {
  facets: FacetSeries[];
  outcomes: string[];
  note: string;
}

interface ObsRow {
  observation_count?: number;
  failure?: string | null;
  timestamp?: string | null;
}

const MAX_LEGEND_OUTCOMES = 8;

const day = (iso: string, offsetDays: number): string =>
  new Date(Date.parse(iso + (iso.endsWith("Z") ? "" : "Z")) + offsetDays * 864e5)
    .toISOString()
    .slice(0, 19);

/**
 * What the probes got in this cell, per bucket, padded on both sides of the
 * adjudicated week.
 *
 * The padding is not decoration. A week judged in isolation looks quiet
 * whenever it is *uniformly* blocked — the state never changes inside it, so
 * nothing about the shape says so. Seeing the fortnight either side is what
 * separates "nothing happened here" from "this cell has been blocked
 * throughout", and only the first of those is a quiet interval.
 *
 * Failure strings, not blocking scores: an interval judged from the pipeline's
 * own opinion of blocking is judged by the thing the corpus exists to
 * evaluate. Same reasoning as the event editor's timeline, and it matters more
 * here, because one of the strata is the detector's own output.
 */
export async function fetchCellSeries(
  apiBase: string,
  row: IntervalRow,
  opts: { grain: "hour" | "day"; padDays: number }
): Promise<CellSeries> {
  const q = new URLSearchParams({
    since: day(row.window_start, -opts.padDays),
    until: day(row.window_end, opts.padDays),
    time_grain: opts.grain,
    probe_cc: row.probe_cc,
  });
  q.append("group_by", "timestamp");
  q.append("group_by", "failure");
  q.append("probe_asn", String(row.probe_asn));
  q.append("hostname", row.domain);

  const base = apiBase.replace(/\/$/, "");
  const r = await fetch(`${base}/api/v1/aggregation/observations?${q}`);
  if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
  const rows: ObsRow[] = (await r.json()).results || [];

  const byTs = new Map<string, Record<string, number>>();
  let total = 0;
  for (const o of rows) {
    if (!o.timestamp) continue;
    const counts = byTs.get(o.timestamp) || {};
    const n = o.observation_count || 0;
    counts[o.failure || OK] = (counts[o.failure || OK] || 0) + n;
    total += n;
    byTs.set(o.timestamp, counts);
  }

  const buckets: OutcomeBucket[] = [...byTs.entries()]
    .map(([k, counts]) => ({
      t: new Date(k.endsWith("Z") ? k : k + "Z"),
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());

  const outcomes = collapseOutcomes(buckets, MAX_LEGEND_OUTCOMES);
  const facets: FacetSeries[] = buckets.length
    ? [{ key: "cell", label: `AS${row.probe_asn} · ${row.domain}`, buckets, total }]
    : [];

  return {
    facets,
    outcomes,
    note: buckets.length
      ? `${buckets.length} ${opts.grain} buckets · ${total.toLocaleString()} observations · ` +
        `±${opts.padDays}d around the week`
      : "no observations in this window",
  };
}

// ---------------------------------------------------------------- analysis
// What the pipeline concluded about this cell, as opposed to what the probes
// got. Pipeline output, so it is fetched only after the analyst commits and
// rendered only in the revealed state — see AnalysisChart.

export interface LayerScores {
  blocked: number | null;
  down: number | null;
  ok: number | null;
  outcome: string | null;
}

export interface AnalysisBucket {
  t: Date;
  count: number;
  /** Mean over the measurements in the bucket: the one honest average here. */
  blockedMean: number | null;
  /** Max over the bucket, and the outcome string that carried it. */
  blockedMax: number | null;
  maxOutcome: string | null;
  layers: Record<"dns" | "tcp" | "tls", LayerScores>;
}

export interface AnalysisSeries {
  buckets: AnalysisBucket[];
  /** Distinct `blocked_max_outcome` values present, by volume. */
  outcomeKinds: string[];
  note: string;
}

interface AggLoni {
  blocked_max?: number | null;
  blocked_max_outcome?: string | null;
  blocked_probability_mean?: number | null;
  [k: string]: unknown;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const layerOf = (l: AggLoni, layer: string): LayerScores => ({
  blocked: num(l[`${layer}_blocked`]),
  down: num(l[`${layer}_down`]),
  ok: num(l[`${layer}_ok`]),
  outcome: str(l[`${layer}_blocked_outcome`]),
});

/**
 * Per-bucket analysis scores for this cell, over the same padded window as the
 * observation chart.
 *
 * Note what these values are, because it decides how they may be drawn. The
 * aggregation returns `*_blocked`, `*_down` and `*_ok` as **componentwise
 * maxima** over the bucket, not as a distribution: a real bucket comes back as
 * `dns_blocked 0.95, dns_down 0.05, dns_ok 1.0`, which sums to 2. That is the
 * exact shape the user guide §3.5 forbids stacking — "three existential
 * answers wearing a state vector". They are drawn as three independent lines
 * for that reason. `blocked_probability_mean` is the only genuine per-bucket
 * average, so it is the one drawn as *the* blocking probability.
 */
export async function fetchCellAnalysis(
  apiBase: string,
  row: IntervalRow,
  opts: { grain: "hour" | "day"; padDays: number }
): Promise<AnalysisSeries> {
  const q = new URLSearchParams({
    axis_x: "measurement_start_day",
    time_grain: opts.grain,
    since: day(row.window_start, -opts.padDays),
    until: day(row.window_end, opts.padDays),
    probe_cc: row.probe_cc,
    probe_asn: String(row.probe_asn),
    domain: row.domain,
  });

  const base = apiBase.replace(/\/$/, "");
  const r = await fetch(`${base}/api/v1/aggregation/analysis?${q}`);
  if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
  const rows: { measurement_start_day?: string; count?: number; loni?: AggLoni | null }[] =
    (await r.json()).results || [];

  const buckets: AnalysisBucket[] = rows
    .filter((x) => x.measurement_start_day)
    .map((x) => {
      const l = x.loni || {};
      const k = x.measurement_start_day as string;
      return {
        t: new Date(k.endsWith("Z") ? k : k + "Z"),
        count: x.count || 0,
        blockedMean: num(l.blocked_probability_mean),
        blockedMax: num(l.blocked_max),
        maxOutcome: str(l.blocked_max_outcome),
        layers: {
          dns: layerOf(l, "dns"),
          tcp: layerOf(l, "tcp"),
          tls: layerOf(l, "tls"),
        },
      };
    })
    .sort((a, b) => a.t.getTime() - b.t.getTime());

  // Only count an outcome kind when the bucket actually leans blocked;
  // `blocked_max_outcome` is populated even at 0.0, where it names the rule
  // that would have won rather than anything that happened.
  const weight = new Map<string, number>();
  for (const b of buckets) {
    if (!b.maxOutcome || (b.blockedMax ?? 0) <= 0) continue;
    weight.set(b.maxOutcome, (weight.get(b.maxOutcome) || 0) + 1);
  }
  const outcomeKinds = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  return {
    buckets,
    outcomeKinds,
    note: buckets.length
      ? `${buckets.length} ${opts.grain} buckets scored`
      : "no scored measurements in this window",
  };
}
