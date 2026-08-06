import { defaultState, type EventLabelerState } from "./types";

const KEY = "ooni.event-labeler.v1";

// Guarded for SSR (Next.js renders this module on the server too): reading
// and writing are both no-ops without a `window`. Same contract as the
// measurement labeler — nothing is written back to OONI, labels leave by
// copy-paste, so this is the only persistence there is.
export function readState(): EventLabelerState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

export function writeState(s: EventLabelerState): void {
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
