// The event grain of the label corpus, as specified in
// docs/data/pipeline-label-corpus §1.2. Framework-agnostic and dependency-free
// so this module can be dropped into a Next.js app unchanged.

export type EventClass = "true_event" | "false_positive_event" | "disputed";
export type Scoreable = "yes" | "no_coverage" | "unknown";
export type Confidence = "certain" | "probable" | "uncertain";
export type AsnScopeKind = "all" | "listed" | "unknown";
export type TargetSetKind = "enumerated" | "category" | "unknown";
export type EvidenceSource =
  | "ooni_report"
  | "partner"
  | "press"
  | "operator"
  | "court_order"
  | "internal_analysis";

/**
 * One adjudicated event. Fields that the schema derives — `ongoing`, `layers`,
 * `size_band` — are deliberately absent: see derive.ts. A stored `ongoing`
 * next to a non-null `resolution_earliest` is not extra information, it is a
 * bug that renders as data.
 *
 * Timestamps are naive ISO strings (`2020-02-01T00:00:00`) meaning UTC, which
 * is what the importer emits and what `<input type=datetime-local>` reads.
 */
export interface EventLabel {
  event_id: string;
  incident_id?: string | null;
  slug?: string | null;
  title?: string | null;

  // scope
  probe_cc: string;
  asn_scope: number[];
  asn_scope_kind: AsnScopeKind;
  target_set: string[];
  target_set_kind: TargetSetKind;

  // how, in the same taxonomy as the measurement labels
  mechanisms: string[];
  mechanism_taxonomy: string;

  // when, as intervals: published reports date events coarsely
  onset_earliest: string | null;
  onset_latest: string | null;
  resolution_earliest: string | null; // null = ongoing
  resolution_latest: string | null;

  // grading
  event_class: EventClass;
  scoreable: Scoreable;
  confidence: Confidence;

  // evidence
  source: EvidenceSource;
  source_urls: string[];
  corroborators: string[];
  test_names?: string[];

  adjudicator?: string;
  adjudicated_at?: string | null;
  rationale?: string;
  added_at?: string;
  superseded_by?: string | null;
  supersede_reason?: string | null;
  import_source?: string;
  needs_review?: string[];

  [k: string]: unknown;
}

/**
 * What the form holds while it is being edited: strings, because that is what
 * the inputs traffic in. `collect()` in derive.ts turns this back into the
 * exported shape, and it is the only place the parsing lives.
 */
export interface EventDraft {
  probe_cc: string;
  asn_scope: string; // comma separated
  asn_scope_kind: AsnScopeKind;
  target_set: string; // comma separated
  target_set_kind: TargetSetKind;

  onset_earliest: string; // datetime-local value, "" = null
  onset_latest: string;
  resolution_earliest: string;
  resolution_latest: string;

  mechanisms: string[];

  event_class: EventClass;
  scoreable: Scoreable;
  confidence: Confidence;

  source: EvidenceSource;
  source_urls: string; // one per line
  corroborators: string; // comma separated
  rationale: string;
}

export interface EventLabelerState {
  adjudicator: string;
  apiBase: string;
  events: EventLabel[];
  cursor: number;
}

export const defaultState = (): EventLabelerState => ({
  adjudicator: "",
  apiBase: "https://oonimeasurements.dev.ooni.io/",
  events: [],
  cursor: 0,
});
