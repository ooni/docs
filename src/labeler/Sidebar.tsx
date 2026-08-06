import type { QueueRow } from "./types";

export interface SidebarProps {
  queue: QueueRow[];
  isLabelled: (uid: string) => boolean;
  cursor: number;
  onSelectRow: (i: number) => void;
  onDraw: () => void;
  designNote: string | null;
  labelCounts: Record<string, number>;
  totalLive: number;
  onExport: () => void;
  onGuide: () => void;
}

export default function Sidebar({
  queue,
  isLabelled,
  cursor,
  onSelectRow,
  onDraw,
  designNote,
  labelCounts,
  totalLive,
  onExport,
  onGuide,
}: SidebarProps) {
  const done = queue.filter((r) => isLabelled(r.measurement_uid)).length;
  const pct = queue.length ? (100 * done) / queue.length : 0;

  return (
    <aside>
      <div className="rail-h">
        <span className="eyebrow">Queue</span>
        <span className="stat">{queue.length ? `${done}/${queue.length}` : "0"}</span>
      </div>
      <div className="progress">
        <i style={{ width: pct + "%" }} />
      </div>
      {designNote && (
        <div className="stat" style={{ marginBottom: 8 }} dangerouslySetInnerHTML={{ __html: designNote }} />
      )}
      <div id="queue">
        {queue.map((r, i) => {
          const d = isLabelled(r.measurement_uid);
          return (
            <div
              key={r.measurement_uid}
              className={"qrow" + (i === cursor ? " active" : "") + (d ? " done" : "")}
              onClick={() => onSelectRow(i)}
            >
              <span className="tick">{d ? "✓" : "·"}</span>
              <span className="nm">{r.domain || r.input || r.measurement_uid.slice(0, 14)}</span>
            </div>
          );
        })}
      </div>
      <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={onDraw}>
        Draw a queue
      </button>

      <div className="rail-h" style={{ marginTop: 22 }}>
        <span className="eyebrow">Session</span>
      </div>
      <div className="stat">
        {Object.keys(labelCounts).length ? (
          Object.entries(labelCounts).map(([k, v]) => (
            <div key={k}>
              {k} <b>{v}</b>
            </div>
          ))
        ) : (
          <div>No labels yet.</div>
        )}
        <br />
        total <b>{totalLive}</b>
      </div>
      <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={onExport}>
        Export labels
      </button>
      <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={onGuide}>
        Guide <kbd style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: 0.6 }}>?</kbd>
      </button>
    </aside>
  );
}
