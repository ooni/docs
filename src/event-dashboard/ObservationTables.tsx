import { ctrlForEndpoint, groupByTarget, hasTCP, hasTLS } from "../measurement-viewer/derive";
import type { TargetGroup } from "../measurement-viewer/derive";
import {
  AsnLabel,
  CtrlCounts,
  DnsSection,
  HttpCell,
  StandaloneHttpSection,
  StatusBadge,
} from "../measurement-viewer/HostnameSection";
import type {
  CtrlGroundTruthEntry,
  MeasurementAnalysis,
  WebObservation,
} from "../measurement-viewer/types";
import VerdictSection from "../measurement-viewer/VerdictSection";
import CtrlSummary from "./CtrlSummary";
import type { HourMeasurement, HourObservations } from "./api";
import { answerSummary, hourTables, isoHour } from "./inspect";

const fmt = new Intl.NumberFormat("en-US");

interface Props {
  data: HourObservations;
  hourMs: number;
  // the hour's fastpath counts from the hourly aggregation, network wide
  fastpath: Record<string, number> | undefined;
  ooniApi: string;
  onLoadMore: () => void;
}

// The hour, one section per measurement, laid out like the measurement
// viewer: what the probe saw next to what the control saw
export default function ObservationTables({ data, hourMs, fastpath, ooniApi, onLoadMore }: Props) {
  const byUid = new Map<string, WebObservation[]>();
  for (const o of data.observations) {
    const list = byUid.get(o.measurement_uid) ?? [];
    list.push(o);
    byUid.set(o.measurement_uid, list);
  }

  return (
    <div className="space-y-5">
      <div className="text-xs text-secondary">
        <strong className="text-primary">{isoHour(hourMs)} UTC</strong> ·{" "}
        {fmt.format(data.measurements.length)} measurement
        {data.measurements.length === 1 ? "" : "s"} ·{" "}
        {fmt.format(data.observations.length)} observations ·{" "}
        {data.ctrl.length > 0
          ? `${fmt.format(data.ctrl.length)} control entries`
          : "no control data"}
        <div className="mt-1">
          fastpath, whole network this hour:{" "}
          {fastpath ? (
            <span className="tabular-nums">
              <strong className="badge-fail">{fastpath.confirmed ?? 0}</strong> confirmed ·{" "}
              <strong className="badge-fail">{fastpath.anomaly ?? 0}</strong> anomaly ·{" "}
              <strong>{fastpath.failure ?? 0}</strong> failure ·{" "}
              <strong className="badge-ok">{fastpath.ok ?? 0}</strong> ok
            </span>
          ) : (
            <span className="text-muted">no measurements</span>
          )}
        </div>
        {data.skipped > 0 && (
          <>
            <span className="badge-warn">
              {" "}
              · ⚠ {data.skipped} more measurement{data.skipped === 1 ? "" : "s"} in this hour not loaded
            </span>{" "}
            <button type="button" className="link" onClick={onLoadMore}>
              load more
            </button>
          </>
        )}
      </div>

      {data.measurements.length > 1 && <HourSummary observations={data.observations} />}

      {data.measurements.length === 0 && (
        <p className="text-sm text-muted">No measurements of this domain in the hour.</p>
      )}
      {data.measurements.map((m, i) => (
        <MeasurementSection
          key={m.measurement_uid}
          index={i + 1}
          meta={m}
          observations={(byUid.get(m.measurement_uid) ?? []).sort(
            (a, b) => a.observation_idx - b.observation_idx
          )}
          ctrl={data.ctrl}
          analysis={data.analysis[m.measurement_uid] ?? null}
          ooniApi={ooniApi}
        />
      ))}
    </div>
  );
}

function MeasurementSection({
  index,
  meta,
  observations,
  ctrl,
  analysis,
  ooniApi,
}: {
  index: number;
  meta: HourMeasurement;
  observations: WebObservation[];
  ctrl: CtrlGroundTruthEntry[];
  analysis: MeasurementAnalysis | null;
  ooniApi: string;
}) {
  const groups = groupByTarget(observations, ctrl);
  const first = observations[0];
  const viewer = `/tools/measurement-viewer?${new URLSearchParams({
    measurement_uid: meta.measurement_uid,
    api_base: ooniApi,
  })}`;
  return (
    <section className="msmt">
      <header className="msmt-head">
        <span className="msmt-index">#{index}</span>
        <span className="tabular-nums font-bold">
          {meta.measurement_start_time.slice(11, 19)} UTC
        </span>
        <a className="msmt-link font-mono" href={viewer} target="_blank" rel="noreferrer">
          {meta.measurement_uid}
        </a>
        <a
          className="msmt-link"
          href={`https://explorer.ooni.org/m/${meta.measurement_uid}`}
          target="_blank"
          rel="noreferrer"
        >
          explorer ↗
        </a>
      </header>
      <div className="msmt-body space-y-4">
        <div className="text-xs text-secondary">
          {meta.test_name}
          {first && (
            <>
              {" "}· resolver <span className="font-mono">{first.resolver_ip}</span>{" "}
              <AsnLabel asn={first.resolver_asn} orgName={first.resolver_as_org_name} />
            </>
          )}{" "}
          · {observations.length} observation{observations.length === 1 ? "" : "s"}
        </div>
        <div className="msmt-verdict">
          <VerdictSection meta={null} analysis={analysis} />
        </div>
        {observations.length === 0 && (
          <p className="text-sm text-muted">
            No observations of this domain were returned for this measurement.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="space-y-4">
            {groups.length > 1 && (
              <h4 className="sub-title font-mono normal-case">{g.targetId ?? g.key}</h4>
            )}
            <DnsSection group={g} renderCtrl={(p) => <CtrlSummary {...p} />} />
            <EndpointSection group={g} />
            <StandaloneHttpSection group={g} />
          </div>
        ))}
      </div>
    </section>
  );
}

