import { useEffect, useMemo, useState } from "react";
import { fetchAggregatedObservations } from "./api";
import { ctrlForEndpoint, hasTCP, hasTLS, hasHTTP } from "./derive";
import type { HostnameGroup } from "./derive";
import FailureChart, {
  FAILURE_FAMILIES,
  NONE_SERIES,
  bucketByDay,
  maxStack,
} from "./FailureChart";
import type { DayBucket } from "./FailureChart";
import type { MeasurementMeta, WebObservation } from "./types";

const fmt = new Intl.NumberFormat("en-US");

function StatusBadge({
  ok,
  okLabel,
  failLabel,
}: {
  ok: boolean;
  okLabel: string;
  failLabel: string;
}) {
  return ok ? (
    <span className="badge-ok">✓ {okLabel}</span>
  ) : (
    <span className="badge-fail">✕ {failLabel}</span>
  );
}

// "control: 3 ok · 1 failed" line shown under the probe's own result
function CtrlCounts({
  success,
  failure,
  missing,
}: {
  success?: number;
  failure?: number;
  missing?: boolean;
}) {
  if (missing) {
    return <div className="text-xs text-muted mt-0.5">control: no data</div>;
  }
  return (
    <div className="text-xs text-muted mt-0.5">
      control: <strong className="text-secondary">{fmt.format(success ?? 0)}</strong> ok ·{" "}
      <strong className="text-secondary">{fmt.format(failure ?? 0)}</strong> failed
    </div>
  );
}

function AsnLabel({
  asn,
  orgName,
}: {
  asn: number | null | undefined;
  orgName: string | null | undefined;
}) {
  if (asn == null) return null;
  return (
    <span className="text-xs text-muted">
      AS{asn}
      {orgName ? ` · ${orgName}` : ""}
    </span>
  );
}

// How a probe DNS answer relates to the control ground truth
function answerConsistency(
  ip: string | null,
  ctrlDnsIPs: Set<string>,
  tlsConsistentByIP: Map<string, boolean>
): "in_control" | "tls_consistent" | "inconsistent" | "unknown" | null {
  if (!ip) return null;
  if (ctrlDnsIPs.has(ip)) return "in_control";
  const tls = tlsConsistentByIP.get(ip);
  if (tls === true) return "tls_consistent";
  if (tls === false) return "inconsistent";
  return "unknown";
}

function AnswerConsistencyChips({
  status,
}: {
  status: ReturnType<typeof answerConsistency>;
}) {
  if (status === null) return null;
  if (status === "in_control")
    return <span className="chip chip-ok">✓ in control DNS</span>;
  return (
    <>
      <span className="chip chip-warn">not in control DNS</span>
      {status === "tls_consistent" && (
        <span className="chip chip-ok">TLS consistent</span>
      )}
      {status === "inconsistent" && (
        <span className="chip chip-bad">✕ not TLS consistent</span>
      )}
    </>
  );
}

