import { fetchChangepoints } from "../event-dashboard/api";
import type { ChangepointResponse } from "../event-dashboard/types";
import type {
  ChangepointLabel,
  ChangepointQuery,
  NewChangepointLabel,
  StoredChangepoint,
} from "./types";

/**
 * Everything the labeler reads and writes. The real implementation (stored
 * changepoints and changepoint_label in ClickHouse, behind an API that is
 * still being built) only has to provide these three calls.
 */
export interface LabelApi {
  // true while labels live in this browser rather than in the database
  readonly mock: boolean;
  listChangepoints(q: ChangepointQuery, signal?: AbortSignal): Promise<StoredChangepoint[]>;
  // every label of the given changepoints, history included
  listLabels(changepointIds: string[], signal?: AbortSignal): Promise<ChangepointLabel[]>;
  createLabel(label: NewChangepointLabel): Promise<ChangepointLabel>;
}

// /changepoints is slow (seconds to tens of seconds) and both the mock queue
// and the evidence view need it for the same query, so runs are shared
const runs = new Map<string, Promise<ChangepointResponse>>();
export function detectCached(
  changepointApi: string,
  q: ChangepointQuery
): Promise<ChangepointResponse> {
  const key = JSON.stringify([changepointApi, q]);
  let run = runs.get(key);
  if (!run) {
    run = fetchChangepoints(changepointApi, {
      probe_cc: q.probe_cc,
      domain: q.domain,
      start_date: q.since,
      end_date: q.until,
    });
    run.catch(() => runs.delete(key));
    runs.set(key, run);
  }
  return run;
}

// ------------------------------------------------------------------ mock

const STORAGE_KEY = "cp-labeler:labels:v1";

// A stable UUID for a changepoint, so labels made against the mock survive
// reloads: SHA-1 of the fields that identify it, laid out as a UUID
async function stableUuid(parts: (string | number)[]): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-1", new TextEncoder().encode(parts.join("|")))
  );
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // version 5 and the RFC 4122 variant bits, as a name-based UUID would have
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function readLabels(): ChangepointLabel[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeLabels(labels: ChangepointLabel[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
}

export function exportMockLabels(): ChangepointLabel[] {
  return readLabels();
}

/**
 * Stand-in until the label API exists. Changepoints come from the changepoint
 * API's on-the-fly /changepoints, reshaped into event_detector_v2_changepoints
 * rows; labels are kept in localStorage.
 */
export function createMockLabelApi(changepointApi: string): LabelApi {
  return {
    mock: true,

    async listChangepoints(q) {
      const resp = await detectCached(changepointApi, q);
      const runParameters = JSON.stringify(resp.query);
      return Promise.all(
        resp.changepoints.map(async (cp) => ({
          uuid: await stableUuid([
            cp.domain,
            cp.probe_cc,
            cp.probe_asn,
            cp.resolver_asn,
            cp.layer,
            cp.ts_hour,
            cp.state,
          ]),
          domain: cp.domain,
          probe_cc: cp.probe_cc,
          probe_asn: cp.probe_asn,
          resolver_asn: cp.resolver_asn,
          layer: cp.layer,
          ts_hour: cp.ts_hour,
          s_neg: cp.s_neg,
          s_pos: cp.s_pos,
          h: cp.h,
          state: cp.state,
          run_parameters: runParameters,
          created_at: cp.ts_hour,
        }))
      );
    },

    async listLabels(changepointIds) {
      const ids = new Set(changepointIds);
      return readLabels().filter((l) => ids.has(l.changepoint_id));
    },

    async createLabel(label) {
      const row: ChangepointLabel = {
        ...label,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };
      writeLabels([...readLabels(), row]);
      return row;
    },
  };
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
