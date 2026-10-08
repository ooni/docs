import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCountries, fetchDomains, fetchNetworkNames } from "../event-dashboard/api";
import { readConfig } from "../event-dashboard/config";
import { isoDay, summarizeAsns } from "../event-dashboard/derive";
import type { AsnSummary, Window } from "../event-dashboard/derive";
import DomainInput from "../event-dashboard/DomainInput";
import type { ChartMark } from "../event-dashboard/HourlyBars";
import { isoHour } from "../event-dashboard/inspect";
import Inspector from "../event-dashboard/Inspector";
import type { Country, DomainEntry } from "../event-dashboard/types";
import { createMockLabelApi, currentLabels, detectCached, exportMockLabels } from "./labelApi";
import LabelForm, { draftFromLabel, emptyDraft, TIME_META, validate } from "./LabelForm";
import type { Draft } from "./LabelForm";
import type { ChangepointLabel, ChangepointQuery, StoredChangepoint } from "./types";
import { TIME_FIELDS } from "./types";
import "../event-dashboard/event-dashboard.css";
import "./labeler.css";

const AUTHOR_KEY = "cp-labeler:author";
const DAY_MS = 864e5;

type Filter = "unlabeled" | "all";

interface Queue {
  query: ChangepointQuery;
  cps: StoredChangepoint[];
  labels: ChangepointLabel[];
  asns: AsnSummary[]; // detector context for the evidence view
}

type Status =
  | { phase: "idle" }
  | { phase: "loading"; startedAt: number }
  | { phase: "error"; message: string };

const readAuthor = () => {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
};

const windowOf = (q: ChangepointQuery): Window => ({
  startDate: q.since,
  endDate: q.until,
  startMs: Date.parse(q.since + "T00:00:00Z"),
  endMs: Date.parse(q.until + "T00:00:00Z") + DAY_MS,
});

