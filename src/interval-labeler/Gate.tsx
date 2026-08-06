import { useState } from "react";

export interface GateProps {
  initialWho: string;
  initialApiBase: string;
  resumeCount: number;
  onStart: (who: string, apiBase: string) => void;
  onGuide: () => void;
}

export default function Gate({ initialWho, initialApiBase, resumeCount, onStart, onGuide }: GateProps) {
  const [who, setWho] = useState(initialWho);
  const [apiBase, setApiBase] = useState(initialApiBase);

  const start = () => {
    const trimmed = who.trim();
    if (!trimmed) return;
    onStart(trimmed, apiBase.trim() || initialApiBase);
  };

  return (
    <div id="gate">
      <div className="gate-card">
        <span className="eyebrow">Quiet-interval adjudication</span>
        <h1>Who is labelling?</h1>
        <p>
          One cell-week at a time: did anything change on this network, for this domain, in this
          week? Most weeks nothing did, and that is the point — a false-alarm rate needs the
          silent weeks counted, and they only count if they were sampled from a frame. Your name
          goes on every row you commit. Nothing is written back to OONI; export when you finish.
        </p>
        <label className="field">
          <span>Adjudicator</span>
          <input
            type="text"
            placeholder="e.g. john"
            autoComplete="off"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") start();
            }}
          />
        </label>
        <label className="field">
          <span>API base</span>
          <input type="text" value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={start}>
          Start labelling
        </button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={onGuide}>
          Read the guide
        </button>
        {resumeCount > 0 && (
          <p className="hint" style={{ marginTop: 14, color: "var(--dim)" }}>
            {resumeCount} interval{resumeCount === 1 ? "" : "s"} already in this browser. Starting
            will resume that session.
          </p>
        )}
      </div>
    </div>
  );
}
