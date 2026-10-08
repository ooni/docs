import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFastpathHourly,
  fetchHourObservations,
  fetchObservationsHourly,
  fetchRuleCounts,
  HOUR_MEASUREMENTS_STEP,
} from "./api";
import type { HourObservations, HourProgress, PairScope } from "./api";
import { explorerChartUrl, stateSpans } from "./derive";
import type { AsnSummary, Window } from "./derive";
import HourlyBars, { SeriesLegend } from "./HourlyBars";
import type { ChartMark, ChartState } from "./HourlyBars";
import {
  FASTPATH_SERIES,
  fastpathHourly,
  HOUR_MS,
  hoursBetween,
  isoHour,
  OBSERVATION_SERIES,
  observationHourly,
  RULE_CLASS_SERIES,
  ruleClassHourly,
  rulesAt,
} from "./inspect";
import ObservationTables from "./ObservationTables";
import { LAYERS } from "./types";
import type { FastpathRow, Layer, ObservationAggRow, RuleCountsResponse } from "./types";

const fmt = new Intl.NumberFormat("en-US");

type Mode = "analysis" | "fastpath";
type RangeKey = "48h" | "7d" | "all";
const RANGE_HOURS: Record<Exclude<RangeKey, "all">, number> = { "48h": 48, "7d": 168 };

// Each source loads on its own so a slow one does not hold up the others
type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };

function useLoad<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ state: "loading" });
    fn(ctrl.signal).then(
      (data) => setLoad({ state: "ok", data }),
      (e) => !ctrl.signal.aborted && setLoad({ state: "error", message: String(e?.message ?? e) })
    );
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return load;
}

interface Props {
  probeCc: string;
  domain: string;
  asn: AsnSummary;
  resolverAsn: number;
  onResolverChange: (resolverAsn: number) => void;
  // an hour to open on, e.g. the changepoint that was clicked
  focusMs: number | null;
  win: Window;
  names: Map<number, string>;
  ooniApi: string;
  changepointApi: string;
  onClose: () => void;
}