export default function ChangepointLabeler() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const config = useMemo(() => readConfig(params), [params]);
  const api = useMemo(() => createMockLabelApi(config.changepointApi), [config.changepointApi]);

  const [author, setAuthor] = useState(readAuthor);
  useEffect(() => {
    try {
      localStorage.setItem(AUTHOR_KEY, author);
    } catch {
      /* private mode: the name just is not remembered */
    }
  }, [author]);

  const [query, setQuery] = useState<ChangepointQuery>(() => ({
    probe_cc: (params.get("probe_cc") ?? "").toUpperCase(),
    domain: params.get("domain") ?? "",
    since: params.get("since") ?? isoDay(Date.now() - 22 * DAY_MS),
    until: params.get("until") ?? isoDay(Date.now() - DAY_MS),
  }));
  const [countries, setCountries] = useState<Country[]>([]);
  const [domains, setDomains] = useState<DomainEntry[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    fetchCountries(config.ooniApi).then(setCountries, () => {});
    fetchDomains(config.ooniApi).then(setDomains, () => {});
    fetchNetworkNames(config.ooniApi).then(setNames, () => {});
  }, [config.ooniApi]);

  const [queue, setQueue] = useState<Queue | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [currentId, setCurrentId] = useState<string | null>(params.get("cp"));
  const [filter, setFilter] = useState<Filter>("unlabeled");
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [jump, setJump] = useState<{ ms: number; n: number } | null>(null);
  const [viewResolver, setViewResolver] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const complete = !!query.probe_cc && !!query.domain && query.since <= query.until;

  const load = useCallback(
    async (q: ChangepointQuery) => {
      setStatus({ phase: "loading", startedAt: Date.now() });
      try {
        const [cps, resp] = await Promise.all([
          api.listChangepoints(q),
          detectCached(config.changepointApi, q),
        ]);
        cps.sort((a, b) => a.ts_hour.localeCompare(b.ts_hour) || a.probe_asn - b.probe_asn);
        const labels = await api.listLabels(cps.map((c) => c.uuid));
        setQueue({ query: q, cps, labels, asns: summarizeAsns(resp) });
        setStatus({ phase: "idle" });
        const labelled = currentLabels(labels);
        setCurrentId((id) =>
          id && cps.some((c) => c.uuid === id)
            ? id
            : (cps.find((c) => !labelled.has(c.uuid)) ?? cps[0])?.uuid ?? null
        );
      } catch (e) {
        setStatus({ phase: "error", message: String((e as Error).message ?? e) });
      }
    },
    [api, config.changepointApi]
  );

  // A shared link with a full query loads straight away
  useEffect(() => {
    if (params.has("probe_cc") && params.has("domain") && complete) load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!queue) return;
    const q = new URLSearchParams(window.location.search);
    q.set("probe_cc", queue.query.probe_cc);
    q.set("domain", queue.query.domain);
    q.set("since", queue.query.since);
    q.set("until", queue.query.until);
    if (currentId) q.set("cp", currentId);
    else q.delete("cp");
    window.history.replaceState(null, "", "?" + q);
  }, [queue, currentId]);

  const labelled = useMemo(() => currentLabels(queue?.labels ?? []), [queue]);
  const cp = queue?.cps.find((c) => c.uuid === currentId) ?? null;
  const visible = useMemo(
    () => (queue?.cps ?? []).filter((c) => filter === "all" || !labelled.has(c.uuid) || c.uuid === currentId),
    [queue, filter, labelled, currentId]
  );

  // Opening a changepoint: its draft (or its current label as a start), the
  // evidence view centred on it, on the resolver it was detected for
  const baseDraft = (id: string): Draft => {
    const l = labelled.get(id);
    return l ? draftFromLabel(l) : emptyDraft();
  };
  const draft: Draft = cp ? drafts.get(cp.uuid) ?? baseDraft(cp.uuid) : emptyDraft();
  const setDraft = (update: (d: Draft) => Draft) => {
    if (!cp) return;
    const id = cp.uuid;
    setDrafts((m) => new Map(m).set(id, update(m.get(id) ?? baseDraft(id))));
  };
  useEffect(() => {
    setViewResolver(null);
    setSaveError(null);
    if (cp) setJump({ ms: Date.parse(cp.ts_hour), n: Date.now() });
  }, [cp?.uuid]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (dir: 1 | -1) => {
    const i = visible.findIndex((c) => c.uuid === currentId);
    const next = visible[i + dir];
    if (next) setCurrentId(next.uuid);
  };
  // n / p move through the queue; ignored while typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n") move(1);
      else if (e.key === "p") move(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const save = async () => {
    if (!cp || !queue || validate(draft, author).length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
      const row = await api.createLabel({
        changepoint_id: cp.uuid,
        author: author.trim(),
        verdict: draft.verdict!,
        notes: draft.notes.trim(),
        last_ok_time: iso(draft.times.last_ok_time),
        first_block_time: iso(draft.times.first_block_time),
        last_block_time: iso(draft.times.last_block_time),
        first_ok_time: iso(draft.times.first_ok_time),
      });
      const labels = [...queue.labels, row];
      setQueue({ ...queue, labels });
      setDrafts((m) => {
        const n = new Map(m);
        n.delete(cp.uuid);
        return n;
      });
      // on to the next changepoint still without a label
      const after = currentLabels(labels);
      const i = queue.cps.findIndex((c) => c.uuid === cp.uuid);
      const next =
        queue.cps.slice(i + 1).find((c) => !after.has(c.uuid)) ?? queue.cps.find((c) => !after.has(c.uuid));
      if (next) setCurrentId(next.uuid);
    } catch (e) {
      setSaveError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const asn: AsnSummary | null = useMemo(() => {
    if (!cp || !queue) return null;
    return (
      queue.asns.find((a) => a.asn === cp.probe_asn) ?? {
        asn: cp.probe_asn,
        nMeasurements: 0,
        events: [],
        tracks: [],
        blockedAtEnd: new Set(),
        decidedLayers: new Set(),
      }
    );
  }, [cp, queue]);

  const labelMarks: ChartMark[] = TIME_FIELDS.flatMap((f) =>
    draft.times[f] !== null ? [{ ms: draft.times[f] as number, label: TIME_META[f].label.toUpperCase(), tone: "label" as const }] : []
  );

  // stable across renders: the inspector re-centres whenever its window changes
  const win = useMemo(() => (queue ? windowOf(queue.query) : null), [queue?.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const nLabelled = queue ? queue.cps.filter((c) => labelled.has(c.uuid)).length : 0;
  const onSelectedHour = useCallback((h: number | null) => setSelectedHour(h), []);

  return (
    <div className="ed-root min-h-screen">
      <div className="lab-wrap">
        <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight">Changepoint labeler</h1>
            <p className="text-sm text-muted mt-1">
              Check each detected change against the measurements and record what the network was really
              doing.
            </p>
          </div>
          <label className="text-xs">
            <span className="ed-label">Your name</span>
            <input
              className="ed-input text-sm w-48"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="recorded as author"
            />
          </label>
        </header>

        {api.mock && (
          <div className="mock-banner mb-4">
            <strong>Mock label store.</strong> Changepoints come from the changepoint API's on-the-fly
            detection and labels are kept in this browser until the label API is ready.{" "}
            <button type="button" className="link" onClick={() => downloadJson(exportMockLabels())}>
              Export labels (JSON)
            </button>
          </div>
        )}

        <form
          className="card mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete) load(query);
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto_auto_auto] gap-3 items-end">
            <label>
              <span className="ed-label">Country</span>
              <select
                className="ed-input w-full text-sm"
                value={query.probe_cc}
                onChange={(e) => setQuery({ ...query, probe_cc: e.target.value })}
              >
                <option value="">{countries.length ? "Pick a country…" : "loading countries…"}</option>
                {countries.map((c) => (
                  <option key={c.alpha_2} value={c.alpha_2}>
                    {c.name} ({c.alpha_2})
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="ed-label">Domain</span>
              <DomainInput domains={domains} value={query.domain} onCommit={(domain) => setQuery({ ...query, domain })} />
            </div>
            <label>
              <span className="ed-label">From</span>
              <input
                type="date"
                className="ed-input text-sm"
                value={query.since}
                onChange={(e) => setQuery({ ...query, since: e.target.value })}
              />
            </label>
            <label>
              <span className="ed-label">To</span>
              <input
                type="date"
                className="ed-input text-sm"
                value={query.until}
                max={isoDay(Date.now())}
                onChange={(e) => setQuery({ ...query, until: e.target.value })}
              />
            </label>
            <button type="submit" className="ed-button" disabled={!complete || status.phase === "loading"}>
              {status.phase === "loading" ? "Loading…" : "Load changepoints"}
            </button>
          </div>
        </form>

        {status.phase === "loading" && (
          <div className="card progress-card mb-4">
            <p className="text-sm mb-2">Loading changepoints and the detector's view of every network…</p>
            <div className="progress-track">
              <div className="progress-sweep" />
            </div>
          </div>
        )}
        {status.phase === "error" && (
          <div className="card card-error mb-4">
            <p className="badge-fail text-sm">✕ {status.message}</p>
          </div>
        )}
        {queue && queue.cps.length === 0 && (
          <p className="text-sm text-muted">No changepoints for this country, domain and period.</p>
        )}

        {queue && queue.cps.length > 0 && (
          <div className="lab-grid">
            <aside className="lab-queue">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="card-title mb-0">Queue</h2>
                <span className="text-xs tabular-nums">
                  <strong>{nLabelled}</strong> / {queue.cps.length} labelled
                </span>
              </div>
              <div className="progress-track mb-2">
                <div className="progress-fill" style={{ width: `${(nLabelled / queue.cps.length) * 100}%` }} />
              </div>
              <div className="flex mb-2">
                <button
                  type="button"
                  className={`seg-btn ${filter === "unlabeled" ? "seg-btn-on" : ""}`}
                  onClick={() => setFilter("unlabeled")}
                >
                  To do
                </button>
                <button
                  type="button"
                  className={`seg-btn ${filter === "all" ? "seg-btn-on" : ""}`}
                  onClick={() => setFilter("all")}
                >
                  All
                </button>
              </div>
              <ol className="lab-list">
                {visible.map((c) => {
                  const l = labelled.get(c.uuid);
                  return (
                    <li key={c.uuid}>
                      <button
                        type="button"
                        className={`lab-item ${c.uuid === currentId ? "lab-item-on" : ""}`}
                        onClick={() => setCurrentId(c.uuid)}
                      >
                        <span className="flex items-baseline justify-between gap-1">
                          <span className="tabular-nums font-bold">{isoHour(Date.parse(c.ts_hour)).slice(5)}</span>
                          <span className={`lab-cp lab-cp-${c.state}`}>
                            {c.layer.toUpperCase()} {c.state === "BLOCK" ? "▲" : "▼"}
                          </span>
                        </span>
                        <span className="block truncate text-xs">
                          {names.get(c.probe_asn) ?? `AS${c.probe_asn}`}{" "}
                          <span className="text-muted">AS{c.probe_asn}</span>
                        </span>
                        <span className="flex items-baseline justify-between gap-1 text-xs text-muted">
                          <span className="truncate">via AS{c.resolver_asn}</span>
                          {l ? (
                            <span className={`lf-tag lf-tag-${l.verdict}`}>{l.verdict}</span>
                          ) : drafts.has(c.uuid) ? (
                            <span className="lf-tag">draft</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {visible.length === 0 && <li className="text-xs text-muted">Everything here is labelled.</li>}
              </ol>
              <p className="text-[0.65rem] text-muted mt-2">
                <kbd>n</kbd> next · <kbd>p</kbd> previous
              </p>
            </aside>

            <main className="min-w-0">
              {cp && asn && (
                <>
                  <div className="lab-cp-head mb-3">
                    <span className={`lab-cp lab-cp-${cp.state}`}>
                      {cp.layer.toUpperCase()} {cp.state === "BLOCK" ? "blocking started" : "blocking ended"}
                    </span>
                    <span className="tabular-nums font-bold">{isoHour(Date.parse(cp.ts_hour))} UTC</span>
                    <span>
                      {names.get(cp.probe_asn) ?? `AS${cp.probe_asn}`} AS{cp.probe_asn} · via resolver AS
                      {cp.resolver_asn}
                    </span>
                    <span className="text-muted tabular-nums">
                      evidence {(cp.state === "BLOCK" ? cp.s_pos : cp.s_neg).toFixed(1)} vs threshold {cp.h}
                    </span>
                    <span className="text-muted font-mono text-[0.65rem]">{cp.uuid}</span>
                  </div>
                  <Inspector
                    key={cp.uuid}
                    title="Evidence"
                    probeCc={cp.probe_cc}
                    domain={cp.domain}
                    asn={asn}
                    resolverAsn={viewResolver ?? cp.resolver_asn}
                    onResolverChange={setViewResolver}
                    focusMs={jump ? jump.ms + (jump.n % 2) : Date.parse(cp.ts_hour)}
                    win={win!}
                    names={names}
                    ooniApi={config.ooniApi}
                    changepointApi={config.changepointApi}
                    extraMarks={labelMarks}
                    onSelectedHourChange={onSelectedHour}
                    autoScroll={false}
                  />
                </>
              )}
            </main>

            <aside className="lab-form">
              {cp && (
                <>
                  <LabelForm
                    cp={cp}
                    draft={draft}
                    onChange={setDraft}
                    selectedHour={selectedHour}
                    onJump={(ms) => setJump({ ms, n: Date.now() })}
                    author={author}
                    saving={saving}
                    onSave={save}
                    history={queue.labels.filter((l) => l.changepoint_id === cp.uuid)}
                  />
                  {saveError && <p className="badge-fail text-xs mt-2">✕ {saveError}</p>}
                  {viewResolver !== null && viewResolver !== cp.resolver_asn && (
                    <p className="badge-warn text-xs mt-2">
                      ! The evidence shows resolver AS{viewResolver}; this changepoint is for AS{cp.resolver_asn}.
                    </p>
                  )}
                </>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function downloadJson(rows: unknown) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `changepoint-labels-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
