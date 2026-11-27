import { fetchChangepoints } from "../event-dashboard/api";
import type { ChangepointResponse } from "../event-dashboard/types";
import type {
  ChangepointLabel,
  ChangepointQuery,
  NewChangepointLabel,
  StoredChangepoint,
} from "./types";

const join = (base: string, path: string): string => base.replace(/\/$/, "") + path;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const detail = Array.isArray(body?.detail)
      ? body.detail.map((d: { msg: string }) => d.msg).join("; ")
      : body?.detail;
    throw new Error(detail || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

/**
 * Every changepoint the hourly detector job stored with ts_hour inside the
 * range, newest first, from the changepoint API's /stored_changepoints
 */
export async function listStoredChangepoints(
  changepointApi: string,
  q: ChangepointQuery,
  signal?: AbortSignal
): Promise<StoredChangepoint[]> {
  const limit = 1000;
  const out: StoredChangepoint[] = [];
  for (let offset = 0; ; offset += limit) {
    const params = new URLSearchParams({
      start_date: q.since,
      end_date: q.until,
      limit: String(limit),
      offset: String(offset),
    });
    const page = await request<{ changepoints: StoredChangepoint[] }>(
      join(changepointApi, "/stored_changepoints?" + params),
      { signal }
    );
    out.push(...page.changepoints);
    if (page.changepoints.length < limit) return out;
  }
}

// ------------------------------------------------------------------ labels

// The API stores labels (POST /changepoint_labels) but cannot list them yet,
// so the labels made from this browser are kept here too, to show what is
// already done in the queue and in a changepoint's history
const STORAGE_KEY = "cp-labeler:posted-labels:v1";

function readPosted(): ChangepointLabel[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function postedLabels(changepointIds: string[]): ChangepointLabel[] {
  const ids = new Set(changepointIds);
  return readPosted().filter((l) => ids.has(l.changepoint_id));
}

export async function createLabel(
  changepointApi: string,
  label: NewChangepointLabel
): Promise<ChangepointLabel> {
  const row = await request<ChangepointLabel>(join(changepointApi, "/changepoint_labels"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(label),
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...readPosted(), row]));
  } catch {
    /* stored server side regardless; only the local record is lost */
  }
  return row;
}

// The newest label of each changepoint
export function currentLabels(labels: ChangepointLabel[]): Map<string, ChangepointLabel> {
  const out = new Map<string, ChangepointLabel>();
  for (const l of labels) {
    const prev = out.get(l.changepoint_id);
    if (!prev || l.created_at > prev.created_at) out.set(l.changepoint_id, l);
  }
  return out;
}

// ------------------------------------------------------------------ evidence

export interface DetectionScope {
  probe_cc: string;
  domain: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD, inclusive
}

// /changepoints over a country and domain recomputes the detector's view of
// every network there: it is slow (seconds to tens of seconds) and shared by
// all the changepoints of that country and domain, so each run is kept
const runs = new Map<string, Promise<ChangepointResponse>>();
export function detectCached(changepointApi: string, s: DetectionScope): Promise<ChangepointResponse> {
  const key = JSON.stringify([changepointApi, s]);
  let run = runs.get(key);
  if (!run) {
    run = fetchChangepoints(changepointApi, {
      probe_cc: s.probe_cc,
      domain: s.domain,
      start_date: s.since,
      end_date: s.until,
    });
    run.catch(() => runs.delete(key));
    runs.set(key, run);
  }
  return run;
}