export default function Inspector({
  probeCc,
  domain,
  asn,
  resolverAsn,
  onResolverChange,
  focusMs,
  win,
  names,
  ooniApi,
  changepointApi,
  onClose,
}: Props) {
  const scope: PairScope = useMemo(
    () => ({
      probeCc,
      domain,
      probeAsn: asn.asn,
      resolverAsn,
      startDate: win.startDate,
      endDate: win.endDate,
    }),
    [probeCc, domain, asn.asn, resolverAsn, win]
  );
  const scopeKey = JSON.stringify(scope);

  // Bring the inspector into view whenever it opens on a new pair or hour
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scopeKey, focusMs]);

  const rules = useLoad<RuleCountsResponse>((s) => fetchRuleCounts(changepointApi, scope, s), [scopeKey, changepointApi]);
  const fastpath = useLoad<FastpathRow[]>((s) => fetchFastpathHourly(ooniApi, scope, s), [scopeKey, ooniApi]);
  const obsAgg = useLoad<ObservationAggRow[]>((s) => fetchObservationsHourly(ooniApi, scope, s), [scopeKey, ooniApi]);

  const [mode, setMode] = useState<Mode>("analysis");
  const [selected, setSelected] = useState<number | null>(null);


  // ------------------------------------------------------------ range
  const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
  const [rangeStart, setRangeStart] = useState(win.startMs);
  const spanMs = rangeKey === "all" ? win.endMs - win.startMs : RANGE_HOURS[rangeKey] * HOUR_MS;
  const clampStart = (t: number) =>
    Math.max(win.startMs, Math.min(win.endMs - spanMs, Math.floor(t / HOUR_MS) * HOUR_MS));
  const centerOn = (ms: number, span = spanMs) =>
    setRangeStart(Math.max(win.startMs, Math.min(win.endMs - span, Math.floor((ms - span / 2) / HOUR_MS) * HOUR_MS)));

  // A new focus (clicked changepoint) recenters the range and selects its hour
  useEffect(() => {
    const t = focusMs ?? win.endMs - HOUR_MS;
    centerOn(t);
    setSelected(focusMs !== null ? Math.floor(focusMs / HOUR_MS) * HOUR_MS : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMs, win, scopeKey]);

  const start = rangeKey === "all" ? win.startMs : clampStart(rangeStart);
  const hours = useMemo(() => hoursBetween(start, start + spanMs), [start, spanMs]);

  const pickRange = (k: RangeKey) => {
    setRangeKey(k);
    if (k !== "all") {
      const span = RANGE_HOURS[k] * HOUR_MS;
      centerOn(selected ?? focusMs ?? win.endMs - HOUR_MS, span);
    }
  };

  // ------------------------------------------------------------ chart data
  const track = asn.tracks.find((t) => t.resolverAsn === resolverAsn);
  const marksFor = (layer: Layer | null): ChartMark[] =>
    (track?.events ?? [])
      .filter((e) => layer === null || e.layer === layer)
      .map((e) => ({
        ms: Date.parse(e.ts_hour),
        label: `${e.layer.toUpperCase()} ${e.state === "BLOCK" ? "▲" : "▼"}`,
        tone: e.state === "BLOCK" ? "block" : "ok",
      }));

  // What the detector believed about each layer of this pair, hour by hour
  const statesByLayer = useMemo(() => {
    const out = {} as Record<Layer, ChartState[]>;
    for (const l of LAYERS) out[l] = track ? stateSpans([track], l, win) : [];
    return out;
  }, [track, win]);

  const analysisByLayer = useMemo(() => {
    const out = {} as Record<Layer, ReturnType<typeof ruleClassHourly>>;
    for (const l of LAYERS) {
      out[l] = rules.state === "ok" ? ruleClassHourly(rules.data.hourly, l) : new Map();
    }
    return out;
  }, [rules]);
  const fastpathValues = useMemo(
    () => (fastpath.state === "ok" ? fastpathHourly(fastpath.data) : new Map()),
    [fastpath]
  );
  const obsHours = useMemo(
    () => (obsAgg.state === "ok" ? observationHourly(obsAgg.data) : null),
    [obsAgg]
  );

  // Blocked and unblocked measurements are always stacked together
  const measurementSeries = mode === "analysis" ? RULE_CLASS_SERIES : FASTPATH_SERIES;
  const measurementLoad: Load<unknown> = mode === "analysis" ? rules : fastpath;

  // ------------------------------------------------------------ hour detail
  const cache = useRef(new Map<string, HourObservations>());
  const [hourObs, setHourObs] = useState<Load<HourObservations> | null>(null);
  const [hourProgress, setHourProgress] = useState<HourProgress | null>(null);
  const [hourLimit, setHourLimit] = useState(HOUR_MEASUREMENTS_STEP);
  useEffect(() => setHourLimit(HOUR_MEASUREMENTS_STEP), [selected, scopeKey]);
  useEffect(() => {
    if (selected === null) {
      setHourObs(null);
      return;
    }
    const key = `${scopeKey}|${selected}|${hourLimit}`;
    const hit = cache.current.get(key);
    if (hit) {
      setHourObs({ state: "ok", data: hit });
      return;
    }
    // The hour's measurements come from the hourly observation aggregation
    setHourProgress(null);
    if (obsAgg.state === "error") {
      setHourObs({ state: "error", message: obsAgg.message });
      return;
    }
    if (!obsHours) {
      setHourObs({ state: "loading" });
      return;
    }
    const ctrl = new AbortController();
    setHourObs({ state: "loading" });
    fetchHourObservations(
      ooniApi,
      scope,
      selected,
      obsHours.uids.get(selected) ?? [],
      hourLimit,
      (p) => !ctrl.signal.aborted && setHourProgress(p),
      ctrl.signal
    ).then(
      (data) => {
        cache.current.set(key, data);
        setHourObs({ state: "ok", data });
      },
      (e) => !ctrl.signal.aborted && setHourObs({ state: "error", message: String(e?.message ?? e) })
    );
    return () => ctrl.abort();
  }, [selected, scopeKey, scope, ooniApi, hourLimit, obsAgg, obsHours]);

  const select = (h: number) => setSelected(h);

  const resolverOptions = asn.tracks
    .filter((t) => t.nMeasurements > 0 || t.events.length > 0)
    .sort((a, b) => b.nMeasurements - a.nMeasurements);
  const name = names.get(asn.asn);

  return (
    <section ref={rootRef} className="card inspector mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="card-title mb-1">Inspector</h2>
          <div className="text-lg font-black leading-tight">
            {name ?? `AS${asn.asn}`} <span className="text-muted font-medium text-sm">AS{asn.asn}</span>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-sm mt-1">
            <span className="text-secondary">via resolver</span>
            <select
              className="ed-input text-sm"
              value={resolverAsn}
              onChange={(e) => onResolverChange(Number(e.target.value))}
            >
              {resolverOptions.map((t) => {
                const blocked = LAYERS.filter((l) => t.finalState[l] === "BLOCK");
                return (
                  <option key={t.resolverAsn} value={t.resolverAsn}>
                    AS{t.resolverAsn}
                    {names.get(t.resolverAsn) ? ` ${names.get(t.resolverAsn)}` : ""} · {fmt.format(t.nMeasurements)} msmt
                    {blocked.length ? ` · BLOCKED ${blocked.join(" ").toUpperCase()}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <a
            className="link"
            href={explorerChartUrl(domain, probeCc, asn.asn, win.startDate, win.endDate)}
            target="_blank"
            rel="noreferrer"
          >
            Explorer chart
          </a>
          <button type="button" className="link" onClick={onClose}>
            close
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Segmented<RangeKey>
          value={rangeKey}
          options={[
            ["48h", "48 h"],
            ["7d", "7 days"],
            ["all", "window"],
          ]}
          onChange={pickRange}
        />
        {rangeKey !== "all" && (
          <span className="flex">
            <button
              type="button"
              className="seg-btn"
              aria-label="Earlier"
              disabled={start <= win.startMs}
              onClick={() => setRangeStart(clampStart(start - spanMs / 2))}
            >
              ◀
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-label="Later"
              disabled={start + spanMs >= win.endMs}
              onClick={() => setRangeStart(clampStart(start + spanMs / 2))}
            >
              ▶
            </button>
          </span>
        )}
        <span className="text-xs text-muted tabular-nums">
          {isoHour(start)} → {isoHour(start + spanMs)} UTC
        </span>
      </div>

      {/* ---------------------------------------------------- measurements */}
      <div className="panel">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="sub-title mb-0">Measurements</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<Mode>
              value={mode}
              options={[
                ["analysis", "Analysis rules"],
                ["fastpath", "Fastpath"],
              ]}
              onChange={setMode}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <SeriesLegend series={measurementSeries} />
            {mode === "analysis" && (
              <span className="flex items-center gap-3 text-xs text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="chart-swatch hb-state-swatch-BLOCK" /> detector blocked
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="chart-swatch hb-state-swatch-OK" /> detector ok
                </span>
              </span>
            )}
          </div>
          <span className="text-xs text-muted">
            {mode === "analysis"
              ? "rule class per measurement and layer · this resolver only"
              : `fastpath verdicts · every resolver of AS${asn.asn}`}
          </span>
        </div>
        <LoadState load={measurementLoad}>
          {mode === "analysis" ? (
            <div className="layer-charts">
              {LAYERS.map((l) => (
                <HourlyBars
                  key={l}
                  label={`${l.toUpperCase()} measurements`}
                  title={l.toUpperCase()}
                  hours={hours}
                  series={measurementSeries}
                  values={analysisByLayer[l]}
                  selected={selected}
                  onSelect={select}
                  marks={marksFor(l)}
                  states={statesByLayer[l]}
                  height={120}
                />
              ))}
            </div>
          ) : (
            <HourlyBars
              label="Measurements"
              hours={hours}
              series={measurementSeries}
              values={fastpathValues}
              selected={selected}
              onSelect={select}
              marks={marksFor(null)}
            />
          )}
        </LoadState>
        {selected !== null && (
          <HourRules
            hourMs={selected}
            rules={rules.state === "ok" ? rules.data : null}
            fastpath={fastpathValues.get(selected)}
          />
        )}
      </div>

      {/* ---------------------------------------------------- observations */}
      <div className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h3 className="sub-title mb-0">Observations</h3>
          <span className="text-xs text-muted">failures and successes · this resolver only</span>
        </div>
        <div className="mb-1">
          <SeriesLegend series={OBSERVATION_SERIES} />
        </div>
        <LoadState load={obsAgg}>
          <HourlyBars
            label="Observations"
            hours={hours}
            series={OBSERVATION_SERIES}
            values={obsHours?.values ?? new Map()}
            selected={selected}
            onSelect={select}
            marks={marksFor(null)}
            height={150}
            tooltipExtra={(h) => {
              const d = obsHours?.details.get(h);
              if (!d) return null;
              const fails = [...d.entries()].filter(([f]) => f !== "none").sort((a, b) => b[1] - a[1]);
              return fails.length ? (
                <div className="mt-1 border-t pt-1 border-[var(--grid)]">
                  {fails.slice(0, 6).map(([f, n]) => (
                    <div key={f} className="font-mono">
                      {n} {f}
                    </div>
                  ))}
                </div>
              ) : null;
            }}
          />
        </LoadState>
      </div>

      {/* ---------------------------------------------------- hour detail */}
      <div className="panel">
        <h3 className="sub-title">Observations in the selected hour</h3>
        {selected === null && (
          <p className="text-sm text-muted">Click a bar in either chart to load the observations of that hour.</p>
        )}
        {hourObs?.state === "loading" && (
          <div>
            <p className="text-sm mb-2">
              Loading the observations of {isoHour(selected as number)} UTC
              {hourProgress && hourProgress.total > 0
                ? ` — ${hourProgress.done} / ${hourProgress.total} lookups (analysis, observations per measurement, control)`
                : " — waiting for the hourly observation counts…"}
            </p>
            <div className="progress-track">
              {hourProgress && hourProgress.total > 0 ? (
                <div
                  className="progress-fill"
                  style={{ width: `${(hourProgress.done / hourProgress.total) * 100}%` }}
                />
              ) : (
                <div className="progress-sweep" />
              )}
            </div>
          </div>
        )}
        {hourObs?.state === "error" && <p className="badge-fail text-sm">✕ {hourObs.message}</p>}
        {hourObs?.state === "ok" && selected !== null && (
          <ObservationTables
            data={hourObs.data}
            hourMs={selected}
            fastpath={fastpathValues.get(selected)}
            ooniApi={ooniApi}
            onLoadMore={() => setHourLimit((n) => n + HOUR_MEASUREMENTS_STEP)}
          />
        )}
      </div>
    </section>
  );
}

// The rules that scored the measurements of one hour, per layer
function HourRules({
  hourMs,
  rules,
  fastpath,
}: {
  hourMs: number;
  rules: RuleCountsResponse | null;
  fastpath: Record<string, number> | undefined;
}) {
  const rows = rules ? rulesAt(rules.hourly, hourMs) : [];
  return (
    <div className="hour-detail mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h4 className="sub-title mb-0">Rules fired · {isoHour(hourMs)} UTC</h4>
        <span className="text-xs text-secondary tabular-nums">
          fastpath:{" "}
          {fastpath
            ? FASTPATH_SERIES.map((s) => `${fastpath[s.key] ?? 0} ${s.label}`).join(" · ")
            : "no measurements"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No scored measurements from this resolver in the hour.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 rules-grid">
          {LAYERS.map((l) => {
            const lr = rows.filter((r) => r.layer === l);
            return (
              <div key={l} className="rules-col">
                <div className="rules-col-head">{l.toUpperCase()}</div>
                {lr.length === 0 && <div className="text-xs text-muted px-2 py-1">—</div>}
                {lr.map((r) => (
                  <div key={r.rule_id} className={`rule-row rule-${r.class}`}>
                    <span className="font-mono truncate" title={r.rule_id}>
                      {r.rule_id}
                    </span>
                    <span className="rule-class">{r.class}</span>
                    <span className="tabular-nums font-bold">{r.count}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <span className="flex" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={`seg-btn ${v === value ? "seg-btn-on" : ""}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

function LoadState<T>({ load, children }: { load: Load<T>; children: React.ReactNode }) {
  if (load.state === "loading")
    return (
      <div className="py-6">
        <div className="progress-track">
          <div className="progress-sweep" />
        </div>
      </div>
    );
  if (load.state === "error") return <p className="badge-fail text-sm py-4">✕ {load.message}</p>;
  return <>{children}</>;
}

