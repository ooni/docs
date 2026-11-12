import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchChangepoints,
  fetchCountries,
  fetchDomains,
  fetchNetworkNames,
} from "./api";
import AsnGrid from "./AsnGrid";
import { readConfig } from "./config";
import type { DashboardConfig } from "./config";
import { eventKey, isoDay, summarizeAsns, windowFor } from "./derive";
import type { AsnSummary, Window } from "./derive";
import EventTimeline from "./EventTimeline";
import Inspector from "./Inspector";
import QueryBar, { isComplete } from "./QueryBar";
import type { Query } from "./QueryBar";
import { LAYERS } from "./types";
import type { Changepoint, Country, DomainEntry } from "./types";
import "./event-dashboard.css";

interface Loaded {
  query: Query;
  win: Window;
  asns: AsnSummary[];
}

type RunStatus =
  | { phase: "idle" }
  | { phase: "loading"; query: Query; win: Window; startedAt: number }
  | { phase: "error"; message: string };

const sameQuery = (a: Query, b: Query) =>
  a.probeCc === b.probeCc && a.domain === b.domain && a.date === b.date;

const yesterdayUTC = () => isoDay(Date.now() - 24 * 3600 * 1000);

const initialQuery = (q: URLSearchParams): Query => ({
  probeCc: (q.get("probe_cc") ?? "").toUpperCase(),
  domain: q.get("domain") ?? "",
  date: q.get("date") || yesterdayUTC(),
});

const initialAsns = (q: URLSearchParams): number[] =>
  q
    .getAll("asn")
    .map((a) => Number(a.replace(/^AS/i, "")))
    .filter((a) => Number.isInteger(a) && a > 0);

// Deep-linking: ?probe_cc=…&domain=…&date=…&asn=…&asn=… plus the overrides
// read by readConfig (ooni_api, changepoint_api, max_asns)
function writeUrl(query: Query, asns: number[]) {
  const q = new URLSearchParams(window.location.search);
  const set = (k: string, v: string) => (v ? q.set(k, v) : q.delete(k));
  set("probe_cc", query.probeCc);
  set("domain", query.domain);
  set("date", query.date);
  q.delete("asn");
  for (const a of asns) q.append("asn", String(a));
  window.history.replaceState(null, "", "?" + q.toString());
}

