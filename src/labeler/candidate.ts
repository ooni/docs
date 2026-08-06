// Pure data transforms behind the candidate diff view. These used to build
// DOM nodes directly; here they return plain data so a React (or any other)
// view layer can render it declaratively. No framework imports.
import type { ContextResponse, ContextSeriesPoint, WideRow } from "./types";

export const NOT_RECORDED = "__not_recorded__" as const;
export type CtrlCell = string | null | undefined | typeof NOT_RECORDED;

export function groupBy<T>(rows: T[], keyFn: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  });
  return m;
}

// ---------------------------------------------------------------- endpoints
export const endpointKey = (r: WideRow): string => `${r.ip || ""}|${r.port ?? ""}`;

// Fields whose combination distinguishes genuinely different outcomes at the
// same address, so exact-duplicate rows collapse while different outcomes for
// the same address stay separate.
const OUTCOME_FIELDS = [
  "tcp_failure",
  "tcp_success",
  "tls_failure",
  "tls_is_certificate_valid",
  "tls_end_entity_certificate_fingerprint",
  "http_failure",
  "http_response_status_code",
  "http_response_body_sha1",
];

export interface DedupedRow extends WideRow {
  _n: number;
}

export function endpoints(rows: WideRow[]): DedupedRow[] {
  const m = new Map<string, DedupedRow>();
  rows.forEach((r) => {
    if (!r.ip) return;
    const k = endpointKey(r) + "|" + OUTCOME_FIELDS.map((f) => String((r as any)[f] ?? "")).join("|");
    const prev = m.get(k);
    if (prev) {
      prev._n++;
      return;
    }
    m.set(k, { ...r, _n: 1 });
  });
  return [...m.values()];
}

// Strict match: same address, and same port when both sides record one. A
// fallback to hostname or "the only control row" would silently reuse one
// control row across every probe observation when the probe resolved
// addresses the control never saw — see the note in renderCandidate history.
export function matchEndpoint(o: WideRow, ctrlEndpoints: WideRow[]): WideRow | null {
  return (
    ctrlEndpoints.find(
      (c) => c.ip === o.ip && (c.port == null || o.port == null || c.port === o.port)
    ) || null
  );
}

// ---------------------------------------------------------------- layers
export const LAYER_HAS: Record<string, (o: WideRow) => boolean> = {
  TCP: (o) =>
    (o.tcp_success !== null && o.tcp_success !== undefined) ||
    (o.tcp_failure !== null && o.tcp_failure !== undefined),
  TLS: (o) =>
    [o.tls_failure, o.tls_is_certificate_valid, o.tls_version, o.tls_handshake_last_operation].some(
      (v) => v !== null && v !== undefined
    ),
  HTTP: (o) =>
    [o.http_failure, o.http_response_status_code, o.http_request_url].some(
      (v) => v !== null && v !== undefined
    ),
};

export interface LayerSpec {
  name: string;
  fields: string[];
}

export const LAYERS: LayerSpec[] = [
  {
    name: "TCP",
    fields: ["ip", "port", "ip_asn", "ip_as_org_name", "ip_cc", "ip_is_bogon", "tcp_failure", "tcp_success"],
  },
  {
    name: "TLS",
    fields: [
      "tls_failure",
      "tls_server_name",
      "tls_version",
      "tls_is_certificate_valid",
      "tls_end_entity_certificate_subject_common_name",
      "tls_end_entity_certificate_issuer_common_name",
      "tls_end_entity_certificate_san_list",
      "tls_handshake_last_operation",
    ],
  },
  {
    name: "HTTP",
    fields: [
      "http_request_url",
      "http_failure",
      "http_response_status_code",
      "http_response_body_length",
      "http_response_body_sha1",
      "http_response_header_location",
      "http_response_header_server",
    ],
  },
];

export const fmt = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  return String(v);
};

// The control schema is deliberately thin: per address it records only
// success/failure per layer (plus the TLS server name). Fields outside this
// set are simply never collected by the test helper, so their absence on the
// control side is not disagreement and must not be flagged as one.
const CONTROL_FIELDS = new Set([
  "hostname",
  "ip",
  "port",
  "ip_asn",
  "ip_as_org_name",
  "ip_as_cc",
  "ip_cc",
  "ip_is_bogon",
  "dns_failure",
  "dns_success",
  "tcp_failure",
  "tcp_success",
  "tls_failure",
  "tls_success",
  "tls_server_name",
  "http_request_url",
  "http_failure",
  "http_success",
  "http_response_body_length",
]);

