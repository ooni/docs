import { useEffect, useMemo, useRef, useState } from "react";
import "../labeler/labeler.css";
import "./event-labeler.css";
import Gate from "./Gate";
import Guide from "./Guide";
import Sidebar from "./Sidebar";
import EventPane from "./EventPane";
import GradingPanel, { type FlowStep } from "./GradingPanel";
import IoDialog from "./IoDialog";
import type { BoundKey, TimelineMode, ZoomRange } from "./Timeline";
import { checkCoverage, fetchSeries, type FacetMode, type FacetSeries } from "./api";
import { collect, draftFromEvent, isComplete, resolve, validate } from "./derive";
import { blankEvent } from "./io";
import { readState, uuid, writeState } from "./storage";
import { defaultState, type EventDraft, type EventLabel, type EventLabelerState } from "./types";

/**
 * The event grain of the label corpus: one curated row per censorship event,
 * as specified in docs/data/pipeline-label-corpus §1.2 and §3.2.
 *
 * Built like the measurement labeler in ../labeler, and for the same reasons:
 * plain React state/hooks, fetch and localStorage — no Astro-only APIs — so
 * this directory can be copied into a Next.js app and mounted as-is (import
 * "../labeler/labeler.css" and "./event-labeler.css" once, globally, then
 * render <EventLabeler />). Nothing is stored server-side: events live in the
 * browser and leave by copy-paste, so there is no write endpoint and no auth
 * surface. The only network calls are the observation timeline and the
 * coverage check, both over existing aggregation endpoints.
 */
