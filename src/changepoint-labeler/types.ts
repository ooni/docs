import type { Layer } from "../event-dashboard/types";

// A row of event_detector_v2_changepoints
export interface StoredChangepoint {
  uuid: string;
  domain: string;
  probe_cc: string;
  probe_asn: number;
  resolver_asn: number;
  layer: Layer;
  ts_hour: string; // ISO8601 UTC
  s_neg: number;
  s_pos: number;
  h: number;
  state: "BLOCK" | "OK";
  run_parameters: string; // JSON-encoded detector parameters
  created_at: string;
}

export type Verdict = "blocked" | "ok" | "undecided";

// A row of changepoint_label. Labels are append-only: the newest row for a
// changepoint is its current label, older ones are its history.
export interface ChangepointLabel {
  id: string;
  changepoint_id: string;
  created_at: string;
  author: string;
  verdict: Verdict;
  notes: string;
  last_ok_time: string | null;
  first_block_time: string | null;
  last_block_time: string | null;
  first_ok_time: string | null;
}

export type NewChangepointLabel = Omit<ChangepointLabel, "id" | "created_at">;

export const TIME_FIELDS = [
  "last_ok_time",
  "first_block_time",
  "last_block_time",
  "first_ok_time",
] as const;
export type TimeField = (typeof TIME_FIELDS)[number];

export interface ChangepointQuery {
  probe_cc: string;
  domain: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD, inclusive
}
