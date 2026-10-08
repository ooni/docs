import { FAILURE_FAMILIES } from "../measurement-viewer/FailureChart";
import type { WebObservation } from "../measurement-viewer/types";
import type {
  FastpathRow,
  Layer,
  ObservationAggRow,
  RuleClass,
  RuleCount,
} from "./types";

export const HOUR_MS = 3600e3;

// "YYYY-MM-DD HH:00"
export const isoHour = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 16).replace("T", " ");

const parseTs = (s: string) => Date.parse(s.endsWith("Z") || s.includes("+") ? s : s + "Z");

export function hoursBetween(startMs: number, endMs: number): number[] {
  const out: number[] = [];
  for (let t = startMs; t < endMs; t += HOUR_MS) out.push(t);
  return out;
}

// A stacked hourly bar chart's input: per hour, a value per series key
export type HourValues = Map<number, Record<string, number>>;

export interface SeriesDef {
  key: string;
  label: string;
  // CSS color, usually a var(--…) token
  color: string;
}

// ---------------------------------------------------------------- analysis

export const RULE_CLASS_SERIES: SeriesDef[] = [
  { key: "blocked", label: "blocked", color: "var(--block)" },
  { key: "discarded", label: "discarded", color: "var(--discarded)" },
  { key: "ok", label: "ok", color: "var(--ok-line)" },
];

// Measurements of one layer per hour, split by how the detector counts the
// rule that scored them. Every measurement is scored once per layer, so the
// stack of one layer adds up to the measurements of the hour.
export function ruleClassHourly(hourly: RuleCount[], layer: Layer): HourValues {
  const out: HourValues = new Map();
  for (const r of hourly) {
    if (r.layer !== layer || !r.ts_hour) continue;
    const t = parseTs(r.ts_hour);
    const v = out.get(t) ?? { blocked: 0, discarded: 0, ok: 0 };
    v[r.class] += r.count;
    out.set(t, v);
  }
  return out;
}

export function rulesAt(hourly: RuleCount[], hourMs: number): RuleCount[] {
  const order: Record<RuleClass, number> = { blocked: 0, ok: 1, discarded: 2 };
  return hourly
    .filter((r) => r.ts_hour && parseTs(r.ts_hour) === hourMs)
    .sort(
      (a, b) =>
        a.layer.localeCompare(b.layer) ||
        order[a.class] - order[b.class] ||
        b.count - a.count
    );
}

// ---------------------------------------------------------------- fastpath

export const FASTPATH_SERIES: SeriesDef[] = [
  { key: "confirmed", label: "confirmed", color: "var(--confirmed)" },
  { key: "anomaly", label: "anomaly", color: "var(--block)" },
  { key: "failure", label: "failure", color: "var(--discarded)" },
  { key: "ok", label: "ok", color: "var(--ok-line)" },
];

export function fastpathHourly(rows: FastpathRow[]): HourValues {
  const out: HourValues = new Map();
  for (const r of rows) {
    out.set(parseTs(r.measurement_start_day), {
      confirmed: r.confirmed_count,
      anomaly: r.anomaly_count,
      failure: r.failure_count,
      ok: r.ok_count,
    });
  }
  return out;
}

// ---------------------------------------------------------------- observations

// Same failure families as the measurement viewer; observations without a
// failure stack underneath in a recessive neutral
export const OBSERVATION_SERIES: SeriesDef[] = [
  { key: "none", label: "no failure", color: "var(--series-none)" },
  ...FAILURE_FAMILIES.map((f) => ({ key: f.key, label: f.label, color: `var(${f.cssVar})` })),
];

export interface ObservationHours {
  values: HourValues;
  // exact failure string -> count per hour, for the tooltip
  details: Map<number, Map<string, number>>;
  // the measurements behind each hour, for loading its observations
  uids: Map<number, string[]>;
}

export function observationHourly(rows: ObservationAggRow[]): ObservationHours {
  const values: HourValues = new Map();
  const details = new Map<number, Map<string, number>>();
  const uidSets = new Map<number, Set<string>>();
  const families = new Set<string>(FAILURE_FAMILIES.map((f) => f.key));
  for (const r of rows) {
    if (!r.timestamp) continue;
    const t = parseTs(r.timestamp);
    if (r.measurement_uid) {
      const u = uidSets.get(t) ?? new Set<string>();
      u.add(r.measurement_uid);
      uidSets.set(t, u);
    }
    if (!r.failure) continue;
    const v = values.get(t) ?? {};
    const fam = r.failure === "none" ? "none" : r.failure.split(".", 1)[0];
    if (fam !== "none" && !families.has(fam)) continue;
    v[fam] = (v[fam] ?? 0) + r.observation_count;
    values.set(t, v);
    const d = details.get(t) ?? new Map<string, number>();
    d.set(r.failure, (d.get(r.failure) ?? 0) + r.observation_count);
    details.set(t, d);
  }
  const uids = new Map([...uidSets].map(([t, u]) => [t, [...u]]));
  return { values, details, uids };
}

// ---------------------------------------------------------------- hour tables

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Timing {
  median: number | null;
  min: number | null;
  max: number | null;
}

