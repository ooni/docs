import { useMemo } from "react";
import { bracketHours, ongoing, sizeBand } from "./derive";
import Timeline, { type BoundKey, type TimelineMode, type ZoomRange } from "./Timeline";
import { assignOutcomeColors, outcomeLabel } from "./outcomes";
import type { FacetMode, FacetSeries } from "./api";
import type { EventDraft, EventLabel } from "./types";

export interface EventPaneProps {
  event: EventLabel;
  draft: EventDraft;
  resolved: EventLabel;
  set: (patch: Partial<EventDraft>) => void;

  facets: FacetSeries[];
  outcomes: string[];
  seriesNote: string;
  seriesLoading: boolean;
  grain: "hour" | "day";
  padDays: number;
  mode: TimelineMode;
  facet: FacetMode;
  zoom: ZoomRange | null;
  onGrain: (g: "hour" | "day") => void;
  onPad: (d: number) => void;
  onMode: (m: TimelineMode) => void;
  onFacet: (f: FacetMode) => void;
  onZoom: (z: ZoomRange | null) => void;
  onLoadSeries: () => void;

  armed: BoundKey | null;
  onArm: (k: BoundKey | null) => void;
}

const zoomStamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

const BOUNDS: { key: BoundKey; label: string; picker: string }[] = [
  { key: "onset_earliest", label: "⟨ onset", picker: "onset — no earlier than" },
  { key: "onset_latest", label: "onset ⟩", picker: "onset — no later than" },
  { key: "resolution_earliest", label: "⟨ resolution", picker: "resolution — no earlier than (blank = ongoing)" },
  { key: "resolution_latest", label: "resolution ⟩", picker: "resolution — no later than" },
];

