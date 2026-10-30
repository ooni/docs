import { useMemo, useState } from "react";
import { eventKey, formatHour, isoDay, nowState, stateSpans } from "./derive";
import type { AsnSummary, ResolverTrack, StateSpan, Window } from "./derive";
import { LAYERS } from "./types";
import type { Changepoint, Layer } from "./types";

// Fixed drawing width; the svg scales to its container through the viewBox
const W = 1000;
const LABEL_W = 200;
const NOW_W = 84;
const NOW_X = W - NOW_W;
const PLOT_X0 = LABEL_W;
const PLOT_W = NOW_X - 10 - PLOT_X0;
const AXIS_H = 26;
const HEADER_H = 30;
const STRIPE_H = 10;
const STRIPE_GAP = 3;
const ROW_H = 3 * STRIPE_H + 2 * STRIPE_GAP + 12;
const GROUP_GAP = 12;
const DAY_MS = 24 * 3600 * 1000;

export const LAYER_LABEL: Record<Layer, string> = {
  dns: "DNS",
  tcp: "TCP",
  tls: "TLS",
};

const fmt = new Intl.NumberFormat("en-US");

// Each network is a header plus either one lane overlaying all of its
// resolver pairs (collapsed) or one lane per resolver pair (expanded)
type Row =
  | { kind: "header"; y: number; asn: AsnSummary; expanded: boolean }
  | {
      kind: "lane";
      y: number;
      asn: AsnSummary;
      tracks: ResolverTrack[];
      label: string;
      // set on a per-resolver lane
      resolverAsn: number | null;
    };

interface Tip {
  event: Changepoint;
  xPct: number;
  yPx: number;
}

interface Props {
  asns: AsnSummary[]; // in the order they should be stacked
  names: Map<number, string>;
  win: Window;
  selectedEvent: string | null;
  onSelectEvent: (e: Changepoint | null) => void;
  // the (network, resolver) open in the inspector
  inspected: { asn: number; resolverAsn: number } | null;
  // resolverAsn null: the network's lane, the inspector picks a resolver
  onInspect: (asn: number, resolverAsn: number | null) => void;
}

const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

const NOW_TEXT = { BLOCK: "BLOCKED", OK: "OK", UNK: "NO VERDICT" } as const;

const spanTitle = (layer: Layer, s: StateSpan) => {
  const what =
    s.state === "BLOCK"
      ? s.total > 1
        ? `blocked on ${s.blocked} of ${s.total} resolvers`
        : "blocked"
      : s.state === "OK"
        ? "ok"
        : "no verdict";
  const iso = (ms: number) => formatHour(new Date(ms).toISOString());
  return `${LAYER_LABEL[layer]} ${what}\n${iso(s.startMs)} → ${iso(s.endMs)}`;
};