// A null *_failure is only meaningful when the layer actually ran: then it is
// the success signal, and the single most important thing the view can show
// is "failure none / none" on both sides, explicitly.
const FAILURE_RAN: Record<string, { probe: (o: WideRow) => boolean; ctrl: (c: WideRow) => boolean }> = {
  tcp_failure: {
    probe: (o) => o.tcp_success !== null && o.tcp_success !== undefined,
    ctrl: (c) => c.tcp_success === 1 || c.tcp_success === true,
  },
  tls_failure: {
    probe: (o) =>
      ["tls_version", "tls_cipher_suite", "tls_is_certificate_valid", "tls_handshake_last_operation", "tls_t"].some(
        (k) => (o as any)[k] !== null && (o as any)[k] !== undefined
      ),
    ctrl: (c) => c.tls_success === 1 || c.tls_success === true,
  },
  http_failure: {
    probe: (o) => o.http_response_status_code != null || o.http_t != null,
    ctrl: (c) => c.http_success === 1 || c.http_success === true,
  },
};

function probeVal(o: WideRow, f: string): string | null {
  const v = fmt((o as any)[f]);
  if (v === null && FAILURE_RAN[f]?.probe(o)) return "none";
  return v;
}

function ctrlVal(c: WideRow, f: string): CtrlCell {
  if (!CONTROL_FIELDS.has(f)) return NOT_RECORDED;
  const v = fmt((c as any)[f]);
  if (v === null && FAILURE_RAN[f]?.ctrl(c)) return "none";
  return v;
}

export interface LayerFieldRow {
  field: string;
  probe: string | null;
  ctrl: CtrlCell;
}

export function computeLayerRows(o: WideRow, ctrl: WideRow | null, fields: string[]): LayerFieldRow[] {
  return fields
    .map((f) => ({ field: f, probe: probeVal(o, f), ctrl: ctrl ? ctrlVal(ctrl, f) : undefined }))
    .filter((r) => r.probe !== null || (r.ctrl !== undefined && r.ctrl !== null && r.ctrl !== NOT_RECORDED));
}

export interface EndpointPanel {
  key: string;
  tag: string;
  hasCtrl: boolean;
  layers: { name: string; rows: LayerFieldRow[] }[];
}

export function computeEndpointPanels(obs: WideRow[], ctrls: WideRow[]): EndpointPanel[] {
  const pEnds = endpoints(obs);
  const cEnds = endpoints(ctrls);
  const panels: EndpointPanel[] = [];
  pEnds.forEach((o, i) => {
    const ctrl = matchEndpoint(o, cEnds);
    const tag =
      (pEnds.length > 1 ? `${o.ip}${o.port ? ":" + o.port : ""}` : "") + (o._n > 1 ? `  ×${o._n}` : "");
    const layers = LAYERS.filter((layer) => LAYER_HAS[layer.name](o))
      .map((layer) => ({ name: layer.name, rows: computeLayerRows(o, ctrl, layer.fields) }))
      .filter((l) => l.rows.length > 0);
    if (!layers.length) return;
    panels.push({ key: `${endpointKey(o)}|${i}`, tag, hasCtrl: !!ctrl, layers });
  });
  return panels;
}

export function computeControlOnlyEndpoints(obs: WideRow[], ctrls: WideRow[]): DedupedRow[] {
  const pEnds = endpoints(obs);
  const cEnds = endpoints(ctrls);
  // "Attempted" means an endpoint layer actually ran: a DNS-only row means the
  // probe resolved the address but never connected, so a control connection to
  // it still belongs in the control-only panel.
  const attempted = pEnds.filter((o) => LAYER_HAS.TCP(o) || LAYER_HAS.TLS(o) || LAYER_HAS.HTTP(o));
  return cEnds.filter((c) => !attempted.some((o) => o.ip === c.ip));
}

// ---------------------------------------------------------------- DNS
interface DnsAnswer {
  addr: string;
  type: string;
  asn: number | null;
  org: string;
  cc: string;
  bogon: boolean;
}

