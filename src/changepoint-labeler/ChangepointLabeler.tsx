import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCountries, fetchNetworkNames } from "../event-dashboard/api";
import { readConfig } from "../event-dashboard/config";
import { isoDay, summarizeAsns } from "../event-dashboard/derive";
import type { AsnSummary, Window } from "../event-dashboard/derive";
import type { ChartMark } from "../event-dashboard/HourlyBars";
import { isoHour } from "../event-dashboard/inspect";
import Inspector from "../event-dashboard/Inspector";
import {
  createLabel,
  currentLabels,
  detectCached,
  listStoredChangepoints,
  postedLabels,
} from "./labelApi";
import type { DetectionScope } from "./labelApi";
import LabelForm, { draftFromLabel, emptyDraft, TIME_META, validate } from "./LabelForm";
import type { Draft } from "./LabelForm";
import type { ChangepointLabel, ChangepointQuery, StoredChangepoint } from "./types";
import { TIME_FIELDS } from "./types";
import "../event-dashboard/event-dashboard.css";
import "./labeler.css";

const AUTHOR_KEY = "cp-labeler:author";
const DAY_MS = 864e5;
// History shown around the queue's range when judging a changepoint
const CONTEXT_DAYS = 7;

type Filter = "unlabeled" | "all";

interface Queue {
  query: ChangepointQuery;
  cps: StoredChangepoint[];
  labels: ChangepointLabel[];
}

type Status = { phase: "idle" } | { phase: "loading" } | { phase: "error"; message: string };

type Evidence =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; asns: AsnSummary[] };

const readAuthor = () => {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
};

// A country's flag emoji: its two letters as Unicode regional indicators
const flag = (cc: string): string =>
  /^[A-Z]{2}$/.test(cc)
    ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : "";

const shiftDay = (d: string, days: number) => isoDay(Date.parse(d + "T00:00:00Z") + days * DAY_MS);

// The window a changepoint is judged over: the queue's range plus a week on
// each side, never past today
function scopeOf(cp: StoredChangepoint, q: ChangepointQuery): DetectionScope {
  const today = isoDay(Date.now());
  const until = shiftDay(q.until, CONTEXT_DAYS);
  return {
    probe_cc: cp.probe_cc,
    domain: cp.domain,
    since: shiftDay(q.since, -CONTEXT_DAYS),
    until: until > today ? today : until,
  };
}

const windowOf = (s: DetectionScope): Window => ({
  startDate: s.since,
  endDate: s.until,
  startMs: Date.parse(s.since + "T00:00:00Z"),
  endMs: Date.parse(s.until + "T00:00:00Z") + DAY_MS,
});

