import { useRef, useState } from "react";
import { CHART_L, CHART_R, CHART_W, type Marker, type ZoomRange } from "../event-labeler/Timeline";
import { assignOutcomeColors, LAYER_COLORS } from "../event-labeler/outcomes";
import type { AnalysisBucket, AnalysisSeries } from "./api";

export interface AnalysisChartProps {
  series: AnalysisSeries;
  /** Bucket size, so the lines can break across buckets nobody measured. */
  grain: "hour" | "day";
  /** Shared with the observation chart above, so the two axes line up. */
  domain: { t0: number; t1: number };
  /** The adjudicated week, shaded exactly as it is in the chart above. */
  week: { start: number; end: number };
  zoom: ZoomRange | null;
  onZoom: (z: ZoomRange | null) => void;
  markers: Marker[];
}

const W = CHART_W;
const L = CHART_L;
const R = CHART_R;
const TOP = 6;
const GAP = 7;
const AXIS = 16;
const STRIP = 13;
const DRAG_MIN = 8;
// Each panel reserves a row for its label. Without it the label sits exactly
// where a series pinned at 1.0 is drawn — and `dns_ok` is pinned at 1.0 nearly
// always, so the collision is the common case rather than the edge one.
const LABEL_H = 12;

interface PanelSpec {
  key: string;
  label: string;
  /** Lines drawn in this panel, all on a 0–1 scale. */
  lines: { key: string; label: string; color: string; dash?: string; get: (b: AnalysisBucket) => number | null }[];
  note?: string;
  height: number;
}

const PANELS: PanelSpec[] = [
  {
    key: "prob",
    label: "blocking probability",
    height: 64,
    lines: [
      // Not amber: the week band is amber in both charts, and a headline line
      // the same colour as the band it crosses is unreadable exactly where it
      // matters.
      { key: "mean", label: "blocked_probability_mean", color: "#f0f4fa", get: (b) => b.blockedMean },
      { key: "max", label: "blocked_max", color: "#b5c0cc", dash: "3 2", get: (b) => b.blockedMax },
    ],
    // Named after the fields rather than "mean" and "max", because they are
    // not a mean and a max *of the same quantity*: the first averages the
    // per-measurement blocking probability, the second is the largest
    // per-layer score. Either can exceed the other, and a bucket reading
    // mean 0.99 next to max 0.90 is not a bug.
    note: "different statistics, not bounds on each other",
  },
  {
    key: "layers",
    label: "blocked, by layer",
    height: 56,
    lines: [
      { key: "dns", label: "dns", color: LAYER_COLORS.dns, get: (b) => b.layers.dns.blocked },
      { key: "tcp", label: "tcp", color: LAYER_COLORS.tcp, get: (b) => b.layers.tcp.blocked },
      { key: "tls", label: "tls", color: LAYER_COLORS.tls, get: (b) => b.layers.tls.blocked },
    ],
    note: "componentwise maxima over the bucket",
  },
  {
    key: "dns",
    label: "dns: ok / down / blocked",
    height: 56,
    lines: [
      { key: "dns_ok", label: "ok", color: "#7dd195", get: (b) => b.layers.dns.ok },
      { key: "dns_down", label: "down", color: "#868e96", get: (b) => b.layers.dns.down },
      { key: "dns_blocked", label: "blocked", color: "#ff7359", get: (b) => b.layers.dns.blocked },
    ],
    // The reason these are three lines and not a stack, in the one place an
    // analyst might otherwise read them as parts of a whole.
    note: "three independent maxima, not a distribution — they routinely sum above 1",
  },
];

const fmt = (v: number | null | undefined, digits = 2) => (v == null ? "—" : v.toFixed(digits));
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/**
 * What the pipeline concluded, under what the probes got.
 *
 * Only rendered after a commit. Every value here is the output of the thing
 * this corpus exists to evaluate, so showing it beforehand would not merely
 * anchor the analyst — with `detector_alerted` as a stratum it would hand them
 * the answer. Afterwards it is the most useful panel on the page: it is where
 * you see *why* the detector did or did not fire on a week you have already
 * judged on the evidence.
 */
