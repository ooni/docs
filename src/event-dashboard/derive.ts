import { WINDOW_DAYS } from "./config";
import { LAYERS } from "./types";
import type {
  Changepoint,
  ChangepointResponse,
  DetectorState,
  Layer,
  Series,
} from "./types";

const DAY_MS = 24 * 3600 * 1000;

export const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

export const todayUTC = (): string => isoDay(Date.now());

// The detection window for a picked date: WINDOW_DAYS back from it, inclusive
// of the picked date itself. startMs/endMs bound the hours the detector can
// report (end_date runs through 23:00).
export interface Window {
  startDate: string;
  endDate: string;
  startMs: number;
  endMs: number;
}

export function windowFor(endDate: string): Window {
  const endDayMs = Date.parse(endDate + "T00:00:00Z");
  const startMs = endDayMs - WINDOW_DAYS * DAY_MS;
  return {
    startDate: isoDay(startMs),
    endDate,
    startMs,
    endMs: endDayMs + DAY_MS,
  };
}

// A (probe_asn, resolver_asn) pair: the unit the detector runs on
export interface ResolverTrack {
  resolverAsn: number;
  nMeasurements: number;
  finalState: Partial<Record<Layer, DetectorState>>;
  events: Changepoint[];
}

export interface AsnSummary {
  asn: number;
  nMeasurements: number;
  events: Changepoint[];
  tracks: ResolverTrack[]; // sorted by measurement count, busiest first
  // Layers where at least one resolver pair ends the range blocked
  blockedAtEnd: Set<Layer>;
  // Layers where at least one resolver pair settled on OK or BLOCK
  decidedLayers: Set<Layer>;
}

// Groups the per-resolver series by probe network, keeping only networks
// that had measurements inside the window (the series also lists pairs only
// seen during the warmup).
export function summarizeAsns(resp: ChangepointResponse): AsnSummary[] {
  const eventsByPair = new Map<string, Changepoint[]>();
  const pairKey = (asn: number, resolver: number) => `${asn}/${resolver}`;
  for (const cp of resp.changepoints) {
    const k = pairKey(cp.probe_asn, cp.resolver_asn);
    const list = eventsByPair.get(k) ?? [];
    list.push(cp);
    eventsByPair.set(k, list);
  }

  const byAsn = new Map<number, AsnSummary>();
  for (const s of resp.series) {
    const events = eventsByPair.get(pairKey(s.probe_asn, s.resolver_asn)) ?? [];
    if (s.n_measurements === 0 && events.length === 0) continue;
    let a = byAsn.get(s.probe_asn);
    if (!a) {
      a = {
        asn: s.probe_asn,
        nMeasurements: 0,
        events: [],
        tracks: [],
        blockedAtEnd: new Set(),
        decidedLayers: new Set(),
      };
      byAsn.set(s.probe_asn, a);
    }
    a.nMeasurements += s.n_measurements;
    a.events.push(...events);
    a.tracks.push(toTrack(s, events));
    for (const layer of LAYERS) {
      const st = s.final_state[layer];
      if (st === "BLOCK") a.blockedAtEnd.add(layer);
      if (st === "BLOCK" || st === "OK") a.decidedLayers.add(layer);
    }
  }

  const out = [...byAsn.values()].filter((a) => a.nMeasurements > 0);
  for (const a of out) {
    a.tracks.sort((x, y) => y.nMeasurements - x.nMeasurements);
    a.events.sort((x, y) => x.ts_hour.localeCompare(y.ts_hour));
  }
  return out;
}

const toTrack = (s: Series, events: Changepoint[]): ResolverTrack => ({
  resolverAsn: s.resolver_asn,
  nMeasurements: s.n_measurements,
  finalState: s.final_state,
  events,
});

// A stretch of time one layer spent in one detector state. For a lane that
// overlays several resolver pairs, `blocked` / `total` count how many of them
// were blocked over the stretch.
export interface StateSpan {
  startMs: number;
  endMs: number;
  state: DetectorState;
  blocked: number;
  total: number;
}

// Rebuilds the state timeline of one layer of one resolver pair from its
// changepoints and the state the detector ended in. Changepoints only
// alternate OK <-> BLOCK once the detector has left UNK, so the state before
// the first changepoint is the opposite of it; with no changepoint at all the
// final state held over the whole window.
function trackStates(
  track: ResolverTrack,
  layer: Layer,
  win: Window
): { startMs: number; endMs: number; state: DetectorState }[] {
  const events = track.events.filter((e) => e.layer === layer);
  if (events.length === 0) {
    const state = track.finalState[layer] ?? "UNK";
    return [{ startMs: win.startMs, endMs: win.endMs, state }];
  }
  const spans = [];
  let state: DetectorState = events[0].state === "BLOCK" ? "OK" : "BLOCK";
  let t0 = win.startMs;
  for (const e of events) {
    const t = Date.parse(e.ts_hour);
    if (t > t0) spans.push({ startMs: t0, endMs: t, state });
    state = e.state;
    t0 = t;
  }
  spans.push({ startMs: t0, endMs: win.endMs, state });
  return spans;
}

// State timeline of one layer across several resolver pairs: BLOCK when any
// of them is blocked, else OK when any has settled on OK, else UNK.
export function stateSpans(
  tracks: ResolverTrack[],
  layer: Layer,
  win: Window
): StateSpan[] {
  const per = tracks.map((t) => trackStates(t, layer, win));
  const cuts = [
    ...new Set([...per.flatMap((spans) => spans.map((s) => s.startMs)), win.endMs]),
  ].sort((a, b) => a - b);
  const out: StateSpan[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const states = per.map(
      (spans) => spans.find((s) => s.startMs <= a && a < s.endMs)?.state ?? "UNK"
    );
    const blocked = states.filter((s) => s === "BLOCK").length;
    const state: DetectorState = blocked
      ? "BLOCK"
      : states.includes("OK")
        ? "OK"
        : "UNK";
    const last = out[out.length - 1];
    if (last && last.state === state && last.blocked === blocked) {
      last.endMs = b;
    } else {
      out.push({ startMs: a, endMs: b, state, blocked, total: tracks.length });
    }
  }
  return out;
}

// Verdict for the last picked day, the headline of each network
export type NowState = "BLOCK" | "OK" | "UNK";
export const nowState = (a: AsnSummary): NowState =>
  a.blockedAtEnd.size > 0 ? "BLOCK" : a.decidedLayers.size > 0 ? "OK" : "UNK";

export const eventKey = (e: Changepoint): string =>
  `${e.probe_asn}/${e.resolver_asn}/${e.layer}/${e.ts_hour}`;

export const formatHour = (iso: string): string =>
  new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function explorerChartUrl(
  domain: string,
  probeCc: string,
  probeAsn: number,
  since: string,
  until: string
): string {
  const q = new URLSearchParams({
    domain,
    probe_cc: probeCc,
    probe_asn: `AS${probeAsn}`,
    since,
    until,
    axis_x: "measurement_start_day",
  });
  return `https://explorer.ooni.org/chart/mat?${q}`;
}
