import { useMemo } from "react";
import Timeline, { type Marker, type TimelineMode, type ZoomRange } from "../event-labeler/Timeline";
import { assignOutcomeColors, outcomeLabel } from "../event-labeler/outcomes";
import type { CellSeries } from "./api";
import type { IntervalRow } from "./types";
import type { Overlap } from "./overlap";

export interface CellPaneProps {
  row: IntervalRow;
  series: CellSeries | null;
  loading: boolean;
  error: string | null;
  overlaps: Overlap[];
  corpusLoaded: boolean;
  grain: "hour" | "day";
  padDays: number;
  mode: TimelineMode;
  zoom: ZoomRange | null;
  markers: Marker[];
  onGrain: (g: "hour" | "day") => void;
  onPadDays: (d: number) => void;
  onMode: (m: TimelineMode) => void;
  onZoom: (z: ZoomRange | null) => void;
  onReload: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// The week is drawn using the timeline's existing onset bracket: it takes
// datetime-local strings, and a fixed pair of them renders exactly the wash
// and edges this view needs. `armed` stays null, so the chart is read-only
// here — clicks cannot move a bound that nothing owns.
const toBound = (iso: string): string => {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
};

const stamp = (iso: string) => iso.slice(0, 10);

export default function CellPane(props: CellPaneProps) {
  const { row, series } = props;
  const colors = useMemo(() => assignOutcomeColors(series?.outcomes || []), [series?.outcomes]);

  const bounds = {
    onset_earliest: toBound(row.window_start),
    onset_latest: toBound(row.window_end),
    resolution_earliest: "",
    resolution_latest: "",
  };

  return (
    <div className="cell-pane">
      <div className="subject">
        <h2>
          {row.domain} <span className="dim">on</span> AS{row.probe_asn}{" "}
          <span className="dim">in</span> {row.probe_cc}
        </h2>
        <div className="stat">
          week of <b>{stamp(row.window_start)}</b> → {stamp(row.window_end)} ·{" "}
          <b>{row.measurements_in_window.toLocaleString()}</b> measurements ·{" "}
          {/* Band, not a hidden covariate: quiet time is cheap in thin cells
              and expensive in busy ones, so a pooled rate hides which kind of
              cell it is describing. */}
          volume band <b>{row.volume_band}</b>
        </div>
      </div>

      {props.corpusLoaded && props.overlaps.length > 0 && (
        <div className="banner warn">
          <b>A known event overlaps this window.</b> Commit <code>event_present</code> rather
          than skipping the row — dropping it shrinks the denominator with nothing on the
          record to say so.
          <ul>
            {props.overlaps.map((o) => (
              <li key={o.event_id}>
                {o.title} <span className="dim">({o.event_class}; {o.scope_note})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="seg-group tight" style={{ display: "flex", gap: 0, marginBottom: 8 }}>
        <button
          className={"btn" + (props.grain === "hour" ? " btn-primary" : "")}
          aria-pressed={props.grain === "hour"}
          onClick={() => props.onGrain("hour")}
          type="button"
        >
          hourly
        </button>
        <button
          className={"btn" + (props.grain === "day" ? " btn-primary" : "")}
          aria-pressed={props.grain === "day"}
          onClick={() => props.onGrain("day")}
          type="button"
        >
          daily
        </button>
        <button
          className={"btn" + (props.mode === "count" ? " btn-primary" : "")}
          aria-pressed={props.mode === "count"}
          onClick={() => props.onMode("count")}
          type="button"
          title="absolute observation counts"
        >
          count
        </button>
        <button
          className={"btn" + (props.mode === "share" ? " btn-primary" : "")}
          aria-pressed={props.mode === "share"}
          onClick={() => props.onMode("share")}
          type="button"
          title="normalised per bucket, with a volume rail underneath"
        >
          share
        </button>
        <select
          className="btn"
          value={props.padDays}
          onChange={(e) => props.onPadDays(Number(e.target.value))}
          title="context either side of the week"
        >
          {[3, 7, 14, 28].map((d) => (
            <option key={d} value={d}>
              ±{d}d
            </option>
          ))}
        </select>
        <button className="btn" onClick={props.onReload} type="button">
          Reload
        </button>
      </div>

      {props.loading && <div className="banner">Loading the cell…</div>}
      {!props.loading && props.error && (
        <div className="banner err">Could not load: {props.error}</div>
      )}

      {!props.loading && !props.error && series && (
        <>
          <Timeline
            facets={series.facets}
            outcomes={series.outcomes}
            colors={colors}
            mode={props.mode}
            bounds={bounds}
            armed={null}
            onSetBound={() => {}}
            onArm={() => {}}
            zoom={props.zoom}
            onZoom={props.onZoom}
            markers={props.markers}
          />
          {props.zoom && (
            <div className="zoom-bar">
              <span className="eyebrow">zoomed</span>
              <button className="btn" type="button" onClick={() => props.onZoom(null)}>
                Reset zoom
              </button>
            </div>
          )}
          <div className="legend">
            {series.outcomes.map((o) => (
              <span key={o}>
                <i className="swatch" style={{ background: colors[o] }} />
                {outcomeLabel(o)}
              </span>
            ))}
          </div>
          <div className="stat" style={{ marginTop: 6 }}>
            {series.note} · the shaded band is the week being judged
          </div>
        </>
      )}
    </div>
  );
}