export default function AnalysisChart({
  series,
  grain,
  domain,
  week,
  zoom,
  onZoom,
  markers,
}: AnalysisChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const H = TOP + PANELS.reduce((s, p) => s + p.height + GAP, 0) + STRIP + GAP + AXIS;
  const iw = W - L - R;
  const plotBottom = TOP + PANELS.reduce((s, p) => s + p.height + GAP, 0) + STRIP;

  const t0 = domain.t0;
  const t1 = domain.t1;
  const span = Math.max(t1 - t0, 1);
  const X = (ms: number) => L + ((ms - t0) / span) * iw;
  const timeAt = (x: number) => t0 + ((x - L) / iw) * span;

  const visible = series.buckets.filter((b) => b.t.getTime() >= t0 && b.t.getTime() <= t1);
  const has = visible.length > 0;

  const colors = assignOutcomeColors(series.outcomeKinds);

  const bw =
    visible.length > 1
      ? Math.max(
          (Math.min(...visible.slice(1).map((b, i) => b.t.getTime() - visible[i].t.getTime())) / span) * iw - 0.5,
          0.8
        )
      : Math.max(iw / 24, 4);

  const panelTop = (i: number) => TOP + PANELS.slice(0, i).reduce((s, p) => s + p.height + GAP, 0);
  const stripTop = TOP + PANELS.reduce((s, p) => s + p.height + GAP, 0);

  // Broken across gaps: the aggregation returns a bucket only where something
  // was measured, so consecutive rows can be days apart. Joining those draws a
  // trend through hours nobody measured — the same reason the observation
  // chart above is bars rather than a line.
  const maxGap = (grain === "hour" ? 3600e3 : 864e5) * 1.5;

  const linePath = (bs: AnalysisBucket[], get: (b: AnalysisBucket) => number | null, base: number, ih: number) => {
    let d = "";
    let pen = false;
    let prev = 0;
    for (const b of bs) {
      const v = get(b);
      const t = b.t.getTime();
      if (v == null) {
        pen = false;
        continue;
      }
      if (pen && t - prev > maxGap) pen = false;
      d += `${pen ? "L" : "M"}${X(t).toFixed(1)},${(base - v * ih).toFixed(1)}`;
      pen = true;
      prev = t;
    }
    return d;
  };

  // A lone scored bucket surrounded by gaps draws no line segment at all, so
  // mark every sample: an isolated point is data, not absence.
  const dots = (bs: AnalysisBucket[], get: (b: AnalysisBucket) => number | null, base: number, ih: number, color: string, key: string) =>
    bs.map((b, i) => {
      const v = get(b);
      return v == null ? null : (
        <circle key={`${key}-${i}`} cx={X(b.t.getTime())} cy={base - v * ih} r={1.3} fill={color} />
      );
    });

  const svgPoint = (evt: React.MouseEvent) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return null;
    return { x: ((evt.clientX - box.left) / box.width) * W, y: ((evt.clientY - box.top) / box.height) * H };
  };

  const nearest = (ms: number): AnalysisBucket | null =>
    has
      ? visible.reduce(
          (best, b) => (Math.abs(b.t.getTime() - ms) < Math.abs(best.t.getTime() - ms) ? b : best),
          visible[0]
        )
      : null;

  const onMouseMove = (evt: React.MouseEvent) => {
    const p = svgPoint(evt);
    const box = wrapRef.current?.getBoundingClientRect();
    if (!p || !box || !has) return;
    if (drag) {
      setDrag({ ...drag, to: p.x });
      setTip(null);
      return;
    }
    const b = nearest(timeAt(p.x));
    if (!b) return setTip(null);
    setTip({
      x: evt.clientX - box.left + 12,
      y: Math.max(evt.clientY - box.top - 10, 4),
      lines: [
        `${b.t.toISOString().slice(0, 16).replace("T", " ")}Z   n=${b.count}`,
        `blocked_probability_mean ${fmt(b.blockedMean)}`,
        `blocked_max              ${fmt(b.blockedMax)}`,
        b.maxOutcome && (b.blockedMax ?? 0) > 0 ? `reason        ${b.maxOutcome}` : "",
        `dns   ok ${fmt(b.layers.dns.ok, 2)}  down ${fmt(b.layers.dns.down, 2)}  blk ${fmt(b.layers.dns.blocked, 2)}` +
          (b.layers.dns.outcome ? `  (${b.layers.dns.outcome})` : ""),
        `tcp   ok ${fmt(b.layers.tcp.ok, 2)}  down ${fmt(b.layers.tcp.down, 2)}  blk ${fmt(b.layers.tcp.blocked, 2)}`,
        `tls   ok ${fmt(b.layers.tls.ok, 2)}  down ${fmt(b.layers.tls.down, 2)}  blk ${fmt(b.layers.tls.blocked, 2)}`,
      ].filter(Boolean),
    });
  };

  const onMouseUp = (evt: React.MouseEvent) => {
    const p = svgPoint(evt);
    const d = drag;
    setDrag(null);
    if (!p || !d || !has) return;
    if (Math.abs(p.x - d.from) < DRAG_MIN) return;
    const lo = timeAt(Math.min(d.from, p.x));
    const hi = timeAt(Math.max(d.from, p.x));
    if (hi - lo > 0) onZoom({ lo, hi });
  };

  const weekLo = X(Math.max(week.start, t0));
  const weekHi = X(Math.min(week.end, t1));

  return (
    <div id="chartWrap" ref={wrapRef} className="analysis-chart">
      <svg
        id="chart"
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H }}
        onMouseDown={(e) => {
          const p = svgPoint(e);
          if (p && has) setDrag({ from: p.x, to: p.x });
        }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          setTip(null);
          setDrag(null);
        }}
      >
        {week.end > t0 && week.start < t1 && (
          <>
            <rect
              x={weekLo}
              y={TOP}
              width={Math.max(weekHi - weekLo, 2)}
              height={plotBottom - TOP}
              fill="#ffb84d"
              opacity={0.14}
            />
            <rect x={weekLo} y={TOP} width={Math.max(weekHi - weekLo, 2)} height={2} fill="#ffb84d" opacity={0.9} />
          </>
        )}

        {PANELS.map((panel, pi) => {
          const top = panelTop(pi);
          const plotTop = top + LABEL_H;
          const ih = panel.height - LABEL_H;
          const base = plotTop + ih;
          return (
            <g key={panel.key}>
              <rect x={L} y={plotTop} width={W - L - R} height={ih} fill="#131820" opacity={0.45} />
              <line x1={L} x2={W - R} y1={base} y2={base} stroke="#323d4d" />
              <line
                x1={L}
                x2={W - R}
                y1={base - ih / 2}
                y2={base - ih / 2}
                stroke="#323d4d"
                opacity={0.4}
                strokeDasharray="2 4"
              />
              <text x={4} y={plotTop + 7} className="axis">
                1.0
              </text>
              <text x={4} y={base} className="axis">
                0
              </text>
              <text x={L + 2} y={top + 9} className="axis facet-label">
                {panel.label}
              </text>
              {has &&
                panel.lines.map((ln) => (
                  <g key={ln.key}>
                    <path
                      d={linePath(visible, ln.get, base, ih)}
                      fill="none"
                      stroke={ln.color}
                      strokeWidth={1.5}
                      strokeDasharray={ln.dash}
                    />
                    {dots(visible, ln.get, base, ih, ln.color, ln.key)}
                  </g>
                ))}
            </g>
          );
        })}

        {/* The reason strip: which outcome carried the bucket's blocked_max. */}
        <text x={4} y={stripTop + STRIP - 3} className="axis">
          reason
        </text>
        <rect x={L} y={stripTop} width={W - L - R} height={STRIP} fill="#131820" opacity={0.45} />
        {has &&
          visible.map((b, i) =>
            b.maxOutcome && (b.blockedMax ?? 0) > 0 ? (
              <rect
                key={i}
                x={X(b.t.getTime()) - bw / 2}
                y={stripTop}
                width={bw}
                height={STRIP}
                fill={colors[b.maxOutcome] || "#868e96"}
                opacity={Math.max(0.35, Math.min(b.blockedMax ?? 0, 1))}
              />
            ) : null
          )}

        {markers.map((m, i) =>
          m.t >= t0 && m.t <= t1 ? (
            <line
              key={i}
              x1={X(m.t)}
              x2={X(m.t)}
              y1={TOP}
              y2={plotBottom}
              stroke={m.color}
              strokeWidth={1.2}
              opacity={0.8}
              strokeDasharray="4 3"
            />
          ) : null
        )}

        {drag && Math.abs(drag.to - drag.from) >= DRAG_MIN && (
          <rect
            x={Math.min(drag.from, drag.to)}
            y={TOP}
            width={Math.abs(drag.to - drag.from)}
            height={plotBottom - TOP}
            fill="#f0f4fa"
            opacity={0.16}
          />
        )}

        <text x={L} y={H - 4} className="axis">
          {stamp(t0)}
        </text>
        <text x={W - R} y={H - 4} className="axis" textAnchor="end">
          {stamp(t1)}
        </text>
      </svg>

      {tip && (
        <div id="tip" style={{ left: tip.x, top: tip.y }}>
          {tip.lines.join("\n")}
        </div>
      )}

      <div className="legend">
        {PANELS.flatMap((p) =>
          p.lines.map((ln) => (
            <span key={p.key + ln.key}>
              <i className="swatch" style={{ background: ln.color }} />
              {p.key === "dns" ? `dns ${ln.label}` : ln.label}
            </span>
          ))
        )}
      </div>
      {series.outcomeKinds.length > 0 && (
        <div className="legend">
          {series.outcomeKinds.map((o) => (
            <span key={o}>
              <i className="swatch" style={{ background: colors[o] }} />
              {o}
            </span>
          ))}
        </div>
      )}
      <div className="stat" style={{ marginTop: 4 }}>
        {series.note} · {PANELS.find((p) => p.key === "prob")?.note} ·{" "}
        {PANELS.find((p) => p.key === "dns")?.note}
      </div>
    </div>
  );
}
