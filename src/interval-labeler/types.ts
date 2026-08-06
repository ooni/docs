// The interval grain of the label corpus: one row per detector cell-week.
// Framework-agnostic and dependency-free, like the other two labellers, so the
// directory can be dropped into a Next.js app unchanged.
//
// This grain is the one that inverts the event grain's rule about sampling.
// Events are curated, so they carry no weights and recall over them is a
// coverage statement about a hand-built set. Quiet intervals are the opposite:
// `sampling_stratum`, `sampling_weight` and `sampling_design_id` are
// load-bearing, because a false-alarm *rate* is an estimate over a population
// of cell-weeks and there is no way to reconstruct a selection probability
// after the fact.

/**
 * The verdict answers one question — *did the state change inside this week?*
 * — because that is what a changepoint detector can be right or wrong about.
 *
 * `blocked_throughout` exists because state and change come apart. A week in
 * the middle of a long-running block has no transition in it, so the detector
 * should stay silent and an alert there is a false alarm; but the cell is not
 * quiet, and calling it `quiet_observed` would put a blocked week into the pool
 * of clean negatives. Calling it `event_present` is worse: it credits the
 * detector with a detection it did not earn — it missed the real onset weeks
 * earlier — and removes the week from the false-alarm denominator, so alert
 * spam inside long blocks scores clean on both metrics.
 *
 * How the harness reads them:
 *
 *     false-alarm denominator  quiet_observed + blocked_throughout
 *     recall / latency         event_present only
 *     clean negatives          quiet_observed only
 *     excluded, and counted    uncertain, unusable
 */
export type IntervalVerdict =
  | "quiet_observed"
  | "blocked_throughout"
  | "event_present"
  | "uncertain"
  | "unusable";
export type Confidence = "certain" | "probable" | "uncertain";

/**
 * One drawn cell-week, exactly as `/api/v1/labeling/interval_sample` returns
 * it. Everything here is either a key, a coverage count or sampling
 * provenance — nothing the detector concluded.
 *
 * `sampling_stratum` is the one field that leaks: `detector_alerted` says the
 * incumbent fired somewhere in this week. It has to be carried, because the
 * weight is meaningless without it, so the blinding is the UI's job — it is
 * not rendered anywhere before commit, and the queue arrives interleaved so
 * position does not give it away either.
 */
export interface IntervalRow {
  probe_cc: string;
  probe_asn: number;
  domain: string;
  window_start: string;
  window_end: string;
  measurements_in_window: number;
  volume_band: string;

  sampling_stratum: string;
  sampling_weight: number;
  sample_population: number;
  sample_rows: number;
  sampling_design_id: string;
  screen_kind: string;

  [k: string]: unknown;
}

export interface IntervalSampleResponse {
  rows: IntervalRow[];
  design_id: string;
  replicate: number;
  spec?: unknown;
  frame_start?: string;
  frame_end?: string;
  strata?: unknown;
}

export interface SamplingDesign {
  design_id: string;
  replicate: number;
  spec?: unknown;
  drawn_at: string;
  frame_start?: string;
  frame_end?: string;
  strata?: unknown;
}

export interface Changepoint {
  ts: string;
  block_type: string;
  change_dir: number;
  s_pos: number | null;
  s_neg: number | null;
  current_state: string;
  h: number | null;
  in_window: boolean;
}

export interface IntervalReveal {
  changepoints: Changepoint[];
  alerts_in_window: number;
  signal: {
    ts: string;
    count: number;
    dns_isp_blocked: number | null;
    dns_other_blocked: number | null;
    tcp_blocked: number | null;
    tls_blocked: number | null;
  }[];
  caveat?: string;
}

/**
 * One adjudicated cell-week. The verdict is `quiet_observed`, never `quiet`:
 * the week is judged from the same OONI data the detector reads, so an
 * unmeasured block is indistinguishable from calm, and the name caps the claim
 * at "no interference visible in OONI's data".
 */
export interface IntervalLabel {
  interval_id: string;
  probe_cc: string;
  probe_asn: number;
  domain: string;
  window_start: string;
  window_end: string;

  verdict: IntervalVerdict;
  confidence: Confidence;
  rationale: string;

  sampling_stratum: string;
  screen_kind: string;
  sampling_weight: number;
  sample_population: number;
  sample_rows: number;
  sampling_design_id: string;

  volume_band: string;
  measurements_in_window: number;

  /**
   * Event ids from an imported event corpus whose scope and window overlap
   * this cell-week, or null when no corpus was loaded. An unreported real
   * event inside a week called quiet biases the false-alarm rate *upward*,
   * which is the safe direction — but a known one is not an unknown one, and
   * dropping the row instead would silently shrink the denominator.
   */
  event_overlap: string[] | null;

  blinded: true;
  adjudicator: string;
  adjudicated_at: string;
  superseded_by: string | null;
  supersede_reason: string | null;
}

export interface IntervalLabelerState {
  adjudicator: string;
  apiBase: string;
  designs: Record<string, SamplingDesign>;
  labels: IntervalLabel[];
  queue: IntervalRow[];
  /** Imported event corpus, for the contamination cross-check. */
  events: unknown[];
}

export const defaultState = (): IntervalLabelerState => ({
  adjudicator: "",
  apiBase: "https://oonimeasurements.dev.ooni.io/",
  designs: {},
  labels: [],
  queue: [],
  events: [],
});

/** Stable key for a cell-week: what "have I already labelled this?" asks. */
export const cellKey = (r: {
  probe_cc: string;
  probe_asn: number;
  domain: string;
  window_start: string;
}): string => `${r.probe_cc}|${r.probe_asn}|${r.domain}|${r.window_start.slice(0, 10)}`;
