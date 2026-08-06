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
        <span className="eyebrow">Measurement adjudication</span>
        <h1>Who is labelling?</h1>
        <p>
          Your name goes on every label you commit, so disagreements stay traceable. Labels are
          kept in this browser only — nothing is written back to OONI. Export them when you finish
          a session.
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
            {resumeCount} label{resumeCount === 1 ? "" : "s"} already in this browser. Starting will
            resume that session.
          </p>
        )}
      </div>
    </div>
  );
}
