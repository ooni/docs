import { useRef, useState } from "react";
import type { FacetSeries, OutcomeBucket } from "./api";
import { outcomeLabel } from "./outcomes";

export type BoundKey = "onset_earliest" | "onset_latest" | "resolution_earliest" | "resolution_latest";
export const BOUND_ORDER: BoundKey[] = [
  "onset_earliest",
  "onset_latest",
  "resolution_earliest",
  "resolution_latest",
];

export type TimelineMode = "count" | "share";
export interface ZoomRange {
  lo: number;
  hi: number;
}

export interface TimelineProps {
  /** One panel per facet: a single "all" panel, or one per target / ASN. */
  facets: FacetSeries[];
  /** Stack order, bottom to top: ok first, then failure kinds by volume. */
  outcomes: string[];
  colors: Record<string, string>;
  mode: TimelineMode;
  /** The four bounds as datetime-local values, i.e. what the pickers hold. */
  bounds: Record<BoundKey, string>;
  armed: BoundKey | null;
  onSetBound: (key: BoundKey, value: string) => void;
  onArm: (key: BoundKey | null) => void;
  zoom: ZoomRange | null;
  onZoom: (z: ZoomRange | null) => void;
}

const W = 1000;
const L = 40;
const R = 12;
const TOP = 8;
const AXIS = 18;
const GAP = 6;
const RAIL = 10; // volume rail under the share view
const DRAG_MIN = 8; // viewBox units below which a drag is really a click

const pad2 = (n: number) => String(n).padStart(2, "0");