export default function EventLabeler() {
  const [S, setS] = useState<EventLabelerState>(defaultState());
  const stateRef = useRef(S);
  const [hydrated, setHydrated] = useState(false);
  const [started, setStarted] = useState(false);

  const applyState = (next: EventLabelerState) => {
    stateRef.current = next;
    setS(next);
    writeState(next);
  };

  useEffect(() => {
    const loaded = readState();
    stateRef.current = loaded;
    setS(loaded);
    setDraft(loaded.events[loaded.cursor] ? draftFromEvent(loaded.events[loaded.cursor]) : null);
    setHydrated(true);
  }, []);

  // ---------------------------------------------------------------- editing
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>("class");
  const [mechRequiredError, setMechRequiredError] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const [armed, setArmed] = useState<BoundKey | null>(null);
  const [facets, setFacets] = useState<FacetSeries[]>([]);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [seriesNote, setSeriesNote] = useState("");
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [grain, setGrain] = useState<"hour" | "day">("hour");
  const [padDays, setPadDays] = useState(14);
  const [mode, setMode] = useState<TimelineMode>("count");
  const [facet, setFacet] = useState<FacetMode>("none");
  const [zoom, setZoom] = useState<ZoomRange | null>(null);

  const [coverageLines, setCoverageLines] = useState<string[] | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const [ioMode, setIoMode] = useState<"import" | "export">("export");
  const [ioOpen, setIoOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideAnchor, setGuideAnchor] = useState<string | null>(null);

  const event: EventLabel | null = S.events[S.cursor] ?? null;
  const resolved = useMemo(
    () => (event && draft ? resolve(event, draft) : null),
    [event, draft]
  );
  const dirty = useMemo(
    () => !!(event && draft) && JSON.stringify(draftFromEvent(event)) !== JSON.stringify(draft),
    [event, draft]
  );

  function selectEvent(i: number) {
    const state = stateRef.current;
    const e = state.events[i];
    if (!e) return;
    applyState({ ...state, cursor: i });
    setDraft(draftFromEvent(e));
    setFlowStep("class");
    setMechRequiredError(false);
    setSaveMsg(null);
    setCoverageLines(null);
    setArmed(null);
    // The series belongs to the previous event's scope; drop it rather than
    // leaving a chart that silently describes something else.
    setFacets([]);
    setOutcomes([]);
    setSeriesNote("");
    setZoom(null);
  }

  const set = (patch: Partial<EventDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    if (patch.mechanisms) setMechRequiredError(false);
    setSaveMsg(null);
  };

  // ---------------------------------------------------------------- actions
  function save() {
    const state = stateRef.current;
    const e = state.events[state.cursor];
    if (!e || !draft) return;
    const patch = collect(draft);
    const problem = validate(patch);
    if (problem) {
      if (!patch.mechanisms.length && patch.event_class === "true_event") {
        setFlowStep("mechanism");
        setMechRequiredError(true);
      }
      setSaveMsg({ kind: "err", text: problem });
      return;
    }
    const next: EventLabel = {
      ...e,
      ...patch,
      adjudicator: state.adjudicator,
      adjudicated_at: new Date().toISOString(),
      needs_review: [],
    };
    const events = [...state.events];
    events[state.cursor] = next;
    applyState({ ...state, events });
    setDraft(draftFromEvent(next));
    setMechRequiredError(false);
    setSaveMsg({ kind: "ok", text: "saved" });
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function nextIncomplete() {
    const state = stateRef.current;
    if (!state.events.length) return;
    for (let i = 1; i <= state.events.length; i++) {
      const j = (state.cursor + i) % state.events.length;
      if (!isComplete(state.events[j])) return selectEvent(j);
    }
    setSaveMsg({ kind: "ok", text: "every event is complete" });
  }

  async function loadSeries(facetOverride?: FacetMode) {
    if (!resolved) return;
    setSeriesLoading(true);
    setSeriesNote("");
    // A new query means a new domain; a stale zoom would silently crop it.
    setZoom(null);
    try {
      const r = await fetchSeries(stateRef.current.apiBase, resolved, {
        grain,
        padDays,
        facet: facetOverride ?? facet,
      });
      setFacets(r.facets);
      setOutcomes(r.outcomes);
      setSeriesNote(r.note);
    } catch (err: any) {
      setFacets([]);
      setOutcomes([]);
      setSeriesNote("series failed: " + String(err?.message || err));
    } finally {
      setSeriesLoading(false);
    }
  }

  // Faceting is a different group_by, so it needs a refetch — but only if
  // there is already a chart on screen to re-draw.
  const changeFacet = (f: FacetMode) => {
    setFacet(f);
    if (facets.length) loadSeries(f);
  };

  async function runCoverage() {
    if (!resolved) return;
    setCoverageLoading(true);
    setCoverageLines(["querying…"]);
    try {
      const r = await checkCoverage(stateRef.current.apiBase, resolved);
      setCoverageLines(r.lines);
      set({ scoreable: r.scoreable });
    } catch (err: any) {
      setCoverageLines(["coverage query failed: " + String(err?.message || err)]);
    } finally {
      setCoverageLoading(false);
    }
  }

  const onImported = (events: EventLabel[]) => {
    const state = stateRef.current;
    applyState({ ...state, events, cursor: 0 });
    setDraft(events[0] ? draftFromEvent(events[0]) : null);
    setFacets([]);
    setOutcomes([]);
    setSeriesNote("");
    setZoom(null);
    setCoverageLines(null);
  };

  const newEvent = () => {
    const state = stateRef.current;
    const events = [...state.events, blankEvent(uuid())];
    applyState({ ...state, events, cursor: events.length - 1 });
    setDraft(draftFromEvent(events[events.length - 1]));
    setFlowStep("class");
    setSaveMsg(null);
    setCoverageLines(null);
    setFacets([]);
    setOutcomes([]);
    setSeriesNote("");
    setZoom(null);
  };

  const openGuide = (anchor: string | null = null) => {
    setIoOpen(false);
    setGuideAnchor(anchor);
    setGuideOpen(true);
  };

  const handleStart = (who: string, apiBase: string) => {
    applyState({ ...stateRef.current, adjudicator: who, apiBase });
    setStarted(true);
  };

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    if (!started) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          save();
          e.preventDefault();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (e.key === "?") {
        openGuide();
        e.preventDefault();
        return;
      }
      if (!draft) return;
      if (k === "t") {
        set({ event_class: "true_event" });
        setFlowStep("mechanism");
        e.preventDefault();
      } else if (k === "f") {
        set({ event_class: "false_positive_event" });
        setFlowStep("mechanism");
        e.preventDefault();
      } else if (k === "d") {
        set({ event_class: "disputed" });
        setFlowStep("mechanism");
        e.preventDefault();
      } else if (k === "1") {
        set({ confidence: "certain" });
      } else if (k === "2") {
        set({ confidence: "probable" });
      } else if (k === "3") {
        set({ confidence: "uncertain" });
      } else if (k === "m") {
        setFlowStep("mechanism");
        e.preventDefault();
      } else if (k === "r") {
        setFlowStep("rationale");
        e.preventDefault();
      } else if (k === "c") {
        runCoverage();
        e.preventDefault();
      } else if (k === "n") {
        nextIncomplete();
      } else if (e.key === "Enter") {
        save();
        e.preventDefault();
      } else if (e.key === "Escape") {
        setFlowStep((s) => (s === "rationale" ? "confidence" : s === "confidence" ? "mechanism" : "class"));
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, draft, flowStep, resolved]);

  if (!hydrated) return null;

  return (
    <div className="ooni-labeler event-labeler">
      {!started && (
        <Gate
          initialWho={S.adjudicator}
          initialApiBase={S.apiBase}
          resumeCount={S.events.length}
          onStart={handleStart}
          onGuide={() => openGuide()}
        />
      )}

      {started && (
        <div id="app">
          <Sidebar
            events={S.events}
            cursor={S.cursor}
            onSelect={selectEvent}
            onImport={() => {
              setIoMode("import");
              setIoOpen(true);
            }}
            onExport={() => {
              setIoMode("export");
              setIoOpen(true);
            }}
            onNew={newEvent}
            onGuide={() => openGuide()}
          />

          <main>
            {event && draft && resolved ? (
              <EventPane
                event={event}
                draft={draft}
                resolved={resolved}
                set={set}
                facets={facets}
                outcomes={outcomes}
                seriesNote={seriesNote}
                seriesLoading={seriesLoading}
                grain={grain}
                padDays={padDays}
                onGrain={(g) => setGrain(g)}
                onPad={(d) => setPadDays(d)}
                mode={mode}
                onMode={setMode}
                facet={facet}
                onFacet={changeFacet}
                zoom={zoom}
                onZoom={setZoom}
                onLoadSeries={loadSeries}
                armed={armed}
                onArm={setArmed}
              />
            ) : (
              <div className="banner">
                No events loaded. <b>Import a draft</b> produced by{" "}
                <code>scripts/incidents_to_events.py</code>, or add one by hand with{" "}
                <b>New event</b>. Events are curated, not sampled — there is no frame to draw from.
              </div>
            )}
          </main>

          {event && draft && resolved ? (
            <GradingPanel
              title={(event.title || event.event_id) + (dirty ? " ·" : "")}
              hasEvent={!!event}
              draft={draft}
              resolved={resolved}
              set={set}
              flowStep={flowStep}
              onGotoStep={setFlowStep}
              mechRequiredError={mechRequiredError}
              coverageLines={coverageLines}
              coverageLoading={coverageLoading}
              onCheckCoverage={runCoverage}
              onSave={save}
              saveMsg={saveMsg ?? (dirty ? { kind: "warn", text: "unsaved changes" } : null)}
              onNext={nextIncomplete}
              onGuideLink={(a) => openGuide(a)}
            />
          ) : (
            <div className="judgment">
              <span className="eyebrow">Your adjudication</span>
              <p className="hint">Nothing loaded.</p>
            </div>
          )}
        </div>
      )}

      <IoDialog
        open={ioOpen}
        mode={ioMode}
        state={S}
        onClose={() => setIoOpen(false)}
        onImported={onImported}
      />
      <Guide open={guideOpen} anchor={guideAnchor} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