function DnsSection({ group }: { group: HostnameGroup }) {
  const ctrlAnswerIPs = group.ctrl.filter((c) => c.in_dns_answers);
  const dnsCounts = group.ctrl[0];
  if (group.dnsByResolver.length === 0 && ctrlAnswerIPs.length === 0) return null;

  const ctrlDnsIPs = new Set(ctrlAnswerIPs.map((c) => c.ip));
  // Did any TLS handshake against this IP succeed in the control? Catches
  // CDN-style answers that never show up in the control's own DNS.
  const tlsConsistentByIP = new Map<string, boolean>();
  for (const c of group.ctrl) {
    tlsConsistentByIP.set(
      c.ip,
      (tlsConsistentByIP.get(c.ip) ?? false) || c.tls_consistent
    );
  }
  const probeAnswerIPs = new Set(
    group.dnsByResolver
      .flatMap((rg) => rg.queries.map((q) => q.dns_answer))
      .filter((ip): ip is string => !!ip)
  );
  const commonCount = [...probeAnswerIPs].filter((ip) => ctrlDnsIPs.has(ip)).length;
  // IPs the probe saw in common with the control float to the top of the list
  const sortedCtrlIPs = [...ctrlAnswerIPs].sort(
    (a, b) =>
      Number(probeAnswerIPs.has(b.ip)) - Number(probeAnswerIPs.has(a.ip)) ||
      a.ip.localeCompare(b.ip)
  );

  return (
    <section className="card">
      <h3 className="card-title">DNS queries</h3>
      <div className="grid gap-4 md:grid-cols-[1fr_minmax(220px,0.6fr)]">
        <div className="space-y-3">
          {group.dnsByResolver.length === 0 && (
            <p className="text-sm text-muted">No DNS queries in this measurement.</p>
          )}
          {group.dnsByResolver.map((rg) => (
            <div key={rg.engine + rg.resolverAddress}>
              <div className="text-xs uppercase tracking-wide text-muted mb-1">
                resolver: <span className="text-secondary">{rg.engine}</span>
                {rg.resolverAddress ? (
                  <span className="text-secondary"> ({rg.resolverAddress})</span>
                ) : null}
              </div>
              <table className="data-table text-sm">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Answer</th>
                    <th>Network</th>
                    <th className="text-right">t</th>
                  </tr>
                </thead>
                <tbody>
                  {rg.queries.map((q) => (
                    <tr key={q.observation_idx}>
                      <td className="font-mono text-xs">{q.dns_query_type ?? "—"}</td>
                      <td>
                        {q.dns_failure ? (
                          <span className="badge-fail">✕ {q.dns_failure}</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="font-mono text-xs">
                              {q.dns_answer ?? "—"}
                            </span>
                            <AnswerConsistencyChips
                              status={answerConsistency(
                                q.dns_answer,
                                ctrlDnsIPs,
                                tlsConsistentByIP
                              )}
                            />
                          </div>
                        )}
                      </td>
                      <td>
                        <AsnLabel
                          asn={q.dns_answer_asn}
                          orgName={q.dns_answer_as_org_name}
                        />
                      </td>
                      <td className="text-right text-xs text-muted tabular-nums">
                        {q.dns_t != null ? `${(q.dns_t * 1000).toFixed(0)}ms` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <aside className="ctrl-panel">
          <h4 className="ctrl-title">Control resolution</h4>
          {group.ctrl.length === 0 ? (
            <p className="text-sm text-muted">No control data for this hostname.</p>
          ) : (
            <>
              {dnsCounts && (
                <p className="text-xs text-muted mb-1">
                  <strong className="text-secondary">
                    {fmt.format(dnsCounts.dns_success_count)}
                  </strong>{" "}
                  resolutions ok ·{" "}
                  <strong className="text-secondary">
                    {fmt.format(dnsCounts.dns_nxdomain_count)}
                  </strong>{" "}
                  nxdomain ·{" "}
                  <strong className="text-secondary">
                    {fmt.format(dnsCounts.dns_other_failure_count)}
                  </strong>{" "}
                  other failures
                </p>
              )}
              {probeAnswerIPs.size > 0 && (
                <p
                  className={`text-xs mb-2 ${
                    commonCount > 0 ? "badge-ok" : "badge-warn"
                  }`}
                >
                  {commonCount > 0 ? "✓" : "!"} {commonCount} of{" "}
                  {probeAnswerIPs.size} probe answer
                  {probeAnswerIPs.size === 1 ? "" : "s"} also in control DNS
                </p>
              )}
              <ul className="space-y-1">
                {sortedCtrlIPs.map((c) => {
                  const common = probeAnswerIPs.has(c.ip);
                  return (
                    <li
                      key={c.ip + String(c.port)}
                      className={`text-xs ${common ? "ctrl-ip-common" : ""}`}
                    >
                      {common && <span className="badge-ok">✓ </span>}
                      <span className="font-mono">{c.ip}</span>{" "}
                      <AsnLabel asn={c.asn} orgName={c.as_org_name} />
                      {common && <span className="chip chip-ok ml-1">probe answer</span>}
                      {c.is_cloud_provider && <span className="chip ml-1">cloud</span>}
                    </li>
                  );
                })}
                {ctrlAnswerIPs.length === 0 && (
                  <li className="text-xs text-muted">
                    No IPs seen in control DNS answers.
                  </li>
                )}
              </ul>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function HttpCell({ o }: { o: WebObservation }) {
  if (!hasHTTP(o)) return <span className="text-muted">—</span>;
  return (
    <div>
      {o.http_failure ? (
        <span className="badge-fail">✕ {o.http_failure}</span>
      ) : (
        <StatusBadge
          ok
          okLabel={`HTTP ${o.http_response_status_code ?? "?"}`}
          failLabel=""
        />
      )}
      {o.http_request_url && (
        <div
          className="text-xs text-muted font-mono truncate max-w-[220px]"
          title={o.http_request_url}
        >
          {o.http_request_method ? `${o.http_request_method} ` : ""}
          {o.http_request_url}
        </div>
      )}
      {o.http_response_body_length != null && !o.http_failure && (
        <div className="text-xs text-muted">
          {fmt.format(o.http_response_body_length)} bytes
        </div>
      )}
    </div>
  );
}

function EndpointsSection({ group }: { group: HostnameGroup }) {
  if (group.endpoints.length === 0) return null;
  return (
    <section className="card">
      <h3 className="card-title">TCP connect · TLS handshake · HTTP</h3>
      <div className="overflow-x-auto">
        <table className="data-table text-sm">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>TCP connect</th>
              <th>TLS handshake</th>
              <th>HTTP request</th>
            </tr>
          </thead>
          <tbody>
            {group.endpoints.map((o) => {
              const ctrl = ctrlForEndpoint(group, o);
              return (
                <tr key={o.observation_idx}>
                  <td>
                    <div className="font-mono text-xs">
                      {o.ip}
                      {o.port != null ? `:${o.port}` : ""}
                    </div>
                    <AsnLabel asn={o.ip_asn} orgName={o.ip_as_org_name} />
                    <div className="mt-0.5 space-x-1">
                      {o.ip_is_bogon && <span className="chip chip-warn">bogon</span>}
                      {ctrl?.in_dns_answers && (
                        <span className="chip chip-ok">✓ in control DNS</span>
                      )}
                      {ctrl && !ctrl.in_dns_answers && (
                        <span className="chip chip-warn">not in control DNS</span>
                      )}
                      {ctrl && !ctrl.tls_consistent && (
                        <span className="chip chip-bad">✕ not TLS consistent</span>
                      )}
                      {ctrl?.is_cloud_provider && <span className="chip">cloud</span>}
                    </div>
                  </td>
                  <td>
                    {hasTCP(o) ? (
                      <StatusBadge
                        ok={o.tcp_failure == null && o.tcp_success !== false}
                        okLabel="connected"
                        failLabel={o.tcp_failure ?? "failed"}
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    <CtrlCounts
                      missing={!ctrl}
                      success={ctrl?.tcp_success_count}
                      failure={ctrl?.tcp_failure_count}
                    />
                  </td>
                  <td>
                    {hasTLS(o) ? (
                      <div>
                        <StatusBadge
                          ok={o.tls_failure == null}
                          okLabel={
                            o.tls_is_certificate_valid === false
                              ? "handshake ok, bad cert"
                              : "handshake ok"
                          }
                          failLabel={o.tls_failure ?? ""}
                        />
                        {o.tls_version && (
                          <div className="text-xs text-muted">
                            {o.tls_version}
                            {o.tls_server_name ? ` · SNI ${o.tls_server_name}` : ""}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    <CtrlCounts
                      missing={!ctrl}
                      success={ctrl?.tls_success_count}
                      failure={ctrl?.tls_failure_count}
                    />
                    {ctrl && ctrl.tls_consistent && hasTLS(o) && (
                      <div className="text-xs text-muted">
                        TLS consistent in control
                      </div>
                    )}
                  </td>
                  <td>
                    <HttpCell o={o} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StandaloneHttpSection({ group }: { group: HostnameGroup }) {
  if (group.standaloneHTTP.length === 0) return null;
  return (
    <section className="card">
      <h3 className="card-title">HTTP requests (not tied to an endpoint)</h3>
      <table className="data-table text-sm">
        <thead>
          <tr>
            <th>URL</th>
            <th>Result</th>
            <th className="text-right">Runtime</th>
          </tr>
        </thead>
        <tbody>
          {group.standaloneHTTP.map((o) => (
            <tr key={o.observation_idx}>
              <td className="font-mono text-xs break-all">
                {o.http_request_method ? `${o.http_request_method} ` : ""}
                {o.http_request_url}
              </td>
              <td>
                {o.http_failure ? (
                  <span className="badge-fail">✕ {o.http_failure}</span>
                ) : (
                  <span className="badge-ok">
                    ✓ HTTP {o.http_response_status_code ?? "?"}
                    {o.http_response_body_length != null
                      ? ` · ${fmt.format(o.http_response_body_length)} bytes`
                      : ""}
                  </span>
                )}
              </td>
              <td className="text-right text-xs text-muted tabular-nums">
                {o.http_runtime != null ? `${(o.http_runtime * 1000).toFixed(0)}ms` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface ChartData {
  isp: DayBucket[];
  all: DayBucket[];
}

function FailurePanel({
  hostname,
  meta,
  apiBase,
  resolverASN,
  since,
  until,
}: {
  hostname: string;
  meta: MeasurementMeta;
  apiBase: string;
  resolverASN: number | null;
  since: string;
  until: string;
}) {
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    const common = { hostname, probeASN: meta.probe_asn, since, until };
    Promise.all([
      fetchAggregatedObservations(apiBase, {
        ...common,
        resolverASN: resolverASN ?? meta.probe_asn,
      }),
      fetchAggregatedObservations(apiBase, common),
    ])
      .then(([isp, all]) => {
        if (cancelled) return;
        setData({
          isp: bucketByDay(isp, since, until),
          all: bucketByDay(all, since, until),
        });
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, hostname, meta.probe_asn, resolverASN, since, until]);

  const yMax = data ? Math.max(maxStack(data.isp), maxStack(data.all)) : 0;

  const presentSeries = useMemo(() => {
    if (!data) return [];
    const all = [...data.isp, ...data.all];
    const series: { key: string; label: string; cssVar: string }[] = [];
    if (all.some((b) => b.none > 0)) series.push(NONE_SERIES);
    for (const f of FAILURE_FAMILIES) {
      if (all.some((b) => b.byFamily[f.key] > 0)) series.push(f);
    }
    return series;
  }, [data]);

  return (
    <section className="card">
      <h3 className="card-title">
        Observations over time{" "}
        <span className="font-normal text-muted">
          — AS{meta.probe_asn}, last 30 days, daily counts by outcome
        </span>
      </h3>
      {error && <p className="text-sm badge-fail">✕ chart data failed: {error}</p>}
      {!data && !error && <p className="text-sm text-muted">Loading chart…</p>}
      {data && (
        <>
          {presentSeries.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
              {presentSeries.map((f) => (
                <span key={f.key} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="chart-swatch"
                    style={{ background: `var(${f.cssVar})` }}
                  />
                  <span className="text-secondary">{f.label}</span>
                </span>
              ))}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <FailureChart
              title={`Probe's resolver (AS${resolverASN ?? meta.probe_asn})`}
              buckets={data.isp}
              yMax={yMax}
            />
            <FailureChart title="All resolvers" buckets={data.all} yMax={yMax} />
          </div>
        </>
      )}
    </section>
  );
}

export default function HostnameSection({
  group,
  meta,
  apiBase,
  chartSince,
  chartUntil,
}: {
  group: HostnameGroup;
  meta: MeasurementMeta;
  apiBase: string;
  chartSince: string;
  chartUntil: string;
}) {
  // The resolver the probe actually used, as annotated on the observations
  const resolverASN =
    group.observations.find((o) => o.resolver_asn != null)?.resolver_asn ?? null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        <span className="font-mono">{group.hostname}</span>{" "}
        <span className="text-sm font-normal text-muted">
          {group.observations.length} observation
          {group.observations.length === 1 ? "" : "s"}
        </span>
      </h2>
      <DnsSection group={group} />
      <EndpointsSection group={group} />
      <StandaloneHttpSection group={group} />
      <FailurePanel
        hostname={group.hostname}
        meta={meta}
        apiBase={apiBase}
        resolverASN={resolverASN}
        since={chartSince}
        until={chartUntil}
      />
    </div>
  );
}