// A DNS answer, from either side. obs_web carries the resolved address in
// dns_answer; obs_web_ctrl carries it as ip in most pipeline versions and as
// dns_answer in some, so read both.
function toAnswer(r: WideRow, side: "probe" | "control"): DnsAnswer | null {
  // Control rows exist for every address the TCP/TLS control checked, which
  // includes addresses only the *probe* resolved. dns_success === 1 is the
  // only marker that the control DNS query itself returned this address;
  // null means "checked over TCP/TLS, never seen by control DNS". Counting
  // those as control answers would echo the probe's own answers back as
  // agreement, hiding exactly the injected-answer case.
  if (side === "control" && !(r.dns_success === 1 || r.dns_success === true)) return null;
  const addr = r.dns_answer || (side === "control" ? r.ip : null);
  if (!addr) return null;
  return {
    addr: String(addr),
    type: (r.dns_answer_type as string) || (r.dns_query_type as string) || "",
    asn: (r.dns_answer_asn as number) ?? (r.ip_asn as number) ?? null,
    org: (r.dns_answer_as_org_name as string) || (r.ip_as_org_name as string) || "",
    cc: (r.ip_cc as string) || (r.ip_as_cc as string) || "",
    bogon: r.ip_is_bogon === true || r.ip_is_bogon === 1,
  };
}

function answerSet(rows: WideRow[], side: "probe" | "control"): Map<string, DnsAnswer> {
  const byAddr = new Map<string, DnsAnswer>();
  rows.forEach((r) => {
    const a = toAnswer(r, side);
    if (!a) return;
    const prev = byAddr.get(a.addr);
    byAddr.set(
      a.addr,
      prev
        ? {
            ...prev,
            asn: prev.asn ?? a.asn,
            org: prev.org || a.org,
            cc: prev.cc || a.cc,
            type: prev.type || a.type,
            bogon: prev.bogon || a.bogon,
          }
        : a
    );
  });
  return byAddr;
}

