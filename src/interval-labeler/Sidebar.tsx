import { cellKey, type IntervalRow } from "./types";

export interface SidebarProps {
  queue: IntervalRow[];
  isLabelled: (r: IntervalRow) => boolean;
  hasOverlap: (r: IntervalRow) => boolean;
  cursor: number;
  onSelectRow: (i: number) => void;
  onDraw: () => void;
  designNote: string | null;
  verdictCounts: Record<string, number>;
  totalLive: number;
  corpusNote: string;
  onImportEvents: () => void;
  onExport: () => void;
  onGuide: () => void;
}

export default function Sidebar(props: SidebarProps) {
  const done = props.queue.filter(props.isLabelled).length;
  const pct = props.queue.length ? (100 * done) / props.queue.length : 0;

  return (
    <aside>
      <div className="rail-h">
        <span className="eyebrow">Queue</span>
        <span className="stat">{props.queue.length ? `${done}/${props.queue.length}` : "0"}</span>
      </div>
      <div className="progress">
        <i style={{ width: pct + "%" }} />
      </div>
      {props.designNote && (
        <div className="stat" style={{ marginBottom: 8 }} dangerouslySetInnerHTML={{ __html: props.designNote }} />
      )}
      <div id="queue">
        {props.queue.map((r, i) => {
          const d = props.isLabelled(r);
          return (
            <div
              key={cellKey(r)}
              className={"qrow" + (i === props.cursor ? " active" : "") + (d ? " done" : "")}
              onClick={() => props.onSelectRow(i)}
              // No stratum in the title either: the queue is the one place a
              // careless tooltip would undo the blinding for the whole session.
              title={`${r.domain} · AS${r.probe_asn} · week of ${r.window_start.slice(0, 10)}`}
            >
              <span className="tick">{d ? "✓" : props.hasOverlap(r) ? "!" : "·"}</span>
              <span className="nm">
                {r.domain} <span className="dim">AS{r.probe_asn}</span>
              </span>
              <span className="stat">{r.window_start.slice(5, 10)}</span>
            </div>
          );
        })}
      </div>
      <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={props.onDraw}>
        Draw a queue
      </button>

      <div className="rail-h" style={{ marginTop: 22 }}>
        <span className="eyebrow">Session</span>
      </div>
      <div className="stat">
        {Object.keys(props.verdictCounts).length ? (
          Object.entries(props.verdictCounts).map(([k, v]) => (
            <div key={k}>
              {k} <b>{v}</b>
            </div>
          ))
        ) : (
          <div>No intervals yet.</div>
        )}
        <br />
        total <b>{props.totalLive}</b>
      </div>

      <div className="rail-h" style={{ marginTop: 22 }}>
        <span className="eyebrow">Event corpus</span>
      </div>
      <div className="stat">{props.corpusNote}</div>
      <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={props.onImportEvents}>
        Import events
      </button>

      <button className="btn" style={{ width: "100%", marginTop: 16 }} onClick={props.onExport}>
        Export intervals
      </button>
      <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={props.onGuide}>
        Guide <kbd style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: 0.6 }}>?</kbd>
      </button>
    </aside>
  );
}
