import { useEffect, useRef, useState } from "react";
import type { LabelerState } from "./types";

export interface ExportDialogProps {
  open: boolean;
  state: LabelerState;
  onClose: () => void;
}

export default function ExportDialog({ open, state, onClose }: ExportDialogProps) {
  const dlgRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copyLabel, setCopyLabel] = useState("Copy to clipboard");

  const live = state.labels.filter((l) => !l.superseded_by).length;
  const payload = {
    export_version: "1",
    exported_at: new Date().toISOString(),
    adjudicator: state.adjudicator,
    note:
      "Per-measurement labels. Sampling designs included so weights are reconstructable. " +
      "Superseded labels retained deliberately.",
    sampling_designs: state.designs,
    labels: state.labels,
  };
  const text = JSON.stringify(payload, null, 2);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      textRef.current?.select();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

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

  return (
    <dialog id="expDlg" ref={dlgRef} onCancel={onClose}>
      <span className="eyebrow">Export</span>
      <h3 style={{ margin: "4px 0 6px" }}>Your labels</h3>
      <p className="hint" style={{ color: "var(--dim)" }}>
        Select all and copy. This is the whole corpus contribution for this browser — sampling design
        included, so the weights stay reconstructable.
      </p>
      <textarea id="expText" rows={16} readOnly ref={textRef} value={text} />
      <div className="row spread" style={{ marginTop: 12 }}>
        <span className="stat">
          {live} live · {state.labels.length - live} superseded
        </span>
        <div className="row">
          <button className="btn" type="button" onClick={copy}>
            {copyLabel}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
