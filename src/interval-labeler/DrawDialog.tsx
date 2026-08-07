import { useEffect, useRef, useState } from "react";
import { drawIntervalSample } from "./api";
import type { IntervalSampleResponse } from "./types";

export interface DrawDialogProps {
  open: boolean;
  apiBase: string;
  onClose: () => void;
  onDrawn: (data: IntervalSampleResponse) => void;
  onGuideLink: (anchor: string) => void;
}

const STRATA = [
  {
    value: "detector_alerted",
    label: "detector_alerted — weeks the incumbent fired in",
    defaultChecked: true,
  },
  {
    value: "random_covered",
    label: "random_covered — the denominator, keep this in",
    defaultChecked: true,
  },
  {
    value: "near_miss",
    label: "near_miss — didn't alert, but something scored blocked-leaning",
    defaultChecked: false,
  },
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export default function DrawDialog({ open, apiBase, onClose, onDrawn, onGuideLink }: DrawDialogProps) {
  const dlgRef = useRef<HTMLDialogElement>(null);

  const [replicate, setReplicate] = useState(1);
  const [limit, setLimit] = useState(30);
  const [cc, setCc] = useState("");
  const [domain, setDomain] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [minMeasurements, setMinMeasurements] = useState(20);
  const [domainList, setDomainList] = useState<"detector" | "all">("detector");
  const [selectedStrata, setSelectedStrata] = useState<Set<string>>(
    new Set(STRATA.filter((s) => s.defaultChecked).map((s) => s.value))
  );
  const [err, setErr] = useState("");
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      const today = new Date();
      // four weeks by default. The frame is snapped to whole ISO weeks
      // server-side, so a partial week at either end never enters it.
      setUntil(isoDate(today));
      setSince(isoDate(new Date(today.getTime() - 24 * 864e5)));
      setErr("");
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const draw = async () => {
    if (!selectedStrata.size) {
      setErr("Pick at least one stratum.");
      return;
    }
    setDrawing(true);
    setErr("Drawing…");
    try {
      const data = await drawIntervalSample(apiBase, {
        strata: [...selectedStrata],
        replicate,
        limit,
        since,
        until,
        probeCC: cc.trim() || undefined,
        domain: domain.trim() || undefined,
        domainList,
        minMeasurements,
      });
      if (!data.rows.length) {
        setErr("No cell-weeks matched. Widen the frame or lower the volume floor.");
        return;
      }
      onDrawn(data);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setDrawing(false);
    }
  };

  return (
    <dialog id="drawDlg" ref={dlgRef} onCancel={onClose}>
      <span className="eyebrow">New queue</span>
      <h3 style={{ margin: "4px 0 14px" }}>Draw cell-weeks</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label className="field">
          <span>
            Replicate
            <a
              href="#g-design"
              className="guide-link"
              style={{ float: "right", fontSize: 11, color: "var(--dim)" }}
              onClick={(e) => {
                e.preventDefault();
                onGuideLink("#g-design");
              }}
            >
              what is this?
            </a>
          </span>
          <input type="number" min={1} value={replicate} onChange={(e) => setReplicate(Number(e.target.value) || 1)} />
        </label>
        <label className="field">
          <span>Rows</span>
          <input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 1)} />
        </label>
        <label className="field">
          <span>Country (optional)</span>
          <input type="text" placeholder="TZ" maxLength={2} value={cc} onChange={(e) => setCc(e.target.value)} />
        </label>
        <label className="field">
          <span>Domain (optional)</span>
          <input type="text" placeholder="telegram.org" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Volume floor
            <a
              href="#g-frame"
              className="guide-link"
              style={{ float: "right", fontSize: 11, color: "var(--dim)" }}
              onClick={(e) => {
                e.preventDefault();
                onGuideLink("#g-frame");
              }}
            >
              why
            </a>
          </span>
          <input
            type="number"
            min={1}
            value={minMeasurements}
            onChange={(e) => setMinMeasurements(Number(e.target.value) || 1)}
          />
        </label>
        <label className="field">
          <span>Domains</span>
          <select value={domainList} onChange={(e) => setDomainList(e.target.value as "detector" | "all")}>
            <option value="detector">what the detector watches</option>
            <option value="all">every domain</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Strata</span>
        <select
          multiple
          size={3}
          style={{ fontFamily: "var(--mono)" }}
          value={[...selectedStrata]}
          onChange={(e) => {
            const opts = [...e.target.selectedOptions].map((o) => o.value);
            setSelectedStrata(new Set(opts));
          }}
        >
          {STRATA.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint" style={{ color: "var(--dim)" }}>
        Keep <b>random_covered</b> in. The alerted stratum on its own estimates the incumbent's
        precision <i>given that it fired</i> — a number about alerts, not about quiet time — and a
        candidate detector's alerts in cells the incumbent never flagged would land on weeks nobody
        adjudicated, so its false alarms would be invisible by construction. The strata partition
        the frame, so whichever subset you pick, every cell-week in it belongs to exactly one and
        the weights stay valid.
      </p>
      <div className="row spread" style={{ marginTop: 14 }}>
        <span className="stat" style={{ color: "var(--diverge)" }}>
          {err}
        </span>
        <div className="row">
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn btn-primary" disabled={drawing} onClick={draw} type="button">
            Draw
          </button>
        </div>
      </div>
    </dialog>
  );
}
