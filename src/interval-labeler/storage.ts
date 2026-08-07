import { defaultState, type IntervalLabelerState } from "./types";

const KEY = "ooni.interval-labeler.v1";

// Guarded for SSR (Next.js renders this module on the server too): reading and
// writing are both no-ops without a `window`. Same contract as the other two
// labellers — nothing is written back to OONI, labels leave by copy-paste, so
// this is the only persistence there is.
export function readState(): IntervalLabelerState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

export function writeState(s: IntervalLabelerState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
