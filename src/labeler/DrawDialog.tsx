import { useEffect, useRef, useState } from "react";
import { drawSample, fetchTestNames } from "./api";
import type { SampleResponse, TestNameInfo } from "./types";

export interface DrawDialogProps {
  open: boolean;
  apiBase: string;
  onClose: () => void;
  onDrawn: (data: SampleResponse) => void;
  onGuideLink: (anchor: string) => void;
}

const STRATA = [
  { value: "screen_positive", label: "screen_positive — 40% of queue", defaultChecked: true },
  { value: "screen_negative", label: "screen_negative — 35% of queue", defaultChecked: true },
  { value: "fingerprint_match", label: "fingerprint_match — 15% of queue", defaultChecked: false },
  {
    value: "incident_window",
    label: "incident_window — 10% of queue (needs cc + domain)",
    defaultChecked: false,
  },
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export default function DrawDialog({ open, apiBase, onClose, onDrawn, onGuideLink }: DrawDialogProps) {
  const dlgRef = useRef<HTMLDialogElement>(null);

  const [replicate, setReplicate] = useState(1);
  const [limit, setLimit] = useState(40);
  const [cc, setCc] = useState("");
  const [domain, setDomain] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [tests, setTests] = useState<TestNameInfo[]>([]);
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set(["web_connectivity"]));
  const [testHint, setTestHint] = useState("");
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
      const monthAgo = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
      setUntil(isoDate(today));
      setSince(isoDate(monthAgo));
      setErr("");
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const loadTestNames = async (sinceV: string, untilV: string, ccV: string) => {
    if (!sinceV || !untilV) return;
    setTestHint("loading…");
    try {
      const list = await fetchTestNames(apiBase, { since: sinceV, until: untilV, probeCC: ccV || undefined });
      if (!list.length) {
        setTestHint("none in this frame");
        setTests([]);
        return;
      }
      setTests(list);
      setSelectedTests((prev) => {
        const keep = new Set([...prev].filter((t) => list.some((l) => l.test_name === t)));
        if (!keep.size) keep.add(list[0].test_name);
        return keep;
      });
      setTestHint(`${list.length} available, by volume`);
    } catch {
      setTestHint("could not load — using web_connectivity");
    }
  };

  // Reload the test list whenever the frame or country changes — counts are
  // frame-scoped, and a test with volume last month may have none this week.
  useEffect(() => {
    if (open) loadTestNames(since, until, cc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, since, until, cc]);

  const draw = async () => {
    if (!selectedStrata.size) {
      setErr("Pick at least one stratum.");
      return;
    }
    if (!selectedTests.size) {
      setErr("Pick at least one test.");
      return;
    }
    setDrawing(true);
    setErr("Drawing…");
    try {
      const data = await drawSample(apiBase, {
        strata: [...selectedStrata],
        testNames: [...selectedTests],
        replicate,
        limit,
        since,
        until,
        probeCC: cc.trim() || undefined,
        domain: domain.trim() || undefined,
      });
      if (!data.rows.length) {
        setErr("No rows matched. Widen the frame.");
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
      <h3 style={{ margin: "4px 0 14px" }}>Draw a stratified sample</h3>
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
          <input type="text" placeholder="IT" maxLength={2} value={cc} onChange={(e) => setCc(e.target.value)} />
        </label>
        <label className="field">
          <span>Domain (optional)</span>
          <input type="text" placeholder="archive.ph" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>
          Tests <span className="stat" style={{ float: "right" }}>{testHint}</span>
        </span>
        <select
          multiple
          size={Math.min(8, Math.max(3, tests.length || 1))}
          style={{ fontFamily: "var(--mono)" }}
          value={[...selectedTests]}
          onChange={(e) => {
            const opts = [...e.target.selectedOptions].map((o) => o.value);
            setSelectedTests(new Set(opts));
          }}
        >
          {(tests.length ? tests : [{ test_name: "web_connectivity", measurements: 0, screen_positive: 0 }]).map(
            (t) => (
              <option key={t.test_name} value={t.test_name}>
                {tests.length
                  ? `${t.test_name}  ·  ${t.measurements.toLocaleString()} msm  ·  ${t.screen_positive.toLocaleString()} screen+`
                  : t.test_name}
              </option>
            )
          )}
        </select>
      </label>
      <label className="field">
        <span>Strata</span>
        <select
          multiple
          size={4}
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
        Keep <b>screen_negative</b> in. It is the only stratum that bounds false negatives, and it is
        small enough to feel skippable. The design ID is derived from these settings, so changing any
        of them gives you a new one automatically — raise <b>replicate</b> when you want fresh rows from
        the <i>same</i> settings, which is the way to get a new queue without splitting your corpus
        across designs. The date range is the <b>frame</b>: rows are spread across it, so a wide frame
        gives a varied queue and a corpus that is not just about last month.
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
