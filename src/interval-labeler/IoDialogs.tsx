import { useEffect, useRef, useState } from "react";
import type { IntervalLabelerState } from "./types";

/**
 * Export out, event corpus in. Both by copy-paste: the interval grain is
 * stored exactly like the other two, in the browser and nowhere else, so there
 * is still no write endpoint and no auth surface.
 */

export function exportPayload(S: IntervalLabelerState) {
  return {
    export_version: "1",
    grain: "interval",
    exported_at: new Date().toISOString(),
    adjudicator: S.adjudicator,
    note:
      "Quiet-interval labels, one per detector cell-week. Sampling designs " +
      "included, so the weights are reconstructable from this file alone: " +
      "the false-alarm rate is a Horvitz–Thompson estimate over the frame, " +
      "not a count over these rows. Superseded rows retained deliberately.",
    sampling_designs: S.designs,
    intervals: S.labels,
  };
}

export function ExportDialog({
  open,
  state,
  onClose,
}: {
  open: boolean;
  state: IntervalLabelerState;
  onClose: () => void;
}) {
  const dlgRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copyLabel, setCopyLabel] = useState("Copy to clipboard");

  const live = state.labels.filter((l) => !l.superseded_by).length;
  const text = JSON.stringify(exportPayload(state), null, 2);

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
      <h3 style={{ margin: "4px 0 6px" }}>Your intervals</h3>
      <p className="hint" style={{ color: "var(--dim)" }}>
        Feed this to <code>docs/detector-evaluation.ipynb</code> in the pipeline repo. Weights
        and design come with it, because a rate computed by counting these rows would describe the
        queue rather than the network.
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

export function ImportEventsDialog({
  open,
  count,
  onClose,
  onImport,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onImport: (text: string) => string;
}) {
  const dlgRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setMsg("");
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  return (
    <dialog id="impDlg" ref={dlgRef} onCancel={onClose}>
      <span className="eyebrow">Import</span>
      <h3 style={{ margin: "4px 0 6px" }}>Event corpus</h3>
      <p className="hint" style={{ color: "var(--dim)" }}>
        Paste an export from the event labeller. Cell-weeks that overlap a known event get
        flagged in the queue, so a real event does not sit unnoticed inside a week you are about
        to call quiet. This is external ground truth, not detector output, so seeing it before
        you commit is not unblinding. {count > 0 && <b>{count} events loaded.</b>}
      </p>
      <textarea rows={12} ref={textRef} placeholder="{ &quot;events&quot;: [ … ] }" />
      <div className="row spread" style={{ marginTop: 12 }}>
        <span className="stat">{msg}</span>
        <div className="row">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setMsg(onImport(textRef.current?.value || ""))}
          >
            Import
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
