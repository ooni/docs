import { useMemo, useState } from "react";
import type { AggregationEntry } from "./types";

// Failure families as classified by the aggregation endpoint (prefix before
// the first dot). Order is fixed — it is also the stacking order, and the
// palette is validated for exactly this adjacency.
export const FAILURE_FAMILIES = [
  { key: "dns_isp", label: "DNS (ISP resolver)", cssVar: "--series-dns-isp" },
  { key: "dns_other", label: "DNS (other resolver)", cssVar: "--series-dns-other" },
  { key: "tcp", label: "TCP connect", cssVar: "--series-tcp" },
  { key: "tls", label: "TLS handshake", cssVar: "--series-tls" },
  { key: "https", label: "HTTPS request", cssVar: "--series-https" },
  { key: "http", label: "HTTP request", cssVar: "--series-http" },
] as const;

export type FamilyKey = (typeof FAILURE_FAMILIES)[number]["key"];

// Observations without a failure, stacked under the failure families in a
// recessive neutral so the colored failures stay the loud part.
export const NONE_SERIES = {
  key: "none",
  label: "No failure",
  cssVar: "--series-none",
} as const;

export interface DayBucket {
  day: string; // YYYY-MM-DD
  total: number; // all observations, including non-failing ones
  none: number;
  byFamily: Record<FamilyKey, number>;
  // exact failure string -> count, for the tooltip breakdown
  details: Map<string, number>;
}

const familyOf = (failure: string): FamilyKey | null => {
  const fam = failure.split(".", 1)[0];
  return FAILURE_FAMILIES.some((f) => f.key === fam)
    ? (fam as FamilyKey)
    : null;
};

export function bucketByDay(
  entries: AggregationEntry[],
  since: string,
  until: string
): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  const dayMs = 24 * 3600 * 1000;
  const start = new Date(since.slice(0, 10) + "T00:00:00Z").getTime();
  const end = new Date(until.slice(0, 10) + "T00:00:00Z").getTime();
  for (let t = start; t <= end; t += dayMs) {
    const day = new Date(t).toISOString().slice(0, 10);
    buckets.set(day, {
      day,
      total: 0,
      none: 0,
      byFamily: {
        dns_isp: 0,
        dns_other: 0,
        tcp: 0,
        tls: 0,
        https: 0,
        http: 0,
      },
      details: new Map(),
    });
  }
  for (const e of entries) {
    if (!e.timestamp || !e.failure) continue;
    const b = buckets.get(e.timestamp.slice(0, 10));
    if (!b) continue;
    b.total += e.observation_count;
    if (e.failure === "none") {
      b.none += e.observation_count;
      continue;
    }
    const fam = familyOf(e.failure);
    if (!fam) continue;
    b.byFamily[fam] += e.observation_count;
    b.details.set(
      e.failure,
      (b.details.get(e.failure) ?? 0) + e.observation_count
    );
  }
  return [...buckets.values()];
}

// Tallest stack: no-failure observations plus every failure family
export const maxStack = (buckets: DayBucket[]): number =>
  Math.max(
    0,
    ...buckets.map((b) =>
      b.none + FAILURE_FAMILIES.reduce((s, f) => s + b.byFamily[f.key], 0)
    )
  );

// Round up to a clean 1/2/5 x 10^k tick ceiling
const niceCeil = (v: number): number => {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    if (m * mag >= v) return m * mag;
  }
  return 10 * mag;
};

const fmt = new Intl.NumberFormat("en-US");

interface TooltipState {
  bucket: DayBucket;
  xPct: number;
  yPct: number;
}

export interface FailureChartProps {
  title: string;
  buckets: DayBucket[];
  yMax: number; // shared across sibling charts so they compare directly
}

const W = 560;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 22, left: 44 };