const firstNonNull = (rows: WideRow[], f: string): string | null => {
  for (const r of rows) {
    const v = (r as any)[f];
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return null;
};

export interface DnsGroupInput {
  hostname: string;
  resolverTag: string | null;
  probeRows: WideRow[];
  ctrlRows: WideRow[];
}

// Grouping: DNS first by hostname, then — within a hostname — by resolver.
// web_connectivity 0.5 resolves through several engines (system, udp to
// specific resolvers, DoH/DoT), and pooling their answers into one set hides
// exactly the signal this view exists to capture: the ISP resolver
// disagreeing with an encrypted one. Each resolver's set is compared against
// the same control.
export function computeDnsGroupInputs(obs: WideRow[], ctrls: WideRow[]): DnsGroupInput[] {
  const probeByHost = groupBy(obs, (o) => o.hostname || "");
  const ctrlByHost = groupBy(ctrls, (c) => c.hostname || "");
  const hosts = [...new Set([...probeByHost.keys(), ...ctrlByHost.keys()])].filter(Boolean);
  const out: DnsGroupInput[] = [];
  hosts.forEach((h) => {
    const cRows = ctrlByHost.get(h) || [];
    const pRows = (probeByHost.get(h) || []).filter(
      (r) => r.dns_answer != null || r.dns_failure != null || r.dns_engine != null
    );
    if (!pRows.length) {
      if (cRows.length) out.push({ hostname: h, resolverTag: null, probeRows: [], ctrlRows: cRows });
      return;
    }
    const byResolver = groupBy(pRows, (r) => (r.dns_engine || "unknown") + " " + (r.dns_engine_resolver_address || ""));
    const single = byResolver.size <= 1;
    byResolver.forEach((rows, key) => {
      const [eng, addr] = key.split(" ");
      out.push({
        hostname: h,
        resolverTag: single ? null : eng + (addr ? " · " + addr : ""),
        probeRows: rows,
        ctrlRows: cRows,
      });
    });
  });
  return out;
}

export interface DnsAnswerRow {
  addr: string;
  kind: "both" | "probe-only" | "control-only";
  asn: number | null;
  org: string;
  cc: string;
  bogon: boolean;
  type: string;
}

export interface OverlapStat {
  hits: number;
  total: number;
}

export interface DnsGroupView {
  hostname: string;
  resolverTag: string | null;
  pFail: string | null;
  cFail: string | null;
  haveCtrl: boolean;
  pAddrsCount: number;
  cAddrsCount: number;
  ipOverlap: OverlapStat;
  asnOverlap: OverlapStat;
  orgOverlap: OverlapStat;
  engine: string | null;
  engineAddr: string | null;
  queryTypes: string[];
  rows: DnsAnswerRow[];
  noAnswersEitherSide: boolean;
  controlCheckedCount: number;
}

export function computeDnsGroupView(input: DnsGroupInput): DnsGroupView {
  const { hostname, resolverTag, probeRows, ctrlRows } = input;
  const P = answerSet(probeRows, "probe");
  const C = answerSet(ctrlRows, "control");

  const pFail = firstNonNull(probeRows, "dns_failure");
  const cFail = firstNonNull(ctrlRows, "dns_failure");

  const pAddrs = [...P.keys()];
  const cAddrs = [...C.keys()];
  const ipHits = pAddrs.filter((a) => C.has(a));
  const pAsns = new Set([...P.values()].map((a) => a.asn).filter((x) => x != null));
  const cAsns = new Set([...C.values()].map((a) => a.asn).filter((x) => x != null));
  const asnHits = [...pAsns].filter((a) => cAsns.has(a));
  const pOrgs = new Set([...P.values()].map((a) => a.org).filter(Boolean));
  const cOrgs = new Set([...C.values()].map((a) => a.org).filter(Boolean));
  const orgHits = [...pOrgs].filter((o) => cOrgs.has(o));

  const haveCtrl = cAddrs.length > 0 || cFail !== null;

  const eng = firstNonNull(probeRows, "dns_engine");
  const engAddr = firstNonNull(probeRows, "dns_engine_resolver_address");
  const qtypes = [...new Set(probeRows.map((r) => r.dns_query_type).filter(Boolean))] as string[];

  const all = [...new Set([...pAddrs, ...cAddrs])].sort((a, b) => {
    const rank = (x: string) => ((P.has(x) && C.has(x)) ? 1 : P.has(x) ? 0 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  const rows: DnsAnswerRow[] = all.map((addr) => {
    const a = (P.get(addr) || C.get(addr))!;
    const inP = P.has(addr);
    const inC = C.has(addr);
    const kind: DnsAnswerRow["kind"] = inP && inC ? "both" : inP ? "probe-only" : "control-only";
    return { addr, kind, asn: a.asn, org: a.org, cc: a.cc, bogon: a.bogon, type: a.type };
  });

  return {
    hostname,
    resolverTag,
    pFail,
    cFail,
    haveCtrl,
    pAddrsCount: pAddrs.length,
    cAddrsCount: cAddrs.length,
    ipOverlap: { hits: ipHits.length, total: pAddrs.length },
    asnOverlap: { hits: asnHits.length, total: pAsns.size },
    orgOverlap: { hits: orgHits.length, total: pOrgs.size },
    engine: eng,
    engineAddr: engAddr,
    queryTypes: qtypes,
    rows,
    noAnswersEitherSide: !pAddrs.length && !cAddrs.length,
    controlCheckedCount: new Set(ctrlRows.filter((r) => r.ip).map((r) => r.ip)).size,
  };
}

// ---------------------------------------------------------------- context strip
const CTX_PALETTE = ["#ff7359", "#ffb84d", "#6ec7de", "#9d84f7", "#e885bd", "#c3cc55"];
const ctxColorCache: Record<string, string> = {};

// Colors are cached across calls so the same failure string keeps the same
// color from row to row, which is what makes the legend readable at a glance.
export function ctxColor(k: string): string {
  if (k === "ok") return "var(--agree)";
  if (!ctxColorCache[k]) {
    ctxColorCache[k] = CTX_PALETTE[Object.keys(ctxColorCache).length % CTX_PALETTE.length];
  }
  return ctxColorCache[k];
}

export interface ContextBar {
  ts: string;
  title: string;
  segments: { heightPx: number; color: string }[];
}

export interface ContextView {
  bars: ContextBar[];
  legend: { key: string; color: string }[];
}

export function computeContextView(ctx: ContextResponse): ContextView {
  const byTs: Record<string, ContextSeriesPoint[]> = {};
  ctx.series.forEach((s) => {
    const t = String(s.ts).slice(0, 13);
    (byTs[t] = byTs[t] || []).push(s);
  });
  const keys = Object.keys(byTs).sort();
  const max = Math.max(...keys.map((t) => byTs[t].reduce((a, s) => a + s.count, 0)), 1);

  const bars: ContextBar[] = keys.map((t) => ({
    ts: t,
    title:
      t.replace("T", " ") +
      ":00\n" +
      byTs[t].map((s) => `${s.failure_str} ×${s.count} (res AS${s.resolver_asn})`).join("\n"),
    segments: byTs[t].map((s) => ({ heightPx: (46 * s.count) / max, color: ctxColor(s.failure_str) })),
  }));

  const legend = [...new Set(ctx.series.map((s) => s.failure_str))].map((k) => ({
    key: k,
    color: ctxColor(k),
  }));

  return { bars, legend };
}
