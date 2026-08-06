import type {
  Candidate,
  ContextResponse,
  RevealResponse,
  SampleResponse,
  TestNameInfo,
} from "./types";

const url = (apiBase: string, path: string): string =>
  apiBase.replace(/\/$/, "") + "/api/v1/labeling" + path;

export interface DrawParams {
  strata: string[];
  testNames: string[];
  replicate: number;
  limit: number;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  probeCC?: string;
  domain?: string;
}

export async function fetchTestNames(
  apiBase: string,
  params: { since: string; until: string; probeCC?: string }
): Promise<TestNameInfo[]> {
  const q = new URLSearchParams({
    since: params.since + "T00:00:00",
    until: params.until + "T00:00:00",
  });
  if (params.probeCC) q.set("probe_cc", params.probeCC.toUpperCase());
  const r = await fetch(url(apiBase, "/test_names?" + q));
  const data = await r.json();
  return data.test_names || [];
}

export async function drawSample(
  apiBase: string,
  p: DrawParams
): Promise<SampleResponse> {
  const q = new URLSearchParams({
    strata: p.strata.join(","),
    test_name: p.testNames.join(","),
    replicate: String(p.replicate || 1),
    limit: String(p.limit),
    since: p.since + "T00:00:00",
    until: p.until + "T00:00:00",
  });
  if (p.probeCC) q.set("probe_cc", p.probeCC.toUpperCase());
  if (p.domain) q.set("domain", p.domain);
  const r = await fetch(url(apiBase, "/sample?" + q));
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail || r.statusText);
  }
  return r.json();
}

export async function fetchCandidate(
  apiBase: string,
  measurementUid: string
): Promise<Candidate> {
  const r = await fetch(
    url(apiBase, "/candidate/" + encodeURIComponent(measurementUid))
  );
  const data = await r.json();
  if (data.detail) throw new Error(data.detail);
  return data;
}

export async function fetchContext(
  apiBase: string,
  params: {
    hostname: string;
    probeCC: string | number;
    probeASN: string | number;
    at: string;
    hours?: number;
  }
): Promise<ContextResponse> {
  const q = new URLSearchParams({
    hostname: params.hostname,
    probe_cc: String(params.probeCC),
    probe_asn: String(params.probeASN),
    at: params.at,
    hours: String(params.hours ?? 6),
  });
  const r = await fetch(url(apiBase, "/context?" + q));
  return r.json();
}

export async function fetchReveal(
  apiBase: string,
  measurementUid: string
): Promise<RevealResponse> {
  const r = await fetch(
    url(apiBase, "/reveal/" + encodeURIComponent(measurementUid))
  );
  return r.json();
}