export default function EventTimeline({
  asns,
  names,
  win,
  selectedEvent,
  onSelectEvent,
  inspected,
  onInspect,
}: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const allOpen = asns.every((a) => expanded.has(a.asn));
  const toggleExpanded = (asn: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(asn)) next.delete(asn);
      else next.add(asn);
      return next;
    });

  const xOf = (ms: number) =>
    PLOT_X0 + ((ms - win.startMs) / (win.endMs - win.startMs)) * PLOT_W;
  const stripeY = (rowY: number, layer: Layer) =>
    rowY + 6 + LAYERS.indexOf(layer) * (STRIPE_H + STRIPE_GAP);

  const { rows, height } = useMemo(() => {
    const rows: Row[] = [];
    let y = AXIS_H + 6;
    for (const asn of asns) {
      const isOpen = expanded.has(asn.asn);
      rows.push({ kind: "header", y, asn, expanded: isOpen });
      y += HEADER_H;
      const tracks = asn.tracks.filter(
        (t) => t.nMeasurements > 0 || t.events.length > 0
      );
      if (isOpen) {
        // blocked resolvers first, then by measurement count
        const blockedNow = (t: ResolverTrack) =>
          LAYERS.some((l) => t.finalState[l] === "BLOCK") ? 1 : 0;
        const sorted = [...tracks].sort(
          (a, b) => blockedNow(b) - blockedNow(a) || b.nMeasurements - a.nMeasurements
        );
        for (const t of sorted) {
          const name = names.get(t.resolverAsn);
          rows.push({
            kind: "lane",
            y,
            asn,
            tracks: [t],
            label: `via ${name ? truncate(name, 16) + " " : ""}AS${t.resolverAsn}`,
            resolverAsn: t.resolverAsn,
          });
          y += ROW_H;
        }
      } else {
        rows.push({
          kind: "lane",
          y,
          asn,
          tracks,
          label: `all ${tracks.length} resolver${tracks.length === 1 ? "" : "s"}`,
          resolverAsn: null,
        });
        y += ROW_H;
      }
      y += GROUP_GAP;
    }
    return { rows, height: y };
  }, [asns, expanded, names]);

  const days = useMemo(() => {
    const out: number[] = [];
    for (let t = win.startMs; t < win.endMs; t += DAY_MS) out.push(t);
    return out;
  }, [win]);
  const labelEvery = Math.max(1, Math.ceil(days.length / 10));

  const showTip = (event: Changepoint, x: number, y: number) =>
    setTip({ event, xPct: Math.min(78, Math.max(2, (x / W) * 100)), yPx: y });

  const renderLane = (r: Extract<Row, { kind: "lane" }>) => {
    const n = r.tracks.reduce((acc, t) => acc + t.nMeasurements, 0);
    const events = r.tracks.flatMap((t) => t.events);
    const isInspected =
      inspected?.asn === r.asn.asn &&
      (r.resolverAsn === null
        ? !expanded.has(r.asn.asn)
        : inspected.resolverAsn === r.resolverAsn);
    const inspect = () => onInspect(r.asn.asn, r.resolverAsn);
    return (
      <g key={`l${r.asn.asn}/${r.label}`}>
        {isInspected && (
          <rect x={0} y={r.y} width={NOW_X - 4} height={ROW_H - 4} className="tl-inspected" />
        )}
        <g
          className="cursor-pointer tl-lane-label"
          role="button"
          tabIndex={0}
          aria-label={`Inspect ${r.label} of AS${r.asn.asn}`}
          onClick={inspect}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              inspect();
            }
          }}
        >
          <rect x={0} y={r.y} width={PLOT_X0 - 30} height={ROW_H - 4} fill="transparent" />
          <text x={14} y={r.y + 18} className="tl-track">
            {r.label}
          </text>
          <text x={14} y={r.y + 31} className="chart-tick">
            {fmt.format(n)} msmt · <tspan className="tl-inspect-cue">inspect ▸</tspan>
          </text>
        </g>
        {LAYERS.map((l) => {
          const y = stripeY(r.y, l);
          const spans = stateSpans(r.tracks, l, win);
          const now = spans[spans.length - 1];
          return (
            <g key={l}>
              <text x={PLOT_X0 - 6} y={y + STRIPE_H - 1.5} className="tl-layer" textAnchor="end">
                {LAYER_LABEL[l]}
              </text>
              {spans.map((s) => {
                const x = xOf(s.startMs);
                const w = Math.max(1, xOf(s.endMs) - x);
                if (s.state === "BLOCK") {
                  // always full strength; an overlay lane spells out how many
                  // of its resolvers were blocked
                  return (
                    <g key={s.startMs}>
                      <rect x={x} y={y} width={w} height={STRIPE_H} className="tl-block">
                        <title>{spanTitle(l, s)}</title>
                      </rect>
                      {s.total > 1 && w > 44 && (
                        <text x={x + 4} y={y + STRIPE_H - 2} className="tl-block-text">
                          {s.blocked}/{s.total} resolvers
                        </text>
                      )}
                    </g>
                  );
                }
                if (s.state === "OK") {
                  return (
                    <rect key={s.startMs} x={x} y={y + STRIPE_H / 2 - 1.5} width={w} height={3} className="tl-ok">
                      <title>{spanTitle(l, s)}</title>
                    </rect>
                  );
                }
                return (
                  <line key={s.startMs} x1={x} x2={x + w} y1={y + STRIPE_H / 2} y2={y + STRIPE_H / 2} className="tl-unk">
                    <title>{spanTitle(l, s)}</title>
                  </line>
                );
              })}
              <NowCell x={NOW_X} y={y} h={STRIPE_H} state={now.state} small />
            </g>
          );
        })}
        {events.map((e) => {
          const x = xOf(Date.parse(e.ts_hour));
          const y = stripeY(r.y, e.layer);
          const key = eventKey(e);
          const isSel = key === selectedEvent;
          return (
            <g
              key={key}
              className="cursor-pointer"
              tabIndex={0}
              role="button"
              aria-label={`${e.state === "BLOCK" ? "Blocking started" : "Blocking ended"} on ${e.layer} via AS${e.resolver_asn} at ${formatHour(e.ts_hour)}`}
              onPointerMove={() => showTip(e, x, r.y)}
              onFocus={() => showTip(e, x, r.y)}
              onBlur={() => setTip(null)}
              onClick={() => onSelectEvent(isSel ? null : e)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onSelectEvent(isSel ? null : e);
                }
              }}
              style={{ outline: "none" }}
            >
              <rect x={x - 4} y={y - 3} width={8} height={STRIPE_H + 6} fill="transparent" />
              {isSel && (
                <rect x={x - 3.5} y={y - 3.5} width={7} height={STRIPE_H + 7} className="tl-event-ring" />
              )}
              <rect x={x - 1} y={y - 2} width={2} height={STRIPE_H + 4} className="tl-event" />
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <section className="card mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="card-title mb-0">Timeline</h2>
        <button
          type="button"
          className="link text-xs"
          onClick={() =>
            setExpanded(allOpen ? new Set() : new Set(asns.map((a) => a.asn)))
          }
        >
          {allOpen ? "collapse resolvers" : "split every network per resolver"}
        </button>
      </div>
      <Legend />

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="block w-full chart-surface"
          // group, not img: the markers and network names inside are controls
          role="group"
          aria-label="Blocking state per network and layer over the window"
          onPointerLeave={() => setTip(null)}
        >
          {days.map((t, i) => (
            <g key={t}>
              <line x1={xOf(t)} x2={xOf(t)} y1={AXIS_H - 4} y2={height} className="chart-grid" />
              {i % labelEvery === 0 && (
                <text x={xOf(t) + 3} y={AXIS_H - 9} className="chart-tick">
                  {isoDay(t).slice(5)}
                </text>
              )}
            </g>
          ))}
          <line x1={xOf(win.endMs)} x2={xOf(win.endMs)} y1={AXIS_H - 14} y2={height} className="tl-now-line" />
          <text x={NOW_X} y={AXIS_H - 9} className="tl-now-head">
            NOW · {win.endDate.slice(5)}
          </text>

          {rows.map((r) => {
            if (r.kind === "lane") return renderLane(r);
            const name = names.get(r.asn.asn);
            const toggle = () => toggleExpanded(r.asn.asn);
            const n = r.asn.tracks.length;
            return (
              <g key={`h${r.asn.asn}`}>
                <line x1={0} x2={W} y1={r.y} y2={r.y} className="tl-group-rule" />
                <text
                  x={0}
                  y={r.y + 19}
                  className="tl-asn cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-expanded={r.expanded}
                  onClick={toggle}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      toggle();
                    }
                  }}
                >
                  <tspan className="tl-caret">{r.expanded ? "▾" : "▸"} </tspan>
                  {name ? truncate(name, 48) : `AS${r.asn.asn}`}
                  <tspan className="tl-asn-num"> AS{r.asn.asn}</tspan>
                </text>
                <text x={NOW_X - 14} y={r.y + 19} className="chart-tick" textAnchor="end">
                  {fmt.format(r.asn.nMeasurements)} msmt · {n} resolver{n === 1 ? "" : "s"} ·{" "}
                  {r.asn.events.length} event{r.asn.events.length === 1 ? "" : "s"}
                </text>
                <NowCell x={NOW_X} y={r.y + 5} h={20} state={nowState(r.asn)} />
              </g>
            );
          })}
        </svg>

        {tip && (
          <div
            className="chart-tooltip"
            style={{ left: `${tip.xPct}%`, top: `${((tip.yPx + ROW_H) / height) * 100}%` }}
          >
            <EventSummary event={tip.event} />
            <div className="text-muted mt-1">click to inspect</div>
          </div>
        )}
      </div>
    </section>
  );
}