export default function EventDashboard() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [config, setConfig] = useState<DashboardConfig>(() => readConfig(params));
  const [query, setQuery] = useState<Query>(() => initialQuery(params));
  const [selectedAsns, setSelectedAsns] = useState<number[]>(() =>
    initialAsns(params).slice(0, config.maxAsns)
  );
  const [selectedEvent, setSelectedEvent] = useState<Changepoint | null>(null);
  // The (network, resolver) pair open in the inspector, and the hour to open on
  const [inspect, setInspect] = useState<{
    asn: number;
    resolverAsn: number;
    focusMs: number | null;
  } | null>(null);
  // The last finished run stays on screen while a new one is in flight
  const [result, setResult] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<RunStatus>({ phase: "idle" });
  // How long the previous run took, to give the progress bar a scale
  const lastDuration = useRef<number | null>(null);

  const [countries, setCountries] = useState<Country[]>([]);
  const [domains, setDomains] = useState<DomainEntry[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    const fail = (e: Error) => setListError(e.message);
    fetchCountries(config.ooniApi).then(setCountries, fail);
    fetchDomains(config.ooniApi).then(setDomains, fail);
    // Names only decorate the grid: a failure there is not worth reporting
    fetchNetworkNames(config.ooniApi).then(setNames, () => {});
  }, [config.ooniApi]);

  const inflight = useRef<AbortController | null>(null);

  const detect = useCallback(
    async (q: Query) => {
      if (!isComplete(q)) return;
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      const win = windowFor(q.date);
      const startedAt = Date.now();
      setStatus({ phase: "loading", query: q, win, startedAt });
      try {
        const resp = await fetchChangepoints(
          config.changepointApi,
          {
            probe_cc: q.probeCc,
            domain: q.domain,
            start_date: win.startDate,
            end_date: win.endDate,
          },
          ctrl.signal
        );
        const asns = summarizeAsns(resp);
        const present = new Set(asns.map((a) => a.asn));
        lastDuration.current = Date.now() - startedAt;
        setSelectedEvent(null);
        setInspect(null);
        setSelectedAsns((prev) => prev.filter((a) => present.has(a)));
        setResult({ query: q, win, asns });
        setStatus({ phase: "idle" });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setStatus({ phase: "error", message: String((e as Error).message ?? e) });
      }
    },
    [config.changepointApi]
  );

  const cancel = () => {
    inflight.current?.abort();
    setStatus({ phase: "idle" });
  };

  // Detection only runs from the button, except that a shared link carrying
  // a full query runs once on load
  useEffect(() => {
    if (params.has("date") && isComplete(query)) detect(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The URL describes the results on screen, so a shared link reproduces them
  useEffect(() => {
    if (result) writeUrl(result.query, selectedAsns);
  }, [result, selectedAsns]);

  const toggleAsn = (asn: number) =>
    setSelectedAsns((prev) =>
      prev.includes(asn)
        ? prev.filter((a) => a !== asn)
        : prev.length < config.maxAsns
          ? [...prev, asn]
          : prev
    );

  const loaded = result;
  const loading = status.phase === "loading";
  const stale = !!loaded && !loading && !sameQuery(loaded.query, query);
  const stacked = useMemo(() => {
    if (!loaded) return [];
    const byAsn = new Map(loaded.asns.map((a) => [a.asn, a]));
    return selectedAsns
      .map((a) => byAsn.get(a))
      .filter((a): a is AsnSummary => !!a);
  }, [loaded, selectedAsns]);

  // Lowering the cap in the settings trims the selection to fit
  useEffect(() => {
    setSelectedAsns((prev) =>
      prev.length > config.maxAsns ? prev.slice(0, config.maxAsns) : prev
    );
  }, [config.maxAsns]);

  // Drop the inspected event and pair once their network is deselected
  useEffect(() => {
    if (selectedEvent && !selectedAsns.includes(selectedEvent.probe_asn)) {
      setSelectedEvent(null);
    }
    if (inspect && !selectedAsns.includes(inspect.asn)) setInspect(null);
  }, [selectedAsns, selectedEvent, inspect]);

  const selectEvent = (e: Changepoint | null) => {
    setSelectedEvent(e);
    if (e) {
      setInspect({
        asn: e.probe_asn,
        resolverAsn: e.resolver_asn,
        focusMs: Date.parse(e.ts_hour),
      });
    }
  };

  // A network lane opens on its busiest blocked resolver, else its busiest
  const inspectLane = (asn: number, resolverAsn: number | null) => {
    const a = loaded?.asns.find((x) => x.asn === asn);
    if (!a) return;
    const blocked = (t: AsnSummary["tracks"][number]) =>
      LAYERS.some((l) => t.finalState[l] === "BLOCK") ? 1 : 0;
    const pick =
      resolverAsn ??
      [...a.tracks].sort(
        (x, y) => blocked(y) - blocked(x) || y.nMeasurements - x.nMeasurements
      )[0]?.resolverAsn;
    if (pick === undefined) return;
    setSelectedEvent(null);
    setInspect({ asn, resolverAsn: pick, focusMs: null });
  };
  const inspectedAsn = inspect
    ? loaded?.asns.find((a) => a.asn === inspect.asn) ?? null
    : null;

  return (
    <div className="ed-root min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-3xl font-black uppercase tracking-tight">OONI Event dashboard</h1>
          <p className="text-sm text-muted mt-1">
            When a website started or stopped being blocked, per network, as
            found by the changepoint detector over OONI measurements.
          </p>
        </header>

        <QueryBar
          query={query}
          onChange={setQuery}
          onRun={() => detect(query)}
          running={loading}
          stale={stale}
          countries={countries}
          domains={domains}
        />

        {listError && (
          <p className="badge-warn text-sm mb-4">
            ⚠ Could not load the country or domain list from {config.ooniApi}:{" "}
            {listError}
          </p>
        )}

        {status.phase === "loading" && (
          <Progress
            query={status.query}
            win={status.win}
            startedAt={status.startedAt}
            expectedMs={lastDuration.current}
            onCancel={cancel}
          />
        )}
        {status.phase === "error" && (
          <div className="card card-error mb-6">
            <p className="badge-fail text-sm">✕ {status.message}</p>
          </div>
        )}
        {stale && (
          <p className="stale-note mb-4">
            Showing results for {loaded.query.domain} · {loaded.query.probeCc} ·{" "}
            {loaded.query.date}. Press Detect events to run the new query.
          </p>
        )}

        {loaded && loaded.asns.length === 0 && (
          <div className="card mb-6 text-sm">
            No OONI measurements of{" "}
            <span className="font-mono">{loaded.query.domain}</span> in{" "}
            {loaded.query.probeCc} over this window. That does not mean the site
            is accessible.
          </div>
        )}

        {loaded && loaded.asns.length > 0 && (
          <div className={loading ? "results-busy" : undefined}>
            <AsnGrid
              asns={loaded.asns}
              names={names}
              endDate={loaded.win.endDate}
              selected={selectedAsns}
              maxSelected={config.maxAsns}
              onToggle={toggleAsn}
              onClear={() => setSelectedAsns([])}
            />
            {stacked.length === 0 ? (
              <p className="text-sm text-muted mb-6">
                Pick up to {config.maxAsns} networks above to stack their
                blocking timelines.
              </p>
            ) : (
              <EventTimeline
                asns={stacked}
                names={names}
                win={loaded.win}
                selectedEvent={selectedEvent ? eventKey(selectedEvent) : null}
                onSelectEvent={selectEvent}
                inspected={inspect}
                onInspect={inspectLane}
              />
            )}
            {inspect && inspectedAsn && (
              <Inspector
                probeCc={loaded.query.probeCc}
                domain={loaded.query.domain}
                asn={inspectedAsn}
                resolverAsn={inspect.resolverAsn}
                onResolverChange={(r) =>
                  setInspect({ asn: inspect.asn, resolverAsn: r, focusMs: null })
                }
                focusMs={inspect.focusMs}
                win={loaded.win}
                names={names}
                ooniApi={config.ooniApi}
                changepointApi={config.changepointApi}
                onClose={() => {
                  setInspect(null);
                  setSelectedEvent(null);
                }}
              />
            )}
          </div>
        )}

        <Settings config={config} onChange={setConfig} />
      </div>
    </div>
  );
}

function Settings({
  config,
  onChange,
}: {
  config: DashboardConfig;
  onChange: (c: DashboardConfig) => void;
}) {
  return (
    <details className="mt-8">
      <summary className="text-xs text-muted cursor-pointer">Settings</summary>
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center mt-2 text-xs">
        <label htmlFor="ed-ooni-api">OONI API</label>
        <input
          id="ed-ooni-api"
          className="ed-input font-mono text-xs"
          defaultValue={config.ooniApi}
          onBlur={(e) => onChange({ ...config, ooniApi: e.target.value.trim() })}
          spellCheck={false}
        />
        <label htmlFor="ed-cp-api">Changepoint API</label>
        <input
          id="ed-cp-api"
          className="ed-input font-mono text-xs"
          defaultValue={config.changepointApi}
          onBlur={(e) =>
            onChange({ ...config, changepointApi: e.target.value.trim() })
          }
          spellCheck={false}
        />
        <label htmlFor="ed-max-asns">Max networks</label>
        <input
          id="ed-max-asns"
          type="number"
          min={1}
          className="ed-input text-xs w-24"
          defaultValue={config.maxAsns}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n > 0) onChange({ ...config, maxAsns: n });
          }}
        />
      </div>
      <p className="text-xs text-muted mt-2">
        Also settable from the URL: <code>ooni_api</code>,{" "}
        <code>changepoint_api</code>, <code>max_asns</code>.
      </p>
    </details>
  );
}

