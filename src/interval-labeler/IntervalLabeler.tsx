import { useEffect, useMemo, useRef, useState } from "react";
import "../labeler/labeler.css";
import "../event-labeler/event-labeler.css";
import "./interval-labeler.css";
import type { Marker, TimelineMode, ZoomRange } from "../event-labeler/Timeline";
import Gate from "./Gate";
import Sidebar from "./Sidebar";
import DrawDialog from "./DrawDialog";
import CellPane from "./CellPane";
import VerdictPanel, { type Draft } from "./VerdictPanel";
import Guide from "./Guide";
import { ExportDialog, ImportEventsDialog } from "./IoDialogs";
import { fetchCellSeries, fetchIntervalReveal, type CellSeries } from "./api";
import { overlappingEvents, parseEventCorpus, type Overlap } from "./overlap";
import { readState, uuid, writeState } from "./storage";
import {
  cellKey,
  defaultState,
  type Confidence,
  type IntervalLabel,
  type IntervalLabelerState,
  type IntervalReveal,
  type IntervalRow,
  type IntervalSampleResponse,
  type IntervalVerdict,
} from "./types";

const CHANGEPOINT_COLORS: Record<string, string> = {
  pos: "#ff7359",
  neg: "#7dd195",
};

const isLabelledIn = (state: IntervalLabelerState, row: IntervalRow): boolean =>
  state.labels.some((l) => cellKey(l) === cellKey(row) && !l.superseded_by);

function nextUnlabelledIndex(state: IntervalLabelerState, from: number): number {
  const { queue } = state;
  if (!queue.length) return -1;
  for (let i = 0; i < queue.length; i++) {
    const j = (from + i) % queue.length;
    if (!isLabelledIn(state, queue[j])) return j;
  }
  return -1;
}

/**
 * The quiet-interval labeller. Closer to the measurement queue than to the
 * event editor — a drawn queue, one row at a time, blinded until commit — but
 * the row is a cell-week rather than a measurement, and what it produces is a
 * denominator rather than a case.
 *
 * Deliberately framework-minimal, like its two siblings: plain React state,
 * fetch and localStorage, no Astro-only APIs, so the directory can be copied
 * into a Next.js app and mounted as-is.
 */