// Buckets come back as UTC and the pickers hold naive strings meaning UTC, so
// format from the UTC parts. Formatting from the local ones would land every
// click in the wrong hour for anyone not on UTC.
const toInput = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
  `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;

const parseBound = (v: string): number => (v ? Date.parse(v + ":00Z") : NaN);
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

const panelHeight = (n: number): number => (n === 1 ? 150 : n <= 3 ? 92 : 62);

/**
 * What the probes got, per bucket, stacked by outcome — `none` at the bottom
 * in green, failure kinds above it coloured by layer. An onset is then a shape
 * on the screen: the green band collapsing and a failure band taking its
 * place. That is a statement about the network, not about how the pipeline
 * currently scores it.
 *
 * One panel per facet. A summed chart hides the thing that decides scope: two
 * ASNs behaving differently, or one target moving a day before the others, is
 * invisible in the sum and obvious in the split — and `asn_scope` is a field
 * the analyst has to fill in.
 *
 * `share` normalises each bucket to 100% so an onset stays visible when
 * measurement volume swings; the rail underneath keeps volume on screen,
 * because a volume collapse (a shutdown quieting the probes) reads as a clean
 * green bar in share view and is exactly the case worth not missing.
 *
 * Interaction: arm a bound and click to set it, drag to zoom into a range.
 */
export default function Timeline({
  facets,
  outcomes,
  colors,
  mode,
  bounds,
  armed,
  onSetBound,
  onArm,
  zoom,
  onZoom,
}: TimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const panelH = panelHeight(Math.max(facets.length, 1));
  const H = TOP + Math.max(facets.length, 1) * (panelH + GAP) + AXIS;
  const iw = W - L - R;
  const plotTop = TOP;
  const plotBottom = TOP + Math.max(facets.length, 1) * (panelH + GAP) - GAP;

  // Zoom is a display-domain restriction over data already fetched: the point
  // is to make a bucket wide enough to hit, not to re-query at a finer grain.
  const visible: OutcomeBucket[][] = facets.map((f) =>
    zoom ? f.buckets.filter((b) => b.t.getTime() >= zoom.lo && b.t.getTime() <= zoom.hi) : f.buckets
  );
  const allVisible = visible.flat();
  const has = allVisible.length > 0;

  const dataLo = has ? Math.min(...allVisible.map((b) => b.t.getTime())) : 0;
  const dataHi = has ? Math.max(...allVisible.map((b) => b.t.getTime())) : 1;
  const t0 = zoom ? zoom.lo : dataLo;
  const t1 = zoom ? zoom.hi : dataHi;
  const span = Math.max(t1 - t0, 1);
  const X = (ms: number) => L + ((ms - t0) / span) * iw;
  const timeAt = (x: number) => t0 + ((x - L) / iw) * span;

  const bucketWidth = (bs: OutcomeBucket[]) => {
    if (bs.length < 2) return Math.max(iw / 24, 4);
    const step = Math.min(...bs.slice(1).map((b, i) => b.t.getTime() - bs[i].t.getTime()));
    return Math.max((step / span) * iw - 0.5, 0.7);
  };

  const svgPoint = (evt: React.MouseEvent) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: ((evt.clientX - box.left) / box.width) * W,
      y: ((evt.clientY - box.top) / box.height) * H,
    };
  };

  const facetAt = (y: number): number => {
    const i = Math.floor((y - TOP) / (panelH + GAP));
    return Math.max(0, Math.min(facets.length - 1, i));
  };

  // Snap to the nearest bucket, so a click cannot land between hours.
  const nearest = (bs: OutcomeBucket[], ms: number): OutcomeBucket | null =>
    bs.length
      ? bs.reduce((best, d) => (Math.abs(d.t.getTime() - ms) < Math.abs(best.t.getTime() - ms) ? d : best), bs[0])
      : null;

  const onMouseDown = (evt: React.MouseEvent) => {
    const p = svgPoint(evt);
    if (!p || !has) return;
    setDrag({ from: p.x, to: p.x });
  };

  const onMouseMove = (evt: React.MouseEvent) => {
    const p = svgPoint(evt);
    const box = wrapRef.current?.getBoundingClientRect();
    if (!p || !box || !has) return;
    if (drag) {
      setDrag({ ...drag, to: p.x });
      setTip(null);
      return;
    }
    const fi = facetAt(p.y);
    const d = nearest(visible[fi] || [], timeAt(p.x));
    if (!d) return setTip(null);
    const breakdown = outcomes
      .filter((o) => d.counts[o])
      .map((o) => `${outcomeLabel(o).padEnd(26)}${d.counts[o]}`);
    setTip({
      x: evt.clientX - box.left + 12,
      y: Math.max(evt.clientY - box.top - 10, 4),
      lines: [
        `${d.t.toISOString().slice(0, 16).replace("T", " ")}Z   n=${d.total}`,
        ...(facets.length > 1 ? [facets[fi].label] : []),
        ...breakdown,
      ],
    });
  };

  const onMouseUp = (evt: React.MouseEvent) => {
    const p = svgPoint(evt);
    const d = drag;
    setDrag(null);
    if (!p || !d || !has) return;

    if (Math.abs(p.x - d.from) >= DRAG_MIN) {
      const lo = timeAt(Math.min(d.from, p.x));
      const hi = timeAt(Math.max(d.from, p.x));
      if (hi - lo > 0) onZoom({ lo, hi });
      return;
    }
    // A click, not a drag: set the armed bound from the bucket under it.
    if (!armed) return;
    const bucket = nearest(visible[facetAt(p.y)] || allVisible, timeAt(p.x));
    if (!bucket) return;
    onSetBound(armed, toInput(bucket.t));
    onArm(BOUND_ORDER[(BOUND_ORDER.indexOf(armed) + 1) % BOUND_ORDER.length]);
  };

  // Brackets render in two layers: a wash behind the data, and edges plus a
  // header band on top of it. In share view the bars fill the panel, so a wash
  // alone would be painted over and the bracket you are placing would be
  // invisible exactly while you are placing it.
  const bracketGeom = (a: string, b: string) => {
    const av = parseBound(a);
    const bv = parseBound(b);
    if (isNaN(av) && isNaN(bv)) return null;
    const x1 = X(isNaN(av) ? t0 : av);
    const x2 = X(isNaN(bv) ? (isNaN(av) ? t0 : av) : bv);
    return { av, bv, lo: Math.min(x1, x2), w: Math.max(Math.abs(x2 - x1), 2) };
  };

  const bracketWash = (a: string, b: string, colour: string, key: string) => {
    const g = bracketGeom(a, b);
    if (!g) return null;
    return (
      <rect
        key={key}
        x={g.lo}
        y={plotTop}
        width={g.w}
        height={plotBottom - plotTop}
        fill={colour}
        opacity={0.22}
      />
    );
  };

  // A half-open bracket (one arm set) still draws its edge, which is how a
  // lone onset_latest stays visible.
  const bracketEdges = (a: string, b: string, colour: string, key: string) => {
    const g = bracketGeom(a, b);
    if (!g) return null;
    return (
      <g key={key}>
        <rect x={g.lo} y={plotTop} width={g.w} height={3} fill={colour} opacity={0.95} />
        {[g.av, g.bv].map((v, i) =>
          isNaN(v) ? null : (
            <line
              key={i}
              x1={X(v)}
              x2={X(v)}
              y1={plotTop}
              y2={plotBottom}
              stroke={colour}
              strokeWidth={1.5}
              opacity={0.9}
            />
          )
        )}
      </g>
    );
  };

  return (
    <div id="chartWrap" ref={wrapRef}>
      <svg
        id="chart"
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          setTip(null);
          setDrag(null);
        }}
      >
        {has && (
          <>
            {bracketWash(bounds.onset_earliest, bounds.onset_latest, "#ffb84d", "onset-wash")}
            {bracketWash(bounds.resolution_earliest, bounds.resolution_latest, "#9d84f7", "res-wash")}

            {facets.map((f, fi) => {
              const bs = visible[fi];
              const top = TOP + fi * (panelH + GAP);
              const railH = mode === "share" ? RAIL : 0;
              const ih = panelH - railH;
              const base = top + ih;
              const maxN = Math.max(...bs.map((b) => b.total), 1);
              const bw = bucketWidth(bs);
              return (
                <g key={f.key}>
                  {bs.map((d, bi) => {
                    const scale = mode === "share" ? (d.total ? ih / d.total : 0) : ih / maxN;
                    let y = base;
                    const segs: React.ReactNode[] = [];
                    for (const o of outcomes) {
                      const n = d.counts[o];
                      if (!n) continue;
                      const h = n * scale;
                      y -= h;
                      segs.push(
                        <rect
                          key={o}
                          x={X(d.t.getTime()) - bw / 2}
                          y={y}
                          width={bw}
                          height={h}
                          fill={colors[o] || "#8b99a9"}
                        />
                      );
                    }
                    return <g key={bi}>{segs}</g>;
                  })}
                  {mode === "share" &&
                    bs.map((d, bi) => (
                      <rect
                        key={"v" + bi}
                        x={X(d.t.getTime()) - bw / 2}
                        y={base + 3 + (RAIL - 5) * (1 - d.total / maxN)}
                        width={bw}
                        height={Math.max((RAIL - 5) * (d.total / maxN), 0.6)}
                        fill="#6ec7de"
                        opacity={0.55}
                      />
                    ))}
                  <line x1={L} x2={W - R} y1={base} y2={base} stroke="#323d4d" />
                  <text x={4} y={top + 8} className="axis">
                    {mode === "share" ? "100%" : maxN}
                  </text>
                  {facets.length > 1 && (
                    <text x={L + 4} y={top + 9} className="axis facet-label">
                      {f.label} · n={f.total.toLocaleString()}
                    </text>
                  )}
                </g>
              );
            })}

            {bracketEdges(bounds.onset_earliest, bounds.onset_latest, "#ffb84d", "onset-edge")}
            {bracketEdges(bounds.resolution_earliest, bounds.resolution_latest, "#9d84f7", "res-edge")}

            {drag && Math.abs(drag.to - drag.from) >= DRAG_MIN && (
              <rect
                x={Math.min(drag.from, drag.to)}
                y={plotTop}
                width={Math.abs(drag.to - drag.from)}
                height={plotBottom - plotTop}
                fill="#f0f4fa"
                opacity={0.16}
              />
            )}

            <text x={L} y={H - 5} className="axis">
              {stamp(dataLo)}
            </text>
            <text x={W - R} y={H - 5} className="axis" textAnchor="end">
              {stamp(dataHi)}
            </text>
          </>
        )}
      </svg>
      {tip && (
        <div id="tip" style={{ left: tip.x, top: tip.y }}>
          {tip.lines.join("\n")}
        </div>
      )}
    </div>
  );
}