// The changepoint API answers in one go, so progress is measured against how
// long the previous run took; on the first run the bar just sweeps.
function Progress({
  query,
  win,
  startedAt,
  expectedMs,
  onCancel,
}: {
  query: Query;
  win: Window;
  startedAt: number;
  expectedMs: number | null;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const elapsed = now - startedAt;
  const frac = expectedMs ? Math.min(0.95, elapsed / expectedMs) : null;
  return (
    <div className="card progress-card mb-6" role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="text-sm">
          <strong className="uppercase tracking-wide">Detecting</strong>{" "}
          <span className="font-mono">{query.domain}</span> · {query.probeCc} ·{" "}
          <span className="tabular-nums">
            {win.startDate} → {win.endDate}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span>{(elapsed / 1000).toFixed(1)}s</span>
          <button type="button" className="link" onClick={onCancel}>
            cancel
          </button>
        </div>
      </div>
      <div className="progress-track">
        {frac === null ? (
          <div className="progress-sweep" />
        ) : (
          <div className="progress-fill" style={{ width: `${frac * 100}%` }} />
        )}
      </div>
      <p className="text-xs text-muted mt-2">
        Replaying 30 days of warmup, then running the detector on DNS, TCP and
        TLS for every network and resolver. Busy domains take tens of seconds.
      </p>
    </div>
  );
}
