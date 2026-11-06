import { useMemo, useState } from "react";
import { nowState } from "./derive";
import type { AsnSummary, NowState } from "./derive";
import { LAYERS } from "./types";

const fmt = new Intl.NumberFormat("en-US");

type SortKey = "status" | "measurements" | "events" | "asn";

const STATE_RANK: Record<NowState, number> = { BLOCK: 0, OK: 1, UNK: 2 };

interface Props {
  asns: AsnSummary[];
  names: Map<number, string>;
  endDate: string;
  selected: number[];
  maxSelected: number;
  onToggle: (asn: number) => void;
  onClear: () => void;
}

export default function AsnGrid({
  asns,
  names,
  endDate,
  selected,
  maxSelected,
  onToggle,
  onClear,
}: Props) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("status");
  const [onlyBlocked, setOnlyBlocked] = useState(false);

  const counts = useMemo(() => {
    const c: Record<NowState, number> = { BLOCK: 0, OK: 0, UNK: 0 };
    for (const a of asns) c[nowState(a)]++;
    return c;
  }, [asns]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/^as/, "");
    const rows = asns.filter((a) => {
      if (onlyBlocked && nowState(a) !== "BLOCK") return false;
      if (!q) return true;
      return (
        String(a.asn).startsWith(q) ||
        (names.get(a.asn) ?? "").toLowerCase().includes(q)
      );
    });
    const byCount = (x: AsnSummary, y: AsnSummary) => y.nMeasurements - x.nMeasurements;
    const cmp: Record<SortKey, (x: AsnSummary, y: AsnSummary) => number> = {
      status: (x, y) =>
        STATE_RANK[nowState(x)] - STATE_RANK[nowState(y)] || byCount(x, y),
      measurements: byCount,
      events: (x, y) => y.events.length - x.events.length || byCount(x, y),
      asn: (x, y) => x.asn - y.asn,
    };
    return rows.sort(cmp[sort]);
  }, [asns, names, filter, sort, onlyBlocked]);

  const full = selected.length >= maxSelected;

  return (
    <section className="card mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="card-title mb-1">Networks · state on {endDate}</h2>
          <div className="flex flex-wrap gap-x-5 gap-y-1 items-baseline tabular-nums">
            <span className="stat stat-block">
              <strong>{fmt.format(counts.BLOCK)}</strong> blocked now
            </span>
            <span className="stat stat-ok">
              <strong>{fmt.format(counts.OK)}</strong> ok
            </span>
            <span className="stat stat-unk">
              <strong>{fmt.format(counts.UNK)}</strong> no verdict
            </span>
          </div>
        </div>
        <div className="text-xs tabular-nums flex items-center gap-2">
          <span className={`sel-count ${full ? "sel-count-full" : ""}`}>
            {selected.length} / {maxSelected} selected
          </span>
          {selected.length > 0 && (
            <button type="button" className="link" onClick={onClear}>
              clear
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <input
          className="ed-input text-sm w-60"
          placeholder="Filter by network name or AS"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <label className="flex items-center gap-1.5 text-secondary">
          Sort
          <select
            className="ed-input text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="status">blocked first</option>
            <option value="measurements">most measurements</option>
            <option value="events">most detected changes</option>
            <option value="asn">AS number</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-secondary">
          <input
            type="checkbox"
            checked={onlyBlocked}
            onChange={(e) => setOnlyBlocked(e.target.checked)}
          />
          only blocked now
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted">No network matches the filter.</p>
      ) : (
        // Scrolls in place so the timeline below stays within reach
        <div className="mosaic">
          {visible.map((a) => {
            const isSel = selected.includes(a.asn);
            const state = nowState(a);
            const blockedLayers = LAYERS.filter((l) => a.blockedAtEnd.has(l));
            const blockedTracks = a.tracks.filter((t) =>
              LAYERS.some((l) => t.finalState[l] === "BLOCK")
            ).length;
            const name = names.get(a.asn);
            const locked = !isSel && full;
            return (
              <button
                key={a.asn}
                type="button"
                className={`tile tile-${state} ${isSel ? "tile-selected" : ""}`}
                aria-pressed={isSel}
                aria-disabled={locked}
                onClick={() => !locked && onToggle(a.asn)}
                title={
                  locked
                    ? `At most ${maxSelected} networks can be compared`
                    : state === "BLOCK"
                      ? `Blocked on ${blockedTracks} of ${a.tracks.length} resolvers on ${endDate}`
                      : undefined
                }
              >
                <span className="tile-name">{name ?? `AS${a.asn}`}</span>
                <span className="tile-meta tabular-nums">
                  AS{a.asn} · {fmt.format(a.nMeasurements)} msmt
                  {a.events.length > 0 && ` · ${a.events.length} chg`}
                </span>
                <span className="tile-state">
                  {state === "BLOCK"
                    ? `Blocked · ${blockedLayers.map((l) => l.toUpperCase()).join(" ")} · ${blockedTracks}/${a.tracks.length}`
                    : state === "OK"
                      ? "OK"
                      : "No verdict"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
