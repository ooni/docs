// Framework-agnostic types shared across the labeler app. Kept dependency-free
// so this module can be dropped into a Next.js app unchanged.

export type Verdict = "blocked" | "down" | "ok" | "unadjudicated" | "unusable";
export type Confidence = "certain" | "probable" | "uncertain";

// A wide observation row (obs_web) or control row (obs_web_ctrl). The
// upstream schema is wider than what the UI reads, and varies by test
// version, so this stays a loose index signature rather than an exhaustive
// interface.
export interface WideRow {
  hostname?: string | null;
  ip?: string | null;
  port?: number | null;

  dns_answer?: string | null;
  dns_answer_type?: string | null;
  dns_answer_asn?: number | null;
  dns_answer_as_org_name?: string | null;
  dns_query_type?: string | null;
  dns_engine?: string | null;
  dns_engine_resolver_address?: string | null;
  dns_failure?: string | null;
  dns_success?: number | boolean | null;

  ip_asn?: number | null;
  ip_as_org_name?: string | null;
  ip_as_cc?: string | null;
  ip_cc?: string | null;
  ip_is_bogon?: boolean | number | null;

  tcp_failure?: string | null;
  tcp_success?: number | boolean | null;

  tls_failure?: string | null;
  tls_success?: number | boolean | null;
  tls_server_name?: string | null;
  tls_version?: string | null;
  tls_cipher_suite?: string | null;
  tls_is_certificate_valid?: boolean | null;
  tls_end_entity_certificate_subject_common_name?: string | null;
  tls_end_entity_certificate_issuer_common_name?: string | null;
  tls_end_entity_certificate_san_list?: string[] | null;
  tls_end_entity_certificate_fingerprint?: string | null;
  tls_handshake_last_operation?: string | null;
  tls_t?: number | null;

  http_request_url?: string | null;
  http_failure?: string | null;
  http_success?: number | boolean | null;
  http_response_status_code?: number | null;
  http_response_body_length?: number | null;
  http_response_body_sha1?: string | null;
  http_response_header_location?: string | null;
  http_response_header_server?: string | null;
  http_t?: number | null;

  [k: string]: unknown;
}

export interface QueueRow {
  measurement_uid: string;
  probe_cc: string;
  probe_asn: number | string;
  resolver_asn?: number | string | null;
  domain?: string | null;
  input?: string | null;
  test_name: string;
  measurement_start_time: string;

  sampling_stratum?: string;
  sampling_weight?: number;
  sample_population?: number;
  sample_rows?: number;
  sampling_design_id?: string;
  screen_kind?: string;

  [k: string]: unknown;
}

export interface Candidate {
  observations: WideRow[];
  controls: WideRow[];
}

export interface ContextSeriesPoint {
  ts: string;
  failure_str: string;
  count: number;
  resolver_asn?: number | string;
}

export interface ContextResponse {
  window_hours: number;
  series: ContextSeriesPoint[];
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

export interface SampleResponse {
  rows: QueueRow[];
  design_id: string;
  replicate: number;
  spec?: unknown;
  frame_start?: string;
  frame_end?: string;
  strata?: unknown;
}

export interface TestNameInfo {
  test_name: string;
  measurements: number;
  screen_positive: number;
}

export interface RevealResponse {
  analysis?: {
    top_probe_analysis?: string | null;
    loni: {
      dns: { blocked?: number };
      tcp: { blocked?: number };
      tls: { blocked?: number };
    };
    top_dns_failure?: string | null;
    top_tcp_failure?: string | null;
    top_tls_failure?: string | null;
  } | null;
  fastpath?: { anomaly: boolean; confirmed: boolean } | null;
}

export interface LabelRecord {
  label_id: string;
  measurement_uid: string;
  probe_cc: string;
  probe_asn: number | string;
  resolver_asn?: number | string | null;
  target: string;
  test_name: string;
  observed_at: string;

  label: Verdict;
  label_confidence: Confidence;
  mechanisms: string[];
  mechanism_taxonomy: string;
  label_source: "analyst";
  adjudicator: string;
  adjudicated_at: string;
  rationale: string;

  sampling_stratum?: string;
  sampling_weight?: number;
  sample_population?: number;
  sample_rows?: number;
  sampling_design_id?: string;
  screen_kind?: string;

  blinded: true;
  superseded_by: string | null;
  supersede_reason: string | null;
}

export interface LabelerState {
  adjudicator: string;
  apiBase: string;
  designs: Record<string, SamplingDesign>;
  labels: LabelRecord[];
  queue: QueueRow[];
}

export const defaultState = (): LabelerState => ({
  adjudicator: "",
  apiBase: "https://oonimeasurements.dev.ooni.io/",
  designs: {},
  labels: [],
  queue: [],
});
