import { MECHANISM_TAXONOMY } from "./mechanisms";
import { isComplete } from "./derive";
import type { EventLabel, EventLabelerState } from "./types";

export function exportPayload(S: EventLabelerState) {
  return {
    export_version: "1",
    grain: "event",
    exported_at: new Date().toISOString(),
    adjudicator: S.adjudicator,
    note:
      "Event-grain labels. Curated, not sampled: no weights, and recall over " +
      "these is a coverage statement about a hand-built set.",
    events: S.events,
  };
}

export interface MergeResult {
  events: EventLabel[];
  added: number;
  kept: number;
  refreshed: number;
}

/**
 * Merge by `event_id`, leaving already-adjudicated rows alone, so a refreshed
 * draft from `incidents_to_events.py` can be re-imported without losing work.
 * `event_id` is a uuid5 of the incident id precisely so this is idempotent.
 */
export function mergeImport(current: EventLabel[], incoming: EventLabel[]): MergeResult {
  const byId = new Map(current.map((e) => [e.event_id, e]));
  let added = 0;
  let kept = 0;
  let refreshed = 0;
  for (const inc of incoming) {
    if (!inc || !inc.event_id) continue;
    const cur = byId.get(inc.event_id);
    if (!cur) {
      byId.set(inc.event_id, inc);
      added++;
    } else if (cur.adjudicated_at) {
      kept++;
    } else {
      byId.set(inc.event_id, inc);
      refreshed++;
    }
  }
  return { events: [...byId.values()], added, kept, refreshed };
}

/** Parses either a draft/export payload or a bare array of events. */
export function parseImport(text: string): EventLabel[] {
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : data.events;
  if (!Array.isArray(rows)) throw new Error("no events in that payload");
  return rows as EventLabel[];
}

/**
 * An event that did not come from the incident importer — a partner report, a
 * court order, something an analyst found. Everything unset rather than
 * guessed, so `needs_review` is honest about what has not been entered.
 */
export function blankEvent(event_id: string): EventLabel {
  return {
    event_id,
    incident_id: null,
    slug: null,
    title: "",
    probe_cc: "",
    asn_scope: [],
    asn_scope_kind: "unknown",
    target_set: [],
    target_set_kind: "unknown",
    mechanisms: [],
    mechanism_taxonomy: MECHANISM_TAXONOMY,
    onset_earliest: null,
    onset_latest: null,
    resolution_earliest: null,
    resolution_latest: null,
    event_class: "true_event",
    scoreable: "unknown",
    confidence: "probable",
    source: "internal_analysis",
    source_urls: [],
    corroborators: [],
    test_names: [],
    adjudicated_at: null,
    rationale: "",
    added_at: new Date().toISOString(),
    superseded_by: null,
    supersede_reason: null,
    import_source: "manual",
    needs_review: ["entered by hand: scope, bracket and source are unverified"],
  };
}

export const outstandingNote = (events: EventLabel[]): string => {
  const done = events.filter(isComplete).length;
  return `${done} complete · ${events.length - done} outstanding`;
};
