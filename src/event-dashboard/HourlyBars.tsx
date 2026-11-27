import { useState } from "react";
import { HOUR_MS, isoHour } from "./inspect";
import type { HourValues, SeriesDef } from "./inspect";

// Shared geometry: every hourly chart in the inspector uses the same width
// and paddings so their bars line up hour for hour
export const W = 1000;
export const PAD = { top: 10, right: 8, bottom: 22, left: 46 };

// A vertical mark across the chart, e.g. a changepoint
export interface ChartMark {
  ms: number;
  label: string;
  // block / ok: a detected changepoint; label: a time set by a labeller
  tone: "block" | "ok" | "label";
}

// A stretch of detector state, painted faintly behind the bars
export interface ChartState {
  startMs: number;
  endMs: number;
  state: "BLOCK" | "OK" | "UNK";
}

const STATE_LABEL = { BLOCK: "blocked", OK: "ok", UNK: "no verdict" } as const;

interface Props {
  label: string;
  hours: number[]; // hour starts, ascending, contiguous
  series: SeriesDef[]; // stacking order, bottom first
  values: HourValues;
  selected: number | null;
  onSelect: (hourMs: number) => void;
  height?: number;
  marks?: ChartMark[];
  states?: ChartState[];
  // drawn in the top-left corner of the plot, e.g. the layer
  title?: string;
  // extra lines for the hover tooltip of one hour
  tooltipExtra?: (hourMs: number) => React.ReactNode;
}

const fmt = new Intl.NumberFormat("en-US");

const niceCeil = (v: number): number => {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
};

export default function HourlyBars({
  label,
  hours,
  series,
  values,
  selected,
  onSelect,
  height = 170,
  marks = [],
  states = [],
  title,
  tooltipExtra,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, hours.length);
  const barW = Math.max(1, slot - (slot > 4 ? 1 : 0));
  const startMs = hours[0] ?? 0;
  const xOf = (ms: number) => PAD.left + ((ms - startMs) / HOUR_MS) * slot;

  const totals = hours.map((h) => {
    const v = values.get(h);
    return v ? series.reduce((acc, s) => acc + (v[s.key] ?? 0), 0) : 0;
  });
  const yMax = niceCeil(Math.max(0, ...totals));
  const yOf = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  // a label per day, thinned out when the range is long
  const days = hours.filter((h) => h % (24 * HOUR_MS) === 0);
  const dayEvery = Math.max(1, Math.ceil(days.length / 12));

  const step = (dir: number) => {
    const i = selected === null ? -1 : hours.indexOf(selected);
    const next = hours[Math.min(hours.length - 1, Math.max(0, i + dir))];
    if (next !== undefined) onSelect(next);
  };

  const endMs = startMs + hours.length * HOUR_MS;
  const stateAt = (ms: number) => states.find((s) => s.startMs <= ms && ms < s.endMs)?.state;
  const tipHour = hover ?? null;
  const tipValues = tipHour !== null ? values.get(tipHour) : undefined;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="block w-full chart-surface hb-chart"
        role="group"
        aria-label={`${label}, hourly. Arrow keys move the selected hour.`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            step(-1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            step(1);
          }
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* detector state behind everything else */}
        {states.map((st) => {
          const a = Math.max(st.startMs, startMs);
          const b = Math.min(st.endMs, endMs);
          if (b <= a || st.state === "UNK") return null;
          return (
            <rect
              key={st.startMs}
              x={xOf(a)}
              y={PAD.top}
              width={xOf(b) - xOf(a)}
              height={plotH}
              className={`hb-state hb-state-${st.state}`}
            />
          );
        })}
        {/* counts: no half-measurement ticks on small scales */}
        {(yMax <= 2 ? [0, yMax] : [0, yMax / 2, yMax]).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yOf(t)} y2={yOf(t)} className="chart-grid" />
            <text x={PAD.left - 6} y={yOf(t) + 3} className="chart-tick" textAnchor="end">
              {fmt.format(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => (
          <g key={d}>
            <line x1={xOf(d)} x2={xOf(d)} y1={PAD.top} y2={PAD.top + plotH} className="hb-day" />
            {i % dayEvery === 0 && (
              <text x={xOf(d) + 2} y={height - 7} className="chart-tick">
                {isoHour(d).slice(5, 10)}
              </text>
            )}
          </g>
        ))}

        {selected !== null && selected >= startMs && (
          <rect
            x={xOf(selected) - 1}
            y={PAD.top - 4}
            width={Math.max(barW + 2, 3)}
            height={plotH + 4}
            className="hb-selected"
          />
        )}

        {hours.map((h, i) => {
          const v = values.get(h);
          let y = PAD.top + plotH;
          const x = PAD.left + i * slot;
          return (
            <g key={h}>
              {v &&
                series.map((s) => {
                  const n = v[s.key] ?? 0;
                  if (n <= 0) return null;
                  const hgt = (n / yMax) * plotH;
                  y -= hgt;
                  return <rect key={s.key} x={x} y={y} width={barW} height={hgt} fill={s.color} />;
                })}
              {/* hit target: the whole column, so thin bars stay clickable */}
              <rect
                x={x}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                className="cursor-pointer"
                onPointerMove={() => setHover(h)}
                onClick={() => onSelect(h)}
              />
            </g>
          );
        })}

        {marks.filter((m) => m.ms >= startMs && m.ms < endMs).map((m) => (
          <g key={`${m.ms}${m.label}`} pointerEvents="none">
            <line
              x1={xOf(m.ms)}
              x2={xOf(m.ms)}
              y1={PAD.top - 6}
              y2={PAD.top + plotH}
              className={`hb-mark hb-mark-${m.tone}`}
            />
            <text x={xOf(m.ms) + 3} y={PAD.top + 2} className={`hb-mark-text hb-mark-text-${m.tone}`}>
              {m.label}
            </text>
          </g>
        ))}

        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} className="hb-base" />
        {title && (
          <text x={PAD.left + 4} y={PAD.top + 11} className="hb-title">
            {title}
          </text>
        )}
        {totals.every((t) => t === 0) && (
          <text x={W / 2} y={PAD.top + plotH / 2} className="chart-tick" textAnchor="middle">
            nothing in this range
          </text>
        )}
      </svg>

      {tipHour !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: `${Math.min(76, Math.max(2, (xOf(tipHour) / W) * 100))}%`,
            top: "100%",
          }}
        >
          <div className="font-semibold tabular-nums mb-0.5">{isoHour(tipHour)} UTC</div>
          {series.map((s) =>
            tipValues?.[s.key] ? (
              <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
                <span className="chart-swatch" style={{ background: s.color }} />
                <strong>{fmt.format(tipValues[s.key])}</strong> {s.label}
              </div>
            ) : null
          )}
          {!tipValues && <div className="text-muted">no data</div>}
          {stateAt(tipHour) && (
            <div className={`mt-0.5 hb-tip-state-${stateAt(tipHour)}`}>
              detector: {STATE_LABEL[stateAt(tipHour) as ChartState["state"]]}
            </div>
          )}
          {tooltipExtra?.(tipHour)}
          <div className="text-muted mt-0.5">click to select</div>
        </div>
      )}
    </div>
  );
}

export function SeriesLegend({ series }: { series: SeriesDef[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="chart-swatch" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
