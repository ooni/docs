import type { EventLabel } from "../event-labeler/types";
import type { IntervalRow } from "./types";

/**
 * The contamination cross-check: does a known, adjudicated event land inside a
 * cell-week we are about to call quiet?
 *
 * An unreported real event inside a "quiet" week biases the false-alarm rate
 * *upward*, which is the safe direction, so this is not a correctness
 * emergency. A *reported* one is a different matter: leaving it in the quiet
 * stratum charges the detector for being right. Dropping the row would be
 * worse — the denominator shrinks silently and nothing records why — so an
 * overlap is flagged, the analyst is expected to commit `event_present`, and
 * the ids are carried on the label.
 *
 * This deliberately reads the *event corpus*, not the detector. It is external
 * ground truth, so showing it before commit is not unblinding; showing an
 * alert would be.
 */

const parse = (v: unknown): number => {
  const s = String(v || "");
  if (!s) return NaN;
  return Date.parse(s.endsWith("Z") ? s : s + "Z");
};

export interface Overlap {
  event_id: string;
  title: string;
  event_class: string;
  /** Why it matched, so a wrong flag is arguable rather than mysterious. */
  scope_note: string;
}

/**
 * Scope kinds other than the enumerated ones mean "we do not know", and an
 * unknown scope that *might* cover this cell is exactly the case worth
 * surfacing. Matching them keeps the check conservative: it over-flags rather
 * than letting a real event through, and the analyst resolves it from the
 * chart.
 */
export function overlappingEvents(row: IntervalRow, events: unknown[]): Overlap[] {
  const wStart = parse(row.window_start);
  const wEnd = parse(row.window_end);
  const out: Overlap[] = [];

  for (const raw of events || []) {
    const e = raw as EventLabel;
    if (!e || typeof e !== "object" || !e.event_id) continue;
    if (e.superseded_by) continue;
    // An adjudicated false alarm overlapping a quiet week is corroboration,
    // not contamination.
    if (e.event_class === "false_positive_event") continue;
    if ((e.probe_cc || "").toUpperCase() !== row.probe_cc.toUpperCase()) continue;

    const asnListed = e.asn_scope_kind === "listed";
    if (asnListed && !(e.asn_scope || []).map(Number).includes(Number(row.probe_asn))) continue;

    const targetsListed = e.target_set_kind === "enumerated";
    if (targetsListed && !(e.target_set || []).includes(row.domain)) continue;

    // Widest defensible span: onset_earliest to resolution_latest, and an
    // unresolved event runs to now. A narrower reading would let an event that
    // started mid-week slip through on a bracket technicality.
    const start = parse(e.onset_earliest);
    if (isNaN(start)) continue;
    const end = e.resolution_latest ? parse(e.resolution_latest) : Infinity;
    if (start >= wEnd || end <= wStart) continue;

    out.push({
      event_id: e.event_id,
      title: e.title || e.slug || e.event_id,
      event_class: e.event_class || "true_event",
      scope_note:
        (asnListed ? `AS${row.probe_asn} listed` : `ASNs ${e.asn_scope_kind}`) +
        ", " +
        (targetsListed ? `${row.domain} listed` : `targets ${e.target_set_kind}`),
    });
  }
  return out;
}

/** Parses either an event export payload or a bare array. */
export function parseEventCorpus(text: string): unknown[] {
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : data.events;
  if (!Array.isArray(rows)) throw new Error("no events in that payload");
  return rows;
}
