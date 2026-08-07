import { MECHANISM_TAXONOMY } from "./mechanisms";
import type { EventDraft, EventLabel } from "./types";

// ---------------------------------------------------------------- derived
// Never stored, always recomputed. `ongoing`, `layers` and `size_band` are
// functions of fields the analyst already entered; persisting them would let
// the corpus carry a size_band that contradicts its own asn_scope.

export const ongoing = (e: Pick<EventLabel, "resolution_earliest">): boolean => !e.resolution_earliest;

export const layersOf = (e: Pick<EventLabel, "mechanisms">): string[] => [
  ...new Set((e.mechanisms || []).map((m) => m.split(".")[0])),
];

export type SizeBand = "national" | "unknown" | "multi_asn" | "micro" | "single_asn";

export function sizeBand(
  e: Pick<EventLabel, "asn_scope" | "asn_scope_kind" | "target_set" | "target_set_kind">
): SizeBand {
  if (e.asn_scope_kind === "all") return "national";
  if (e.asn_scope_kind === "unknown") return "unknown";
  if ((e.asn_scope || []).length > 1) return "multi_asn";
  if (e.target_set_kind === "enumerated" && (e.target_set || []).length === 1) return "micro";
  return "single_asn";
}

// An event the harness can score: it needs a mechanism to match against, and
// `scoreable = unknown` means nobody checked whether OONI had coverage.
export const isComplete = (e: EventLabel): boolean =>
  (e.mechanisms || []).length > 0 && e.scoreable !== "unknown" && !!e.adjudicated_at;

// ---------------------------------------------------------------- draft <-> event
// datetime-local traffics in "YYYY-MM-DDTHH:MM"; the schema stores naive ISO
// seconds meaning UTC. Slicing rather than round-tripping through Date keeps
// them UTC — new Date(s).toISOString() would read them as local time and shift
// the day for everyone not on UTC.
export const toLocal = (iso: string | null | undefined): string => (iso ? iso.slice(0, 16) : "");
export const fromLocal = (v: string): string | null => (v ? v + ":00" : null);

const asList = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function draftFromEvent(e: EventLabel): EventDraft {
  return {
    probe_cc: e.probe_cc || "",
    asn_scope: (e.asn_scope || []).join(", "),
    asn_scope_kind: e.asn_scope_kind || "unknown",
    target_set: (e.target_set || []).join(", "),
    target_set_kind: e.target_set_kind || "unknown",
    onset_earliest: toLocal(e.onset_earliest),
    onset_latest: toLocal(e.onset_latest),
    resolution_earliest: toLocal(e.resolution_earliest),
    resolution_latest: toLocal(e.resolution_latest),
    mechanisms: [...(e.mechanisms || [])],
    event_class: e.event_class || "true_event",
    scoreable: e.scoreable || "unknown",
    confidence: e.confidence || "probable",
    source: e.source || "ooni_report",
    source_urls: (e.source_urls || []).join("\n"),
    corroborators: (e.corroborators || []).join(", "),
    rationale: e.rationale || "",
  };
}

export type EventPatch = Pick<
  EventLabel,
  | "probe_cc"
  | "asn_scope"
  | "asn_scope_kind"
  | "target_set"
  | "target_set_kind"
  | "onset_earliest"
  | "onset_latest"
  | "resolution_earliest"
  | "resolution_latest"
  | "mechanisms"
  | "mechanism_taxonomy"
  | "event_class"
  | "scoreable"
  | "confidence"
  | "source"
  | "source_urls"
  | "corroborators"
  | "rationale"
>;

/** The single place the form's strings become the exported shape. */
export function collect(d: EventDraft): EventPatch {
  return {
    probe_cc: d.probe_cc.trim().toUpperCase(),
    asn_scope: asList(d.asn_scope)
      .map((x) => Number(x.replace(/^as/i, "")))
      .filter((n) => !isNaN(n)),
    asn_scope_kind: d.asn_scope_kind,
    target_set: asList(d.target_set),
    target_set_kind: d.target_set_kind,
    onset_earliest: fromLocal(d.onset_earliest),
    onset_latest: fromLocal(d.onset_latest),
    resolution_earliest: fromLocal(d.resolution_earliest),
    resolution_latest: fromLocal(d.resolution_latest),
    mechanisms: [...d.mechanisms],
    mechanism_taxonomy: MECHANISM_TAXONOMY,
    event_class: d.event_class,
    scoreable: d.scoreable,
    confidence: d.confidence,
    source: d.source,
    source_urls: d.source_urls
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    corroborators: asList(d.corroborators),
    rationale: d.rationale.trim(),
  };
}

/** The merged view an editing session works against: stored event + live edits. */
export const resolve = (e: EventLabel, d: EventDraft): EventLabel => ({ ...e, ...collect(d) });

// ---------------------------------------------------------------- validation
// Everything here is refused at save time rather than warned about, because
// each of these makes the row unusable to the replay harness rather than
// merely untidy.
export function validate(p: EventPatch): string | null {
  if (!p.mechanisms.length && p.event_class === "true_event")
    return "a true_event needs at least one mechanism";
  if (p.onset_earliest && p.onset_latest && p.onset_earliest > p.onset_latest)
    return "onset bracket is inverted";
  if (p.resolution_earliest && p.resolution_latest && p.resolution_earliest > p.resolution_latest)
    return "resolution bracket is inverted";
  if (p.resolution_earliest && p.onset_earliest && p.resolution_earliest < p.onset_earliest)
    return "resolution is before onset";
  if (!p.rationale) return "rationale is required";
  return null;
}

/** Hours between the two arms of a bracket, or null when it is not a bracket. */
export function bracketHours(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((Date.parse(b + "Z") - Date.parse(a + "Z")) / 36e5);
}