export default function FailureChart({ title, buckets, yMax }: FailureChartProps) {
  const [tip, setTip] = useState<TooltipState | null>(null);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const yCeil = niceCeil(yMax);
  const ticks = [0, yCeil / 2, yCeil];

  const slot = plotW / Math.max(1, buckets.length);
  const barW = Math.min(24, Math.max(3, slot - 2));

  const bars = useMemo(
    () =>
      buckets.map((b, i) => {
        const x = PAD.left + i * slot + (slot - barW) / 2;
        let yCursor = PAD.top + plotH; // stack up from the baseline
        const segs: { fam: string; y: number; h: number; cssVar: string }[] = [];
        const series = [
          { key: NONE_SERIES.key, cssVar: NONE_SERIES.cssVar, value: b.none },
          ...FAILURE_FAMILIES.map((f) => ({
            key: f.key,
            cssVar: f.cssVar,
            value: b.byFamily[f.key],
          })),
        ];
        for (const s of series) {
          if (s.value <= 0) continue;
          const h = (s.value / yCeil) * plotH;
          yCursor -= h;
          segs.push({ fam: s.key, y: yCursor, h, cssVar: s.cssVar });
        }
        return { bucket: b, x, segs };
      }),
    [buckets, yCeil, slot, barW, plotH]
  );

  const hasAny = buckets.some((b) => b.total > 0);

  const showTip = (b: DayBucket, x: number) => {
    setTip({
      bucket: b,
      xPct: Math.min(85, Math.max(5, ((x + barW / 2) / W) * 100)),
      yPct: 8,
    });
  };

  const monthDay = (day: string) => day.slice(5);

  // Label roughly every ~5th day so tick labels never collide
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <div>
      <h4 className="text-sm font-medium mb-1 text-secondary">{title}</h4>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full chart-surface rounded"
          role="img"
          aria-label={title}
          onPointerLeave={() => setTip(null)}
        >
          {ticks.map((t) => {
            const y = PAD.top + plotH - (t / yCeil) * plotH;
            return (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y}
                  y2={y}
                  className={t === 0 ? "chart-baseline" : "chart-grid"}
                />
                <text x={PAD.left - 6} y={y + 3} className="chart-tick" textAnchor="end">
                  {fmt.format(t)}
                </text>
              </g>
            );
          })}
          {bars.map(({ bucket, x, segs }, i) => (
            <g
              key={bucket.day}
              onPointerMove={() => showTip(bucket, x)}
              onFocus={() => showTip(bucket, x)}
              onBlur={() => setTip(null)}
              tabIndex={bucket.total > 0 ? 0 : -1}
              style={{ outline: "none" }}
            >
              {/* hit target wider than the painted bar */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
              />
              {segs.map((s, j) => {
                const isTop = j === segs.length - 1;
                const gap = j > 0 ? 1 : 0; // 2px surface gap split between neighbors
                const h = Math.max(1, s.h - gap - (isTop ? 0 : 1));
                const r = Math.min(4, barW / 2, h);
                const y = s.y + gap;
                const lift = tip?.bucket.day === bucket.day;
                return isTop ? (
                  <path
                    key={s.fam}
                    d={`M ${x} ${y + h} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${
                      x + barW - r
                    } Q ${x + barW} ${y} ${x + barW} ${y + r} V ${y + h} Z`}
                    fill={`var(${s.cssVar})`}
                    opacity={lift ? 1 : 0.92}
                  />
                ) : (
                  <rect
                    key={s.fam}
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    fill={`var(${s.cssVar})`}
                    opacity={lift ? 1 : 0.92}
                  />
                );
              })}
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  className="chart-tick"
                  textAnchor="middle"
                >
                  {monthDay(bucket.day)}
                </text>
              )}
            </g>
          ))}
          {!hasAny && (
            <text x={W / 2} y={H / 2} className="chart-empty" textAnchor="middle">
              no observations in this window
            </text>
          )}
        </svg>
        {tip && tip.bucket.total > 0 && (
          <div
            className="chart-tooltip"
            style={{ left: `${tip.xPct}%`, top: `${tip.yPct}%` }}
          >
            <div className="font-medium mb-1">{tip.bucket.day}</div>
            {[...tip.bucket.details.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([failure, count]) => {
                const fam = familyOf(failure);
                const cssVar = FAILURE_FAMILIES.find((f) => f.key === fam)?.cssVar;
                return (
                  <div key={failure} className="flex items-center gap-1.5">
                    <span
                      className="chart-linekey"
                      style={cssVar ? { background: `var(${cssVar})` } : undefined}
                    />
                    <strong>{fmt.format(count)}</strong>
                    <span className="text-muted">{failure}</span>
                  </div>
                );
              })}
            <div className="text-muted mt-1">
              {fmt.format(tip.bucket.none)} without failure ·{" "}
              {fmt.format(tip.bucket.total)} total
            </div>
          </div>
        )}
      </div>
      <details className="mt-1">
        <summary className="text-xs text-muted cursor-pointer">
          View as table
        </summary>
        <div className="max-h-48 overflow-y-auto mt-1">
          <table className="data-table text-xs">
            <thead>
              <tr>
                <th>Day</th>
                <th>Failure</th>
                <th className="text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {buckets
                .filter((b) => b.total > 0)
                .flatMap((b) =>
                  [
                    ...(b.none > 0 ? [["none", b.none] as [string, number]] : []),
                    ...b.details.entries(),
                  ].map(([failure, count]) => (
                    <tr key={b.day + failure}>
                      <td className="tabular-nums">{b.day}</td>
                      <td>{failure}</td>
                      <td className="text-right tabular-nums">
                        {fmt.format(count)}
                      </td>
                    </tr>
                  ))
                )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