const timing = (xs: number[]): Timing => ({
  median: median(xs),
  min: xs.length ? Math.min(...xs) : null,
  max: xs.length ? Math.max(...xs) : null,
});

// Groups rows by key, counting them and collecting one numeric field
function groupRows<T>(
  rows: WebObservation[],
  keyOf: (o: WebObservation) => string,
  init: (o: WebObservation) => T,
  t?: (o: WebObservation) => number | null | undefined
): { row: T; count: number; uids: Set<string>; timing: Timing }[] {
  const groups = new Map<string, { row: T; count: number; uids: Set<string>; ts: number[] }>();
  for (const o of rows) {
    const k = keyOf(o);
    const g = groups.get(k) ?? { row: init(o), count: 0, uids: new Set<string>(), ts: [] };
    g.count++;
    g.uids.add(o.measurement_uid);
    const v = t?.(o);
    if (typeof v === "number") g.ts.push(v);
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => ({ row: g.row, count: g.count, uids: g.uids, timing: timing(g.ts) }))
    .sort((a, b) => b.count - a.count);
}

export interface DnsRow {
  queryType: string;
  engine: string;
  resolver: string;
  answer: string | null;
  answerAsn: number | null;
  answerOrg: string | null;
  isBogon: boolean;
  failure: string | null;
}

export interface TcpRow {
  ip: string;
  port: number | null;
  asn: number | null;
  org: string | null;
  failure: string | null; // null when the connect succeeded
}

export interface TlsRow {
  ip: string | null;
  port: number | null;
  serverName: string | null;
  failure: string | null; // null when the handshake succeeded
  version: string | null;
  certValid: boolean | null;
  subject: string | null;
  issuer: string | null;
  notAfter: string | null;
}

export interface HourTables {
  dns: ReturnType<typeof groupRows<DnsRow>>;
  tcp: ReturnType<typeof groupRows<TcpRow>>;
  tls: ReturnType<typeof groupRows<TlsRow>>;
}

const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function hourTables(obs: WebObservation[]): HourTables {
  const dnsObs = obs.filter((o) => o.dns_query_type != null || o.dns_failure != null);
  const tcpObs = obs.filter((o) => o.ip && (o.tcp_success != null || o.tcp_failure != null));
  const tlsObs = obs.filter(
    (o) =>
      o.tls_failure != null ||
      o.tls_version != null ||
      o.tls_handshake_time != null ||
      o.tls_is_certificate_valid != null
  );

  const dns = groupRows<DnsRow>(
    dnsObs,
    (o) =>
      [o.dns_query_type, o.dns_engine, o.dns_engine_resolver_address, o.dns_answer, o.dns_failure].join("|"),
    (o) => ({
      queryType: o.dns_query_type ?? "—",
      engine: o.dns_engine ?? "—",
      resolver: o.dns_engine_resolver_address || "system",
      answer: o.dns_answer,
      // getaddrinfo reports CNAMEs as answers with ASN 0
      answerAsn: o.dns_answer_asn || null,
      answerOrg: o.dns_answer_as_org_name,
      isBogon: !!o.ip_is_bogon && o.ip === o.dns_answer,
      failure: o.dns_failure,
    })
  );

  const tcp = groupRows<TcpRow>(
    tcpObs,
    (o) => [o.ip, o.port, o.tcp_success ? "" : o.tcp_failure ?? "failure"].join("|"),
    (o) => ({
      ip: o.ip as string,
      port: o.port,
      asn: o.ip_asn,
      org: o.ip_as_org_name,
      failure: o.tcp_success ? null : o.tcp_failure ?? "unknown_failure",
    }),
    (o) => o.tcp_t
  );

  const tls = groupRows<TlsRow>(
    tlsObs,
    (o) =>
      [
        o.ip,
        o.port,
        o.tls_server_name,
        o.tls_failure,
        o.tls_end_entity_certificate_subject_common_name,
        o.tls_end_entity_certificate_issuer_common_name,
        o.tls_is_certificate_valid,
      ].join("|"),
    (o) => ({
      ip: o.ip,
      port: o.port,
      serverName: o.tls_server_name,
      failure: o.tls_failure,
      version: o.tls_version,
      certValid: o.tls_is_certificate_valid,
      subject: s(o.tls_end_entity_certificate_subject_common_name),
      issuer: s(o.tls_end_entity_certificate_issuer_common_name),
      notAfter: s(o.tls_end_entity_certificate_not_valid_after),
    }),
    (o) => o.tls_handshake_time
  );

  return { dns, tcp, tls };
}

// DNS answers summed over every engine and resolver: which addresses the
// domain resolved to in the hour, and who announces them
export function answerSummary(
  dns: HourTables["dns"]
): { answer: string; asn: number | null; org: string | null; isBogon: boolean; count: number }[] {
  const m = new Map<string, { answer: string; asn: number | null; org: string | null; isBogon: boolean; count: number }>();
  for (const g of dns) {
    const a = g.row.answer;
    if (!a) continue;
    const e = m.get(a) ?? { answer: a, asn: g.row.answerAsn, org: g.row.answerOrg, isBogon: g.row.isBogon, count: 0 };
    e.count += g.count;
    m.set(a, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}
