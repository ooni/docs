export type Layer = "dns" | "tcp" | "tls";

export const LAYERS: Layer[] = ["dns", "tcp", "tls"];

// UNK: the detector has not seen enough data to settle on OK or BLOCK
export type DetectorState = "OK" | "BLOCK" | "UNK";

// One row of /changepoints .changepoints: the moment the CUSUM detector moved
// a (probe_asn, resolver_asn) pair into `state` at one layer.
export interface Changepoint {
  layer: Layer;
  domain: string;
  probe_cc: string;
  probe_asn: number;
  resolver_asn: number;
  ts_hour: string; // ISO8601, hour resolution, UTC
  state: "OK" | "BLOCK";
  s_pos: number;
  s_neg: number;
  h: number;
}

// One row of /changepoints .series, one per (probe_asn, resolver_asn) seen in
// the range plus the warmup.
export interface Series {
  probe_asn: number;
  resolver_asn: number;
  n_measurements: number; // inside the range, warmup excluded
  final_state: Partial<Record<Layer, DetectorState>>;
}

export interface ChangepointParams {
  probe_cc: string;
  domain: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD, inclusive
}

export interface ChangepointResponse {
  query: ChangepointParams & Record<string, unknown>;
  changepoints: Changepoint[];
  series: Series[];
}

// /api/_/countries
export interface Country {
  alpha_2: string;
  name: string;
  count: number;
}

// /api/_/domains
export interface DomainEntry {
  domain_name: string;
  category_code: string;
  measurement_count: number;
}

export type RuleClass = "blocked" | "ok" | "discarded";

// One row of the changepoint API's /rule_counts: how many measurements of one
// (probe_asn, resolver_asn) pair were scored by `rule_id` at `layer`
export interface RuleCount {
  ts_hour?: string; // only on the hourly rows
  layer: Layer;
  rule_id: string;
  class: RuleClass;
  count: number;
}

export interface RuleCountsResponse {
  totals: RuleCount[];
  hourly: RuleCount[];
}

// One hourly row of /api/v1/aggregation (fastpath). The four counts are
// disjoint and add up to measurement_count.
export interface FastpathRow {
  measurement_start_day: string;
  anomaly_count: number;
  confirmed_count: number;
  failure_count: number;
  ok_count: number;
  measurement_count: number;
}

// One row of /api/v1/aggregation/observations grouped by timestamp, failure
// and measurement_uid
export interface ObservationAggRow {
  observation_count: number;
  failure: string | null;
  timestamp: string | null;
  measurement_uid: string;
}