function NowCell({
  x,
  y,
  h,
  state,
  small = false,
}: {
  x: number;
  y: number;
  h: number;
  state: "BLOCK" | "OK" | "UNK";
  small?: boolean;
}) {
  return (
    <g>
      <rect x={x} y={y} width={NOW_W} height={h} className={`tl-now tl-now-${state}`} />
      <text
        x={x + 5}
        y={y + h / 2 + (small ? 3 : 4)}
        className={`tl-now-text tl-now-text-${state} ${small ? "tl-now-text-sm" : ""}`}
      >
        {NOW_TEXT[state]}
      </text>
    </g>
  );
}

export function EventSummary({ event: e }: { event: Changepoint }) {
  const evidence = e.state === "BLOCK" ? e.s_pos : e.s_neg;
  return (
    <>
      <div className="font-semibold">
        <span className={e.state === "BLOCK" ? "badge-fail" : "badge-ok"}>
          {e.state === "BLOCK" ? "■ Blocking started" : "□ Blocking ended"}
        </span>{" "}
        · {LAYER_LABEL[e.layer]}
      </div>
      <div className="tabular-nums">{formatHour(e.ts_hour)}</div>
      <div className="text-secondary">
        AS{e.probe_asn} via resolver AS{e.resolver_asn}
      </div>
      <div className="text-muted tabular-nums">
        evidence {evidence.toFixed(1)} vs threshold {e.h}
      </div>
    </>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-secondary">
      <span className="flex items-center gap-1.5">
        <svg width="22" height="10" aria-hidden="true">
          <rect width="22" height="10" className="tl-block" />
        </svg>
        blocked
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="10" aria-hidden="true">
          <rect y="3.5" width="22" height="3" className="tl-ok" />
        </svg>
        ok
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="10" aria-hidden="true">
          <line x1="0" x2="22" y1="5" y2="5" className="tl-unk" />
        </svg>
        no verdict yet
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="8" height="14" aria-hidden="true">
          <rect x="3" width="2" height="14" className="tl-event" />
        </svg>
        detected change (click to inspect)
      </span>
      <span className="text-muted">
        A network lane is blocked when any of its resolvers is. Click a network
        name to split it per resolver, a lane label to inspect it.
      </span>
    </div>
  );
}
