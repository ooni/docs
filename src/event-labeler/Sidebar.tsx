import { useState } from "react";
import { isComplete } from "./derive";
import type { EventLabel } from "./types";

export interface SidebarProps {
  events: EventLabel[];
  cursor: number;
  onSelect: (i: number) => void;
  onImport: () => void;
  onExport: () => void;
  onNew: () => void;
  onGuide: () => void;
}

export default function Sidebar({
  events,
  cursor,
  onSelect,
  onImport,
  onExport,
  onNew,
  onGuide,
}: SidebarProps) {
  const [filter, setFilter] = useState("");

  const done = events.filter(isComplete).length;
  const pct = events.length ? (100 * done) / events.length : 0;
  const f = filter.trim().toLowerCase();

  const classCounts: Record<string, number> = {};
  events.filter(isComplete).forEach((e) => {
    classCounts[e.event_class] = (classCounts[e.event_class] || 0) + 1;
  });

  return (
    <aside>
      <div className="rail-h">
        <span className="eyebrow">Event corpus</span>
        <span className="stat">{events.length ? `${done}/${events.length}` : "0"}</span>
      </div>
      <div className="progress">
        <i style={{ width: pct + "%" }} />
      </div>

      <input
        type="text"
        placeholder="filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 8 }}
      />

      <div id="queue">
        {events.map((e, i) => {
          const hay = `${e.probe_cc} ${e.title || ""} ${(e.target_set || []).join(" ")}`.toLowerCase();
          if (f && !hay.includes(f)) return null;
          const d = isComplete(e);
          return (
            <div
              key={e.event_id}
              className={"qrow" + (i === cursor ? " active" : "") + (d ? " done" : "")}
              onClick={() => onSelect(i)}
              title={e.title || e.event_id}
            >
              <span className="tick">{d ? "✓" : "·"}</span>
              <span className="nm">
                {e.probe_cc || "??"} · {e.title || e.event_id}
              </span>
            </div>
          );
        })}
      </div>

      <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={onImport}>
        Import a draft
      </button>
      <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={onNew}>
        New event
      </button>

      <div className="rail-h" style={{ marginTop: 22 }}>
        <span className="eyebrow">Adjudicated</span>
      </div>
      <div className="stat">
        {Object.keys(classCounts).length ? (
          Object.entries(classCounts).map(([k, v]) => (
            <div key={k}>
              {k} <b>{v}</b>
            </div>
          ))
        ) : (
          <div>Nothing adjudicated yet.</div>
        )}
        <br />
        outstanding <b>{events.length - done}</b>
      </div>

      <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={onExport}>
        Export events
      </button>
      <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={onGuide}>
        Guide <kbd style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: 0.6 }}>?</kbd>
      </button>
    </aside>
  );
}
