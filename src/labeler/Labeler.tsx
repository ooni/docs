import { useEffect, useRef, useState } from "react";
import "./labeler.css";
import Gate from "./Gate";
import Sidebar from "./Sidebar";
import DrawDialog from "./DrawDialog";
import ExportDialog from "./ExportDialog";
import CandidateView from "./CandidateView";
import JudgmentPanel, { type Draft, type FlowStep } from "./JudgmentPanel";
import Guide from "./Guide";
import { fetchCandidate, fetchContext, fetchReveal } from "./api";
import { addMechanism, MECHANISM_TAXONOMY } from "./mechanisms";
import { readState, uuid, writeState } from "./storage";
import {
  defaultState,
  type Candidate,
  type ContextResponse,
  type LabelerState,
  type LabelRecord,
  type QueueRow,
  type RevealResponse,
  type SampleResponse,
  type Verdict,
} from "./types";

interface CurrentRow {
  row: QueueRow;
  candidate: Candidate;
  context: ContextResponse | null;
}

const ROW_CACHE_MAX = 40;

const isLabelledIn = (state: LabelerState, uid: string): boolean =>
  state.labels.some((l) => l.measurement_uid === uid && !l.superseded_by);

function nextUnlabelledIndex(state: LabelerState, from: number): number {
  const { queue } = state;
  if (!queue.length) return -1;
  for (let i = 0; i < queue.length; i++) {
    const j = (from + i) % queue.length;
    if (!isLabelledIn(state, queue[j].measurement_uid)) return j;
  }
  return -1;
}

/**
 * Standalone port of public/labeler.html. Deliberately framework-minimal:
 * plain React state/hooks, fetch, localStorage — no Astro-only APIs — so
 * this whole directory can be copied into a Next.js app and mounted as-is
 * (import "./labeler.css" once, globally, then render <Labeler />).
 */