const ms = (s: number | null | undefined) => (s != null ? `${Math.round(s * 1000)} ms` : null);

// The measurement viewer's endpoint table, plus what an event review needs on
// top: connect timing and the end-entity certificate the probe was handed
function EndpointSection({ group }: { group: TargetGroup }) {
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
              <th>Certificate</th>
              <th>HTTP request</th>
            </tr>
          </thead>
          <tbody>
            {group.endpoints.map((o) => {
              const c = ctrlForEndpoint(group, o);
              const subject = o.tls_end_entity_certificate_subject_common_name;
              const issuer = o.tls_end_entity_certificate_issuer_common_name;
              const notAfter = o.tls_end_entity_certificate_not_valid_after as string | null | undefined;
              return (
                <tr key={o.observation_idx}>
                  <td>
                    <div className="font-mono text-xs">
                      {o.ip}
                      {o.port != null ? `:${o.port}` : ""}
                    </div>
                    <AsnLabel asn={o.ip_asn} orgName={o.ip_as_org_name} />
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {o.ip_is_bogon && <span className="chip chip-warn">bogon</span>}
                      {c?.in_dns_answers && <span className="chip chip-ok">✓ in control DNS</span>}
                      {c && !c.in_dns_answers && <span className="chip chip-warn">not in control DNS</span>}
                      {c && !c.tls_consistent && <span className="chip chip-bad">✕ not TLS consistent</span>}
                      {c?.is_cloud_provider && <span className="chip">cloud</span>}
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
                    {o.tcp_t != null && (
                      <div className="text-xs text-muted tabular-nums">t {o.tcp_t.toFixed(2)} s</div>
                    )}
                    <CtrlCounts missing={!c} success={c?.tcp_success_count} failure={c?.tcp_failure_count} />
                  </td>
                  <td>
                    {hasTLS(o) ? (
                      <div>
                        <StatusBadge
                          ok={o.tls_failure == null}
                          okLabel={o.tls_is_certificate_valid === false ? "handshake ok, bad cert" : "handshake ok"}
                          failLabel={o.tls_failure ?? ""}
                        />
                        <div className="text-xs text-muted">
                          {[o.tls_version, o.tls_server_name && `SNI ${o.tls_server_name}`, ms(o.tls_handshake_time)]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    <CtrlCounts missing={!c} success={c?.tls_success_count} failure={c?.tls_failure_count} />
                    {c?.tls_consistent && hasTLS(o) && (
                      <div className="text-xs text-muted">TLS consistent in control</div>
                    )}
                  </td>
                  <td>
                    {subject || issuer ? (
                      <div className="text-xs">
                        <div className="font-mono">
                          {subject ?? "—"}
                          {o.tls_is_certificate_valid === false && <span className="chip chip-bad ml-1">invalid</span>}
                          {o.tls_is_certificate_valid === true && <span className="chip chip-ok ml-1">valid</span>}
                        </div>
                        {issuer && <div className="text-muted">issuer {issuer}</div>}
                        {notAfter && <div className="text-muted tabular-nums">expires {notAfter.slice(0, 10)}</div>}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
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

// Totals across every measurement of the hour, folded away: the sections
// below are the primary view, this answers "what did the hour look like"
function HourSummary({ observations }: { observations: WebObservation[] }) {
  const t = hourTables(observations);
  const answers = answerSummary(t.dns);
  const count = (xs: { count: number; row: { failure: string | null } }[], failed: boolean) =>
    xs.filter((g) => !!g.row.failure === failed).reduce((n, g) => n + g.count, 0);
  return (
    <details className="hour-summary">
      <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide">
        Across the hour — {answers.length} distinct answer{answers.length === 1 ? "" : "s"} · DNS{" "}
        {count(t.dns, true)} failed · TCP {count(t.tcp, false)} ok / {count(t.tcp, true)} failed · TLS{" "}
        {count(t.tls, false)} ok / {count(t.tls, true)} failed
      </summary>
      <div className="grid gap-4 md:grid-cols-2 mt-3">
        <table className="ed-table">
          <thead>
            <tr>
              <th>DNS answer</th>
              <th>ASN</th>
              <th className="text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {answers.map((a) => (
              <tr key={a.answer}>
                <td className="font-mono">
                  {a.answer}
                  {a.isBogon && <span className="tag tag-bad ml-1">bogon</span>}
                </td>
                <td>{a.asn ? `AS${a.asn} ${a.org ?? ""}` : "—"}</td>
                <td className="text-right tabular-nums">{a.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="ed-table">
          <thead>
            <tr>
              <th>Failure</th>
              <th>Layer</th>
              <th className="text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["DNS", t.dns],
                ["TCP", t.tcp],
                ["TLS", t.tls],
              ] as const
            ).flatMap(([layer, rows]) =>
              rows
                .filter((g) => g.row.failure)
                .map((g, i) => (
                  <tr key={layer + i} className="row-bad">
                    <td className="font-mono">{g.row.failure}</td>
                    <td>{layer}</td>
                    <td className="text-right tabular-nums">{g.count}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
