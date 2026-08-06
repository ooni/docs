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