export default function Labeler() {
  const [S, setS] = useState<LabelerState>(defaultState());
  const stateRef = useRef(S);
  const [hydrated, setHydrated] = useState(false);
  const [started, setStarted] = useState(false);

  const applyState = (next: LabelerState) => {
    stateRef.current = next;
    setS(next);
    writeState(next);
  };

  useEffect(() => {
    const loaded = readState();
    stateRef.current = loaded;
    setS(loaded);
    setHydrated(true);
  }, []);

  // ---------------------------------------------------------------- queue / row state
  const [cursor, setCursor] = useState(-1);
  const [current, setCurrent] = useState<CurrentRow | null>(null);
  const [mainLoading, setMainLoading] = useState(false);
  const [mainError, setMainError] = useState<string | null>(null);
  const [queueFinished, setQueueFinished] = useState(false);
  const [rowTitle, setRowTitle] = useState("Nothing loaded");

  const [draft, setDraft] = useState<Draft>({ label: null, confidence: "probable", mechs: [] });
  const [why, setWhy] = useState("");
  const [flowStep, setFlowStep] = useState<FlowStep>("verdict");
  const [committedThisRow, setCommittedThisRow] = useState(false);
  const [whyRequiredError, setWhyRequiredError] = useState(false);
  const [mechRequiredError, setMechRequiredError] = useState(false);

  const [sealed, setSealed] = useState(true);
  const [revealData, setRevealData] = useState<RevealResponse | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealForLabel, setRevealForLabel] = useState<Verdict | null>(null);

  const [drawDlgOpen, setDrawDlgOpen] = useState(false);
  const [expDlgOpen, setExpDlgOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideAnchor, setGuideAnchor] = useState<string | null>(null);

  const rowCacheRef = useRef(new Map<string, Promise<{ cand: Candidate; ctx: ContextResponse | null }>>());

  const fetchRowData = (row: QueueRow) => {
    const cache = rowCacheRef.current;
    const cached = cache.get(row.measurement_uid);
    if (cached) return cached;
    const apiBase = stateRef.current.apiBase;
    const p = (async () => {
      const cand = await fetchCandidate(apiBase, row.measurement_uid);
      let ctx: ContextResponse | null = null;
      const host = cand.observations[0]?.hostname;
      if (host) {
        try {
          ctx = await fetchContext(apiBase, {
            hostname: host,
            probeCC: row.probe_cc,
            probeASN: row.probe_asn,
            at: row.measurement_start_time,
            hours: 6,
          });
        } catch {
          /* context is best-effort */
        }
      }
      return { cand, ctx };
    })();
    cache.set(row.measurement_uid, p);
    p.catch(() => cache.delete(row.measurement_uid));
    if (cache.size > ROW_CACHE_MAX) cache.delete(cache.keys().next().value!);
    return p;
  };

  // Fetching candidate + context is the slow part of loading a row. As soon
  // as a row is on screen, prefetch whatever "next unlabelled" would jump to
  // next, so by the time you commit and press it the data is usually ready.
  const prefetchNext = (fromCursor: number) => {
    const j = nextUnlabelledIndex(stateRef.current, fromCursor + 1);
    if (j !== -1) fetchRowData(stateRef.current.queue[j]).catch(() => {});
  };

  async function showReveal(uid: string, label: Verdict) {
    setSealed(false);
    setRevealLoading(true);
    setRevealError(null);
    setRevealData(null);
    setRevealForLabel(label);
    try {
      const r = await fetchReveal(stateRef.current.apiBase, uid);
      setRevealData(r);
    } catch (e: any) {
      setRevealError(String(e?.message || e));
    } finally {
      setRevealLoading(false);
    }
  }

  function restore(prev: LabelRecord) {
    setDraft({ label: prev.label, confidence: prev.label_confidence, mechs: prev.mechanisms || [] });
    setWhy(prev.rationale || "");
    showReveal(prev.measurement_uid, prev.label);
  }

  async function loadRowFrom(queue: QueueRow[], i: number) {
    if (i < 0 || i >= queue.length) return;
    const row = queue[i];
    setCursor(i);
    setCommittedThisRow(false);
    setDraft({ label: null, confidence: "probable", mechs: [] });
    setWhy("");
    setWhyRequiredError(false);
    setMechRequiredError(false);
    setFlowStep("verdict");
    setSealed(true);
    setRevealData(null);
    setRevealError(null);
    setRevealLoading(false);
    setRowTitle(row.domain || row.input || "measurement");
    setQueueFinished(false);
    setCurrent(null);
    setMainError(null);
    setMainLoading(true);
    try {
      const { cand, ctx } = await fetchRowData(row);
      setCurrent({ row, candidate: cand, context: ctx });
      setMainLoading(false);
      const prev = stateRef.current.labels.find((l) => l.measurement_uid === row.measurement_uid && !l.superseded_by);
      if (prev) restore(prev);
      prefetchNext(i);
    } catch (e: any) {
      setMainLoading(false);
      setMainError(String(e?.message || e));
    }
  }

  const loadRow = (i: number) => loadRowFrom(stateRef.current.queue, i);

  function nextUnlabelled() {
    const j = nextUnlabelledIndex(stateRef.current, cursor + 1);
    if (j === -1) {
      setCurrent(null);
      setQueueFinished(true);
      return;
    }
    loadRow(j);
  }

  // ---------------------------------------------------------------- gate
  const handleStart = (who: string, apiBase: string) => {
    const next = { ...stateRef.current, adjudicator: who, apiBase };
    applyState(next);
    setStarted(true);
    if (next.queue.length) {
      const idx = next.queue.findIndex((r) => !isLabelledIn(next, r.measurement_uid));
      if (idx !== -1) loadRowFrom(next.queue, idx);
    }
  };

  // ---------------------------------------------------------------- draw
  const onDrawn = (data: SampleResponse) => {
    const next: LabelerState = {
      ...stateRef.current,
      designs: {
        ...stateRef.current.designs,
        [data.design_id]: {
          design_id: data.design_id,
          replicate: data.replicate,
          spec: data.spec,
          drawn_at: new Date().toISOString(),
          frame_start: data.frame_start,
          frame_end: data.frame_end,
          strata: data.strata,
        },
      },
      queue: data.rows,
    };
    applyState(next);
    setDrawDlgOpen(false);
    setCursor(-1);
    loadRowFrom(next.queue, 0);
  };

  // ---------------------------------------------------------------- judgment actions
  const setLabelOnly = (label: Verdict) => {
    setDraft((d) => ({ ...d, label }));
    setMechRequiredError(false);
  };
  const setLabelAndAdvance = (label: Verdict) => {
    setLabelOnly(label);
    gotoStep(label === "blocked" ? "mechanism" : "confidence");
  };
  const setConfidenceOnly = (c: Draft["confidence"]) => setDraft((d) => ({ ...d, confidence: c }));
  const setConfidenceAndMaybeAdvance = (c: Draft["confidence"]) => {
    setConfidenceOnly(c);
    if (flowStep === "confidence") gotoStep("rationale");
  };
  const onAddMech = (path: string) => {
    setDraft((d) => ({ ...d, mechs: addMechanism(d.mechs, path).mechs }));
    setMechRequiredError(false);
  };
  const onRemoveMech = (path: string) => setDraft((d) => ({ ...d, mechs: d.mechs.filter((m) => m !== path) }));

  function gotoStep(name: FlowStep) {
    const resolved = name === "mechanism" && draft.label !== "blocked" ? "confidence" : name;
    setFlowStep(resolved);
  }
  function stepBack() {
    if (flowStep === "rationale") gotoStep("confidence");
    else if (flowStep === "confidence") gotoStep(draft.label === "blocked" ? "mechanism" : "verdict");
    else if (flowStep === "mechanism") gotoStep("verdict");
  }

  async function commit() {
    if (!draft.label || !current) return;
    const { row } = current;

    if (draft.label !== "unusable" && !why.trim()) {
      setWhyRequiredError(true);
      return;
    }
    if (draft.label === "blocked" && draft.mechs.length === 0) {
      gotoStep("mechanism");
      setMechRequiredError(true);
      return;
    }
    setWhyRequiredError(false);
    setMechRequiredError(false);

    const state = stateRef.current;
    const prev = state.labels.find((l) => l.measurement_uid === row.measurement_uid && !l.superseded_by);
    const rec: LabelRecord = {
      label_id: uuid(),
      measurement_uid: row.measurement_uid,
      probe_cc: row.probe_cc,
      probe_asn: row.probe_asn,
      resolver_asn: row.resolver_asn,
      target: row.domain || row.input || "",
      test_name: row.test_name,
      observed_at: row.measurement_start_time,

      label: draft.label,
      label_confidence: draft.confidence,
      mechanisms: draft.label === "blocked" ? [...draft.mechs] : [],
      mechanism_taxonomy: MECHANISM_TAXONOMY,
      label_source: "analyst",
      adjudicator: state.adjudicator,
      adjudicated_at: new Date().toISOString(),
      rationale: why.trim(),

      sampling_stratum: row.sampling_stratum,
      sampling_weight: row.sampling_weight,
      sample_population: row.sample_population,
      sample_rows: row.sample_rows,
      sampling_design_id: row.sampling_design_id,
      screen_kind: row.screen_kind,

      blinded: true,
      superseded_by: null,
      supersede_reason: null,
    };

    const labels = [...state.labels];
    if (prev) {
      const idx = labels.findIndex((l) => l.label_id === prev.label_id);
      labels[idx] = { ...prev, superseded_by: rec.label_id, supersede_reason: "re-adjudicated" };
    }
    labels.push(rec);
    applyState({ ...state, labels });
    setCommittedThisRow(true);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await showReveal(rec.measurement_uid, rec.label);
  }

  // ---------------------------------------------------------------- guide
  const openGuide = (anchor: string | null = null) => {
    setDrawDlgOpen(false);
    setExpDlgOpen(false);
    setGuideAnchor(anchor);
    setGuideOpen(true);
  };

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    if (!started) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
        return;
      }
      if (e.key === "?") {
        openGuide();
        e.preventDefault();
        return;
      }
      const map: Record<string, Verdict> = { b: "blocked", d: "down", o: "ok", u: "unadjudicated", x: "unusable" };
      const k = e.key.toLowerCase();
      if (map[k]) {
        setLabelAndAdvance(map[k]);
        e.preventDefault();
      } else if (k === "1") {
        setConfidenceAndMaybeAdvance("certain");
      } else if (k === "2") {
        setConfidenceAndMaybeAdvance("probable");
      } else if (k === "3") {
        setConfidenceAndMaybeAdvance("uncertain");
      } else if (k === "m") {
        gotoStep("mechanism");
        e.preventDefault();
      } else if (k === "r") {
        gotoStep("rationale");
        e.preventDefault();
      } else if (e.key === "Escape") {
        stepBack();
      } else if (e.key === "Enter") {
        if (committedThisRow) nextUnlabelled();
        else if (flowStep === "confidence") gotoStep("rationale");
        else commit();
        e.preventDefault();
      } else if (k === "n") {
        nextUnlabelled();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, draft, flowStep, committedThisRow, current, why, cursor]);

  if (!hydrated) return null;

  const isLabelled = (uid: string) => isLabelledIn(S, uid);

  const labelCounts: Record<string, number> = {};
  S.labels
    .filter((l) => !l.superseded_by)
    .forEach((l) => {
      labelCounts[l.label] = (labelCounts[l.label] || 0) + 1;
    });
  const totalLive = S.labels.filter((l) => !l.superseded_by).length;

  const designId = S.queue[0]?.sampling_design_id;
  const design = designId ? S.designs[designId] : null;
  const designNote = designId
    ? `design <b>${designId}</b>` + (design && design.replicate > 1 ? ` · rep ${design.replicate}` : "")
    : null;

  return (
    <div className="ooni-labeler">
      {!started && (
        <Gate
          initialWho={S.adjudicator}
          initialApiBase={S.apiBase}
          resumeCount={S.labels.length}
          onStart={handleStart}
          onGuide={() => openGuide()}
        />
      )}

      {started && (
        <div id="app">
          <Sidebar
            queue={S.queue}
            isLabelled={isLabelled}
            cursor={cursor}
            onSelectRow={loadRow}
            onDraw={() => setDrawDlgOpen(true)}
            designNote={designNote}
            labelCounts={labelCounts}
            totalLive={totalLive}
            onExport={() => setExpDlgOpen(true)}
            onGuide={() => openGuide()}
          />

          <main>
            <div id="mainBody">
              {mainLoading && <div className="banner">Loading measurement…</div>}
              {!mainLoading && mainError && <div className="banner err">Could not load: {mainError}</div>}
              {!mainLoading && !mainError && current && (
                <CandidateView row={current.row} candidate={current.candidate} context={current.context} />
              )}
              {!mainLoading && !mainError && !current && (
                <div className="banner">
                  {queueFinished
                    ? "Queue finished. Export your labels, then draw another queue."
                    : "Draw a queue to begin. Rows arrive interleaved across strata, so you cannot tell which stratum a row came from — that is deliberate."}
                </div>
              )}
            </div>
          </main>

          <JudgmentPanel
            rowTitle={rowTitle}
            hasRow={!!current}
            draft={draft}
            flowStep={flowStep}
            why={why}
            onWhyChange={(v) => {
              setWhy(v);
              if (whyRequiredError) setWhyRequiredError(false);
            }}
            whyRequiredError={whyRequiredError}
            onSetLabel={setLabelOnly}
            onSetConfidence={setConfidenceOnly}
            onAddMech={onAddMech}
            onRemoveMech={onRemoveMech}
            onGotoStep={gotoStep}
            onCommit={commit}
            commitDisabled={!draft.label || !current}
            mechRequiredError={mechRequiredError}
            sealed={sealed}
            revealData={revealData}
            revealLoading={revealLoading}
            revealError={revealError}
            revealForLabel={revealForLabel}
            onNextUnlabelled={nextUnlabelled}
            onGuideLink={(anchor) => openGuide(anchor)}
          />
        </div>
      )}

      <DrawDialog
        open={drawDlgOpen}
        apiBase={S.apiBase}
        onClose={() => setDrawDlgOpen(false)}
        onDrawn={onDrawn}
        onGuideLink={(anchor) => openGuide(anchor)}
      />
      <ExportDialog open={expDlgOpen} state={S} onClose={() => setExpDlgOpen(false)} />
      <Guide open={guideOpen} anchor={guideAnchor} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