export default function EventPane(props: EventPaneProps) {
  const { event, draft, resolved, set, armed, onArm } = props;
  const colors = useMemo(() => assignOutcomeColors(props.outcomes), [props.outcomes]);

  const band = sizeBand(resolved);
  const inverted =
    !!resolved.onset_earliest &&
    !!resolved.onset_latest &&
    resolved.onset_earliest > resolved.onset_latest;
  const hours = bracketHours(resolved.onset_earliest, resolved.onset_latest);

  const bounds = {
    onset_earliest: draft.onset_earliest,
    onset_latest: draft.onset_latest,
    resolution_earliest: draft.resolution_earliest,
    resolution_latest: draft.resolution_latest,
  } as Record<BoundKey, string>;

  return (
    <>
      <div className="subject">
        <span className="eyebrow">Event</span>
        <h2>{event.title || event.event_id}</h2>
        <div className="meta">
          <span>
            event_id <b>{event.event_id}</b>
          </span>
          {event.incident_id && (
            <span>
              incident_id <b>{event.incident_id}</b>
            </span>
          )}
          {event.import_source && (
            <span>
              via <b>{event.import_source}</b>
            </span>
          )}
          {event.adjudicated_at && (
            <span>
              adjudicated <b>{event.adjudicated_at.slice(0, 16).replace("T", " ")}</b> by{" "}
              <b>{event.adjudicator}</b>
            </span>
          )}
          {event.source_urls?.[0] && (
            <span>
              <a href={event.source_urls[0]} target="_blank" rel="noopener">
                source ↗
              </a>
            </span>
          )}
        </div>
      </div>

      {(event.needs_review || []).map((w, i) => (
        <div className="review-flag" key={i}>
          {w}
        </div>
      ))}

      <fieldset>
        <legend>Scope</legend>
        <div className="row3">
          <label className="field">
            <span>probe_cc</span>
            <input
              type="text"
              maxLength={2}
              value={draft.probe_cc}
              onChange={(e) => set({ probe_cc: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="field">
            <span>asn_scope_kind</span>
            <select
              value={draft.asn_scope_kind}
              onChange={(e) => set({ asn_scope_kind: e.target.value as EventDraft["asn_scope_kind"] })}
            >
              <option value="all">all (national)</option>
              <option value="listed">listed</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
          <label className="field">
            <span>target_set_kind</span>
            <select
              value={draft.target_set_kind}
              onChange={(e) => set({ target_set_kind: e.target.value as EventDraft["target_set_kind"] })}
            >
              <option value="enumerated">enumerated</option>
              <option value="category">category</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>asn_scope — comma separated, only when kind = listed</span>
          <input
            type="text"
            placeholder="12345, 6789"
            disabled={draft.asn_scope_kind !== "listed"}
            value={draft.asn_scope}
            onChange={(e) => set({ asn_scope: e.target.value })}
          />
        </label>
        <label className="field">
          <span>target_set — domains, or category codes when kind = category</span>
          <input
            type="text"
            placeholder="telegram.org, www.facebook.com"
            disabled={draft.target_set_kind === "unknown"}
            value={draft.target_set}
            onChange={(e) => set({ target_set: e.target.value })}
          />
        </label>
        <div className="derived">
          size_band: {band}
          {band === "unknown" && " — the harness still scores it, stratified as unknown"}
        </div>
      </fieldset>

      <fieldset>
        <legend>When</legend>
        <div className="arm">
          {BOUNDS.map((b) => (
            <button
              type="button"
              key={b.key}
              className={"btn" + (armed === b.key ? " on" : "")}
              onClick={() => onArm(armed === b.key ? null : b.key)}
            >
              {b.label}
            </button>
          ))}
          <span className="muted">
            {armed
              ? `click the chart to set ${armed.replace(/_/g, " ")} · drag to zoom`
              : "click a bound, then click the chart · drag to zoom"}
          </span>
          <span style={{ flex: 1 }} />
          <select
            style={{ width: "auto" }}
            value={props.facet}
            onChange={(e) => props.onFacet(e.target.value as FacetMode)}
            title="split the chart into one panel per target or per ASN"
          >
            <option value="none">summed</option>
            <option value="target">by target</option>
            <option value="asn">by ASN</option>
          </select>
          <select
            style={{ width: "auto" }}
            value={props.grain}
            onChange={(e) => props.onGrain(e.target.value as "hour" | "day")}
          >
            <option value="hour">hourly</option>
            <option value="day">daily</option>
          </select>
          <select
            style={{ width: "auto" }}
            value={String(props.padDays)}
            onChange={(e) => props.onPad(Number(e.target.value))}
          >
            <option value="7">±7d</option>
            <option value="14">±14d</option>
            <option value="30">±30d</option>
          </select>
          <div className="seg-group tight">
            <button
              type="button"
              className="btn"
              aria-pressed={props.mode === "count"}
              onClick={() => props.onMode("count")}
              title="observations per bucket"
            >
              count
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={props.mode === "share"}
              onClick={() => props.onMode("share")}
              title="each bucket normalised to 100%, with a volume rail underneath"
            >
              share
            </button>
          </div>
          <button type="button" className="btn" onClick={props.onLoadSeries}>
            Load series
          </button>
        </div>

        <Timeline
          facets={props.facets}
          outcomes={props.outcomes}
          colors={colors}
          mode={props.mode}
          bounds={bounds}
          armed={armed}
          onArm={onArm}
          onSetBound={(k, v) => set({ [k]: v } as Partial<EventDraft>)}
          zoom={props.zoom}
          onZoom={props.onZoom}
        />

        {props.zoom && (
          <div className="zoom-bar">
            <span className="eyebrow">Zoomed</span>
            <span className="stat">
              {zoomStamp(props.zoom.lo)} → {zoomStamp(props.zoom.hi)}
            </span>
            <button type="button" className="btn" onClick={() => props.onZoom(null)}>
              Reset zoom
            </button>
          </div>
        )}

        <div className="legend">
          {props.outcomes.map((o) => (
            <span key={o}>
              <i className="swatch" style={{ background: colors[o] }} />
              {outcomeLabel(o)}
            </span>
          ))}
          <span>
            <i className="swatch" style={{ background: "var(--probe)", opacity: 0.35 }} />
            onset bracket
          </span>
          <span>
            <i className="swatch" style={{ background: "var(--sealed)", opacity: 0.35 }} />
            resolution bracket
          </span>
        </div>
        <div className="legend">
          <span>{props.seriesLoading ? "loading…" : props.seriesNote || "press Load series"}</span>
        </div>

        <div className="row2" style={{ marginTop: 10 }}>
          {BOUNDS.map((b) => (
            <label className="field" key={b.key}>
              <span>{b.picker}</span>
              <div className="bound-row">
                <input
                  type="datetime-local"
                  value={draft[b.key]}
                  onFocus={() => onArm(b.key)}
                  onChange={(e) => set({ [b.key]: e.target.value } as Partial<EventDraft>)}
                />
                <button
                  type="button"
                  className="btn clear"
                  title={`clear ${b.key.replace(/_/g, " ")}`}
                  disabled={!draft[b.key]}
                  onClick={() => {
                    set({ [b.key]: "" } as Partial<EventDraft>);
                    onArm(b.key);
                  }}
                >
                  ✕
                </button>
              </div>
            </label>
          ))}
        </div>

        <div className={inverted ? "derived warn" : "derived"}>
          {inverted
            ? "⚠ onset_earliest is after onset_latest — the editor will refuse this"
            : hours != null
              ? `onset bracket: ${hours}h wide · ongoing: ${ongoing(resolved)}`
              : `ongoing: ${ongoing(resolved)} — a bracket with both arms is what latency is measured against`}
        </div>
      </fieldset>

      <fieldset>
        <legend>Evidence</legend>
        <div className="row2">
          <label className="field">
            <span>source</span>
            <select
              value={draft.source}
              onChange={(e) => set({ source: e.target.value as EventDraft["source"] })}
            >
              <option value="ooni_report">ooni_report</option>
              <option value="partner">partner</option>
              <option value="press">press</option>
              <option value="operator">operator</option>
              <option value="court_order">court_order</option>
              <option value="internal_analysis">internal_analysis</option>
            </select>
          </label>
          <label className="field">
            <span>corroborators — comma separated</span>
            <input
              type="text"
              placeholder="ioda, censoredplanet"
              value={draft.corroborators}
              onChange={(e) => set({ corroborators: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span>source_urls — one per line</span>
          <textarea
            rows={3}
            value={draft.source_urls}
            onChange={(e) => set({ source_urls: e.target.value })}
          />
        </label>
      </fieldset>
    </>
  );
}