export default function ChangepointLabeler() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const config = useMemo(() => readConfig(params), [params]);

  const [author, setAuthor] = useState(readAuthor);
  useEffect(() => {
    try {
      localStorage.setItem(AUTHOR_KEY, author);
    } catch {
      /* private mode: the name just is not remembered */
    }
  }, [author]);

  const [query, setQuery] = useState<ChangepointQuery>(() => ({
    since: params.get("since") ?? isoDay(Date.now() - 7 * DAY_MS),
    until: params.get("until") ?? isoDay(Date.now()),
  }));
  const [countryNames, setCountryNames] = useState<Map<string, string>>(new Map());
  const [names, setNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    fetchCountries(config.ooniApi).then(
      (cs) => setCountryNames(new Map(cs.map((c) => [c.alpha_2, c.name]))),
      () => {}
    );
    fetchNetworkNames(config.ooniApi).then(setNames, () => {});
  }, [config.ooniApi]);

  const [queue, setQueue] = useState<Queue | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [currentId, setCurrentId] = useState<string | null>(params.get("cp"));
  const [filter, setFilter] = useState<Filter>("unlabeled");
  const [ccFilter, setCcFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [jump, setJump] = useState<{ ms: number; n: number } | null>(null);
  const [viewResolver, setViewResolver] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const complete = !!query.since && !!query.until && query.since <= query.until;

  const load = useCallback(
    async (q: ChangepointQuery) => {
      setStatus({ phase: "loading" });
      try {
        const cps = await listStoredChangepoints(config.changepointApi, q);
        const labels = postedLabels(cps.map((c) => c.uuid));
        setQueue({ query: q, cps, labels });
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
    [config.changepointApi]
  );

  // Opening the page loads its range straight away
  useEffect(() => {
    if (complete) load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!queue) return;
    const q = new URLSearchParams(window.location.search);
    q.set("since", queue.query.since);
    q.set("until", queue.query.until);
    if (currentId) q.set("cp", currentId);
    else q.delete("cp");
    window.history.replaceState(null, "", "?" + q);
  }, [queue, currentId]);

  const labelled = useMemo(() => currentLabels(queue?.labels ?? []), [queue]);
  const cp = queue?.cps.find((c) => c.uuid === currentId) ?? null;
  const countries = useMemo(() => [...new Set((queue?.cps ?? []).map((c) => c.probe_cc))].sort(), [queue]);
  const domains = useMemo(
    () =>
      [...new Set((queue?.cps ?? []).filter((c) => !ccFilter || c.probe_cc === ccFilter).map((c) => c.domain))].sort(),
    [queue, ccFilter]
  );
  const visible = useMemo(
    () =>
      (queue?.cps ?? []).filter(
        (c) =>
          c.uuid === currentId ||
          ((filter === "all" || !labelled.has(c.uuid)) &&
            (!ccFilter || c.probe_cc === ccFilter) &&
            (!domainFilter || c.domain === domainFilter))
      ),
    [queue, filter, labelled, currentId, ccFilter, domainFilter]
  );

  // ------------------------------------------------------------ evidence
  // The detector's view of the changepoint's country and domain, recomputed
  // over the window around the queue and shared by its changepoints there
  const scope = useMemo(() => (cp && queue ? scopeOf(cp, queue.query) : null), [cp, queue]);
  const scopeKey = scope ? JSON.stringify(scope) : "";
  const win = useMemo(() => (scope ? windowOf(scope) : null), [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [evidence, setEvidence] = useState<Evidence>({ state: "loading" });
  useEffect(() => {
    if (!scope) return;
    let live = true;
    setEvidence({ state: "loading" });
    detectCached(config.changepointApi, scope).then(
      (resp) => live && setEvidence({ state: "ok", asns: summarizeAsns(resp) }),
      (e) => live && setEvidence({ state: "error", message: String(e?.message ?? e) })
    );
    return () => {
      live = false;
    };
  }, [scopeKey, config.changepointApi]); // eslint-disable-line react-hooks/exhaustive-deps

  const asn: AsnSummary | null = useMemo(() => {
    if (!cp || evidence.state !== "ok") return null;
    return (
      evidence.asns.find((a) => a.asn === cp.probe_asn) ?? {
        asn: cp.probe_asn,
        nMeasurements: 0,
        events: [],
        tracks: [],
        blockedAtEnd: new Set(),
        decidedLayers: new Set(),
      }
    );
  }, [cp, evidence]);

  // ------------------------------------------------------------ drafts
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
      const row = await createLabel(config.changepointApi, {
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
      // on to the next changepoint still without a label, in the same view
      const after = currentLabels(labels);
      const todo = (c: StoredChangepoint) =>
        !after.has(c.uuid) && (!ccFilter || c.probe_cc === ccFilter) && (!domainFilter || c.domain === domainFilter);
      const i = queue.cps.findIndex((c) => c.uuid === cp.uuid);
      const next = queue.cps.slice(i + 1).find(todo) ?? queue.cps.find(todo);
      if (next) setCurrentId(next.uuid);
    } catch (e) {
      setSaveError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const labelMarks: ChartMark[] = TIME_FIELDS.flatMap((f) =>
    draft.times[f] !== null
      ? [{ ms: draft.times[f] as number, label: TIME_META[f].label.toUpperCase(), tone: "label" as const }]
      : []
  );

  const nLabelled = queue ? queue.cps.filter((c) => labelled.has(c.uuid)).length : 0;
  const onSelectedHour = useCallback((h: number | null) => setSelectedHour(h), []);
  const country = (cc: string) => countryNames.get(cc) ?? cc;

  return (
    <div className="ed-root min-h-screen">
      <div className="lab-wrap">
        <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight">Changepoint labeler</h1>
            <p className="text-sm text-muted mt-1">
              Check each change the detector stored against the measurements and record what the network
              was really doing.
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

        <form
          className="card mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete) load(query);
          }}
        >
          <div className="flex flex-wrap gap-3 items-end">
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
            <span className="text-xs text-muted">Every changepoint the detector stored in the range (UTC).</span>
          </div>
        </form>

        {status.phase === "loading" && (
          <div className="card progress-card mb-4">
            <p className="text-sm mb-2">Loading stored changepoints…</p>
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
          <p className="text-sm text-muted">
            No changepoints stored between {queue.query.since} and {queue.query.until}.
          </p>
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
              <div className="grid grid-cols-2 gap-1 mb-2">
                <select
                  className="ed-input text-xs"
                  value={ccFilter}
                  onChange={(e) => {
                    setCcFilter(e.target.value);
                    setDomainFilter("");
                  }}
                  aria-label="Country"
                >
                  <option value="">all countries</option>
                  {countries.map((cc) => (
                    <option key={cc} value={cc}>
                      {flag(cc)} {cc} {country(cc)}
                    </option>
                  ))}
                </select>
                <select
                  className="ed-input text-xs"
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                  aria-label="Domain"
                >
                  <option value="">all domains</option>
                  {domains.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
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
                          <span aria-hidden="true">{flag(c.probe_cc)}</span> <strong>{c.probe_cc}</strong>{" "}
                          <span className="font-mono">{c.domain}</span>
                        </span>
                        <span className="flex items-baseline justify-between gap-1 text-xs text-muted">
                          <span className="truncate">
                            {names.get(c.probe_asn) ?? `AS${c.probe_asn}`} · via AS{c.resolver_asn}
                          </span>
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
                {visible.length === 0 && <li className="text-xs text-muted p-2">Everything here is labelled.</li>}
              </ol>
              <p className="text-[0.65rem] text-muted mt-2">
                <kbd>n</kbd> next · <kbd>p</kbd> previous. Labelled = labelled from this browser: the API
                cannot list labels yet.
              </p>
            </aside>

            <main className="min-w-0">
              {cp && (
                <>
                  <div className="lab-cp-head mb-3">
                    <span className={`lab-cp lab-cp-${cp.state}`}>
                      {cp.layer.toUpperCase()} {cp.state === "BLOCK" ? "blocking started" : "blocking ended"}
                    </span>
                    <span className="tabular-nums font-bold">{isoHour(Date.parse(cp.ts_hour))} UTC</span>
                    <span>
                      <span className="font-mono font-bold">{cp.domain}</span> in{" "}
                      <span aria-hidden="true">{flag(cp.probe_cc)}</span> {country(cp.probe_cc)}
                    </span>
                    <span>
                      {names.get(cp.probe_asn) ?? `AS${cp.probe_asn}`} AS{cp.probe_asn} · via resolver AS
                      {cp.resolver_asn}
                    </span>
                    <span className="text-muted tabular-nums">
                      evidence {(cp.state === "BLOCK" ? cp.s_pos : cp.s_neg).toFixed(1)} vs threshold {cp.h}
                    </span>
                    <span className="text-muted font-mono text-[0.65rem]">{cp.uuid}</span>
                  </div>
                  {evidence.state === "loading" && (
                    <div className="card progress-card">
                      <p className="text-sm mb-2">
                        Recomputing the detector for {cp.domain} in {country(cp.probe_cc)}
                        {scope && ` over ${scope.since} → ${scope.until}`}… this can take tens of seconds, and
                        is reused for every changepoint of the same country and domain.
                      </p>
                      <div className="progress-track">
                        <div className="progress-sweep" />
                      </div>
                    </div>
                  )}
                  {evidence.state === "error" && (
                    <div className="card card-error">
                      <p className="badge-fail text-sm">✕ {evidence.message}</p>
                    </div>
                  )}
                  {evidence.state === "ok" && asn && win && (
                    <Inspector
                      key={cp.uuid}
                      title="Evidence"
                      probeCc={cp.probe_cc}
                      domain={cp.domain}
                      asn={asn}
                      resolverAsn={viewResolver ?? cp.resolver_asn}
                      onResolverChange={setViewResolver}
                      focusMs={jump ? jump.ms + (jump.n % 2) : Date.parse(cp.ts_hour)}
                      win={win}
                      names={names}
                      ooniApi={config.ooniApi}
                      changepointApi={config.changepointApi}
                      extraMarks={labelMarks}
                      onSelectedHourChange={onSelectedHour}
                      autoScroll={false}
                    />
                  )}
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