export default function IntervalLabeler() {
  const [S, setS] = useState<IntervalLabelerState>(defaultState());
  const stateRef = useRef(S);
  const [hydrated, setHydrated] = useState(false);
  const [started, setStarted] = useState(false);

  const applyState = (next: IntervalLabelerState) => {
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

  // ---------------------------------------------------------------- row state
  const [cursor, setCursor] = useState(-1);
  const [current, setCurrent] = useState<IntervalRow | null>(null);
  const [series, setSeries] = useState<CellSeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [queueFinished, setQueueFinished] = useState(false);

  const [grain, setGrain] = useState<"hour" | "day">("hour");
  const [padDays, setPadDays] = useState(7);
  const [mode, setMode] = useState<TimelineMode>("count");
  const [zoom, setZoom] = useState<ZoomRange | null>(null);

  const [draft, setDraft] = useState<Draft>({ verdict: null, confidence: "probable" });
  const [why, setWhy] = useState("");
  const [whyRequiredError, setWhyRequiredError] = useState(false);
  const [committedThisRow, setCommittedThisRow] = useState(false);

  const [sealed, setSealed] = useState(true);
  const [reveal, setReveal] = useState<IntervalReveal | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [committedVerdict, setCommittedVerdict] = useState<IntervalVerdict | null>(null);

  const [drawDlgOpen, setDrawDlgOpen] = useState(false);
  const [expDlgOpen, setExpDlgOpen] = useState(false);
  const [impDlgOpen, setImpDlgOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideAnchor, setGuideAnchor] = useState<string | null>(null);

  const overlaps: Overlap[] = useMemo(
    () => (current ? overlappingEvents(current, S.events) : []),
    [current, S.events]
  );

  // Revealed changepoints, drawn over the series. Never populated while
  // `sealed` — the marker list is the one place detector output could reach
  // the chart before a commit.
  const markers: Marker[] = useMemo(() => {
    if (sealed || !reveal) return [];
    return reveal.changepoints.map((c) => ({
      t: Date.parse(c.ts.endsWith("Z") ? c.ts : c.ts + "Z"),
      color: CHANGEPOINT_COLORS[c.change_dir > 0 ? "pos" : "neg"],
      label: `${c.block_type} ${c.change_dir > 0 ? "→blk" : "→ok"}`,
    }));
  }, [sealed, reveal]);

  async function loadSeries(row: IntervalRow, opts?: { grain?: "hour" | "day"; padDays?: number }) {
    setSeriesLoading(true);
    setSeriesError(null);
    try {
      const data = await fetchCellSeries(stateRef.current.apiBase, row, {
        grain: opts?.grain ?? grain,
        padDays: opts?.padDays ?? padDays,
      });
      setSeries(data);
    } catch (e: any) {
      setSeriesError(String(e?.message || e));
      setSeries(null);
    } finally {
      setSeriesLoading(false);
    }
  }

  async function showReveal(row: IntervalRow) {
    setSealed(false);
    setRevealLoading(true);
    setRevealError(null);
    setReveal(null);
    try {
      setReveal(await fetchIntervalReveal(stateRef.current.apiBase, row, padDays));
    } catch (e: any) {
      setRevealError(String(e?.message || e));
    } finally {
      setRevealLoading(false);
    }
  }

  function loadRowFrom(queue: IntervalRow[], i: number) {
    if (i < 0 || i >= queue.length) return;
    const row = queue[i];
    setCursor(i);
    setCurrent(row);
    setQueueFinished(false);
    setCommittedThisRow(false);
    setDraft({ verdict: null, confidence: "probable" });
    setWhy("");
    setWhyRequiredError(false);
    setSealed(true);
    setReveal(null);
    setRevealError(null);
    setCommittedVerdict(null);
    setZoom(null);
    loadSeries(row);

    const prev = stateRef.current.labels.find((l) => cellKey(l) === cellKey(row) && !l.superseded_by);
    if (prev) {
      setDraft({ verdict: prev.verdict, confidence: prev.confidence });
      setWhy(prev.rationale || "");
      setCommittedVerdict(prev.verdict);
      showReveal(row);
    }
  }

  const loadRow = (i: number) => loadRowFrom(stateRef.current.queue, i);

  function nextUnlabelled() {
    const j = nextUnlabelledIndex(stateRef.current, cursor + 1);
    if (j === -1) {
      setCurrent(null);
      setSeries(null);
      setQueueFinished(true);
      return;
    }
    loadRow(j);
  }

  // ---------------------------------------------------------------- gate / draw
  const handleStart = (who: string, apiBase: string) => {
    const next = { ...stateRef.current, adjudicator: who, apiBase };
    applyState(next);
    setStarted(true);
    if (next.queue.length) {
      const idx = next.queue.findIndex((r) => !isLabelledIn(next, r));
      if (idx !== -1) loadRowFrom(next.queue, idx);
    }
  };

  const onDrawn = (data: IntervalSampleResponse) => {
    const next: IntervalLabelerState = {
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

  const importEvents = (text: string): string => {
    try {
      const events = parseEventCorpus(text);
      applyState({ ...stateRef.current, events });
      return `${events.length} events loaded`;
    } catch (e: any) {
      return String(e?.message || e);
    }
  };

  // ---------------------------------------------------------------- commit
  function commit() {
    const row = current;
    if (!row || !draft.verdict) return;
    if (draft.verdict !== "unusable" && !why.trim()) {
      setWhyRequiredError(true);
      return;
    }
    setWhyRequiredError(false);

    const state = stateRef.current;
    const prev = state.labels.find((l) => cellKey(l) === cellKey(row) && !l.superseded_by);
    const rec: IntervalLabel = {
      interval_id: uuid(),
      probe_cc: row.probe_cc,
      probe_asn: row.probe_asn,
      domain: row.domain,
      window_start: row.window_start,
      window_end: row.window_end,

      verdict: draft.verdict,
      confidence: draft.confidence,
      rationale: why.trim(),

      sampling_stratum: row.sampling_stratum,
      screen_kind: row.screen_kind,
      sampling_weight: row.sampling_weight,
      sample_population: row.sample_population,
      sample_rows: row.sample_rows,
      sampling_design_id: row.sampling_design_id,

      volume_band: row.volume_band,
      measurements_in_window: row.measurements_in_window,

      // null distinguishes "no corpus was loaded" from "checked, found
      // nothing" — the second is evidence, the first is an absence of it.
      event_overlap: state.events.length ? overlaps.map((o) => o.event_id) : null,

      blinded: true,
      adjudicator: state.adjudicator,
      adjudicated_at: new Date().toISOString(),
      superseded_by: null,
      supersede_reason: null,
    };

    const labels = [...state.labels];
    if (prev) {
      const idx = labels.findIndex((l) => l.interval_id === prev.interval_id);
      labels[idx] = { ...prev, superseded_by: rec.interval_id, supersede_reason: "re-adjudicated" };
    }
    labels.push(rec);
    applyState({ ...state, labels });
    setCommittedThisRow(true);
    setCommittedVerdict(rec.verdict);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    showReveal(row);
  }

  // ---------------------------------------------------------------- keyboard
  const openGuide = (anchor: string | null = null) => {
    setDrawDlgOpen(false);
    setExpDlgOpen(false);
    setImpDlgOpen(false);
    setGuideAnchor(anchor);
    setGuideOpen(true);
  };

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
      const map: Record<string, IntervalVerdict> = {
        q: "quiet_observed",
        e: "event_present",
        u: "uncertain",
        x: "unusable",
      };
      const k = e.key.toLowerCase();
      if (map[k]) {
        setDraft((d) => ({ ...d, verdict: map[k] }));
        e.preventDefault();
      } else if (k === "1" || k === "2" || k === "3") {
        const c: Confidence = k === "1" ? "certain" : k === "2" ? "probable" : "uncertain";
        setDraft((d) => ({ ...d, confidence: c }));
      } else if (e.key === "Enter") {
        if (committedThisRow) nextUnlabelled();
        else commit();
        e.preventDefault();
      } else if (k === "n") {
        nextUnlabelled();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, draft, why, current, committedThisRow, cursor, overlaps]);

  if (!hydrated) return null;

  const live = S.labels.filter((l) => !l.superseded_by);
  const verdictCounts: Record<string, number> = {};
  live.forEach((l) => {
    verdictCounts[l.verdict] = (verdictCounts[l.verdict] || 0) + 1;
  });

  const designId = S.queue[0]?.sampling_design_id;
  const design = designId ? S.designs[designId] : null;
  const designNote = designId
    ? `design <b>${designId}</b>` + (design && design.replicate > 1 ? ` · rep ${design.replicate}` : "")
    : null;

  return (
    <div className="ooni-labeler event-labeler interval-labeler">
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
            isLabelled={(r) => isLabelledIn(S, r)}
            hasOverlap={(r) => S.events.length > 0 && overlappingEvents(r, S.events).length > 0}
            cursor={cursor}
            onSelectRow={loadRow}
            onDraw={() => setDrawDlgOpen(true)}
            designNote={designNote}
            verdictCounts={verdictCounts}
            totalLive={live.length}
            corpusNote={
              S.events.length ? `${S.events.length} events loaded` : "none loaded — overlaps unchecked"
            }
            onImportEvents={() => setImpDlgOpen(true)}
            onExport={() => setExpDlgOpen(true)}
            onGuide={() => openGuide()}
          />

          <main>
            {current ? (
              <CellPane
                row={current}
                series={series}
                loading={seriesLoading}
                error={seriesError}
                overlaps={overlaps}
                corpusLoaded={S.events.length > 0}
                grain={grain}
                padDays={padDays}
                mode={mode}
                zoom={zoom}
                markers={markers}
                onGrain={(g) => {
                  setGrain(g);
                  loadSeries(current, { grain: g });
                }}
                onPadDays={(d) => {
                  setPadDays(d);
                  loadSeries(current, { padDays: d });
                }}
                onMode={setMode}
                onZoom={setZoom}
                onReload={() => loadSeries(current)}
              />
            ) : (
              <div className="banner">
                {queueFinished
                  ? "Queue finished. Export your intervals, then draw another queue."
                  : "Draw a queue to begin. Rows arrive interleaved across strata, so you cannot " +
                    "tell from the queue whether the detector alerted in one — that is deliberate."}
              </div>
            )}
          </main>

          <VerdictPanel
            row={current}
            draft={draft}
            why={why}
            onWhyChange={(v) => {
              setWhy(v);
              if (whyRequiredError) setWhyRequiredError(false);
            }}
            whyRequiredError={whyRequiredError}
            onSetVerdict={(v) => setDraft((d) => ({ ...d, verdict: v }))}
            onSetConfidence={(c) => setDraft((d) => ({ ...d, confidence: c }))}
            onCommit={commit}
            commitDisabled={!draft.verdict || !current}
            overlaps={overlaps}
            sealed={sealed}
            reveal={reveal}
            revealLoading={revealLoading}
            revealError={revealError}
            committedVerdict={committedVerdict}
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
      <ImportEventsDialog
        open={impDlgOpen}
        count={S.events.length}
        onClose={() => setImpDlgOpen(false)}
        onImport={importEvents}
      />
      <Guide open={guideOpen} anchor={guideAnchor} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
