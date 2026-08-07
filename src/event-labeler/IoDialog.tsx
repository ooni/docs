import { useEffect, useRef, useState } from "react";
import { exportPayload, mergeImport, outstandingNote, parseImport } from "./io";
import type { EventLabel, EventLabelerState } from "./types";

export interface IoDialogProps {
  open: boolean;
  mode: "import" | "export";
  state: EventLabelerState;
  onClose: () => void;
  onImported: (events: EventLabel[]) => void;
}

export default function IoDialog({ open, mode, state, onClose, onImported }: IoDialogProps) {
  const dlgRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copyLabel, setCopyLabel] = useState("Copy to clipboard");
  const [paste, setPaste] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const text = mode === "export" ? JSON.stringify(exportPayload(state), null, 2) : paste;

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      setStatus(null);
      if (mode === "export") textRef.current?.select();
      else {
        setPaste("");
        textRef.current?.focus();
      }
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, mode]);

  const copy = async () => {
    textRef.current?.select();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand("copy");
    }
    setCopyLabel("Copied");
    setTimeout(() => setCopyLabel("Copy to clipboard"), 1600);
  };

  const load = () => {
    let incoming: EventLabel[];
    try {
      incoming = parseImport(paste);
    } catch (e: any) {
      setStatus(String(e?.message || e) === "no events in that payload" ? "no events in that payload" : "not valid JSON");
      return;
    }
    if (!incoming.length) return setStatus("no events in that payload");
    const r = mergeImport(state.events, incoming);
    onImported(r.events);
    setStatus(
      `${r.added} new · ${r.refreshed} refreshed · ${r.kept} already adjudicated and left alone`
    );
  };

  return (
    <dialog ref={dlgRef} onCancel={onClose}>
      <span className="eyebrow">{mode === "export" ? "Export" : "Import"}</span>
      <h3 style={{ margin: "4px 0 6px" }}>
        {mode === "export" ? "Your events" : "Paste a draft or a previous export"}
      </h3>
      <p className="hint" style={{ color: "var(--dim)" }}>
        {mode === "export"
          ? "Select all and copy. This is the whole event-grain contribution for this browser; " +
            "docs/detector-evaluation.ipynb reads exactly this file."
          : "Drafts come from scripts/incidents_to_events.py. Import merges by event_id and leaves " +
            "rows you have already adjudicated alone, so a refreshed draft costs you nothing."}
      </p>
      <textarea
        rows={16}
        ref={textRef}
        readOnly={mode === "export"}
        value={text}
        onChange={(e) => setPaste(e.target.value)}
      />
      <div className="row spread" style={{ marginTop: 12 }}>
        <span className="stat">{status ?? outstandingNote(state.events)}</span>
        <div className="row">
          {mode === "export" ? (
            <button className="btn" type="button" onClick={copy}>
              {copyLabel}
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={load}>
              Load pasted
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
