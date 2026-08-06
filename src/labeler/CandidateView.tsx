import {
  computeContextView,
  computeControlOnlyEndpoints,
  computeDnsGroupInputs,
  computeDnsGroupView,
  computeEndpointPanels,
  NOT_RECORDED,
  type CtrlCell,
  type DnsGroupView,
  type LayerFieldRow,
} from "./candidate";
import type { Candidate, ContextResponse, QueueRow } from "./types";

export interface CandidateViewProps {
  row: QueueRow;
  candidate: Candidate;
  context: ContextResponse | null;
}

function ctrlCellText(c: CtrlCell): string {
  if (c === undefined) return "no control";
  if (c === NOT_RECORDED) return "not recorded";
  if (c === null) return "—";
  return c;
}

function LayerTable({ rows, hasCtrl }: { rows: LayerFieldRow[]; hasCtrl: boolean }) {
  return (
    <table className="diff">
      <thead>
        <tr>
          <th></th>
          <th className="p">Probe saw</th>
          <th className="c">Control saw</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ field, probe, ctrl }) => {
          const comparable = hasCtrl && ctrl !== undefined && ctrl !== NOT_RECORDED;
          const differs = comparable && (probe || "") !== (ctrl || "");
          const probeOk = field.endsWith("failure") && probe === "none";
          const ctrlOk = field.endsWith("failure") && ctrl === "none";
          return (
            <tr key={field} className={differs ? "differs" : ""}>
              <td className="k">{field.replace(/^(dns|tcp|tls|http)_/, "")}</td>
              <td className={"v probe" + (probe === null ? " nil" : "") + (probeOk ? " ok" : "")}>
                {probe === null ? "—" : probe}
              </td>
              <td
                className={
                  "v control" + (ctrl === null || ctrl === undefined || ctrl === NOT_RECORDED ? " nil" : "") + (ctrlOk ? " ok" : "")
                }
                title={ctrl === NOT_RECORDED ? "The control never collects this field; absence is not disagreement." : undefined}
              >
                {ctrlCellText(ctrl)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DnsGroup({ view }: { view: DnsGroupView }) {
  const verdictless = (hits: number, total: number, haveCtrl: boolean) => {
    if (!haveCtrl) return <b className="na">no control</b>;
    if (!total) return <b className="na">none</b>;
    return hits ? <b className="yes">{hits} of {total}</b> : <b className="no">0 of {total}</b>;
  };

  return (
    <div className="layer">
      <header>
        <span className="eyebrow">DNS{view.resolverTag ? " · " + view.resolverTag : ""}</span>
        <span className="eyebrow">{view.hostname}</span>
      </header>
      <div className="overlap">
        <span>
          answers <b>{view.pAddrsCount}</b> probe / <b>{view.cAddrsCount}</b> control
        </span>
        <span>IP overlap {verdictless(view.ipOverlap.hits, view.ipOverlap.total, view.haveCtrl)}</span>
        <span>ASN overlap {verdictless(view.asnOverlap.hits, view.asnOverlap.total, view.haveCtrl)}</span>
        <span>org overlap {verdictless(view.orgOverlap.hits, view.orgOverlap.total, view.haveCtrl)}</span>
      </div>
      {(view.engine || view.engineAddr || view.queryTypes.length > 0) && (
        <div className="overlap">
          {view.engine && (
            <span>
              engine <b>{view.engine}</b>
            </span>
          )}
          {view.engineAddr && (
            <span>
              resolver <b>{view.engineAddr}</b>
            </span>
          )}
          {view.queryTypes.length > 0 && (
            <span>
              queries <b>{view.queryTypes.join(", ")}</b>
            </span>
          )}
        </div>
      )}
      {(view.pFail || view.cFail) && (
        <div className="dns-fail">
          <span className="p">probe: {view.pFail || "resolved"}</span>
          &nbsp;·&nbsp;
          <span className="c">control: {view.haveCtrl ? view.cFail || "resolved" : "no control"}</span>
        </div>
      )}
      {view.noAnswersEitherSide ? (
        <div className="no-ctrl">No answers recorded on either side.</div>
      ) : (
        <>
          <table className="answers">
            <thead>
              <tr>
                <th>Seen by</th>
                <th>Address</th>
                <th>ASN</th>
                <th>Organisation</th>
                <th>Geo</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((a) => (
                <tr key={a.addr} className={a.kind === "probe-only" && view.haveCtrl ? "probe-only" : ""}>
                  <td>
                    <span className={"pill " + a.kind}>
                      {a.kind === "both" ? "both" : a.kind === "probe-only" ? "probe" : "control"}
                    </span>
                  </td>
                  <td className="ans">
                    {a.addr}
                    {a.bogon && <span className="flag">bogon</span>}
                    {a.type && <span className="flag">{a.type}</span>}
                  </td>
                  <td className="dim">{a.asn != null ? "AS" + a.asn : "—"}</td>
                  <td className="dim">{a.org || "—"}</td>
                  <td className="dim">{a.cc || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!view.haveCtrl && (
            <div className="no-ctrl">
              {view.controlCheckedCount
                ? `No control DNS answers for this hostname. The control did check ${view.controlCheckedCount} ` +
                  `address${view.controlCheckedCount > 1 ? "es" : ""} over TCP/TLS, but those are the probe's own ` +
                  `answers being probed, not an independent resolution — nothing to compare the set against.`
                : "No control answers for this hostname — nothing to compare the set against."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ContextStrip({ context }: { context: ContextResponse }) {
  const view = computeContextView(context);
  return (
    <div className="layer">
      <header>
        <span className="eyebrow">Same host, same network, ±{context.window_hours}h</span>
      </header>
      <div className="ctx" style={{ padding: 10 }}>
        {view.bars.map((bar) => (
          <div key={bar.ts} className="bar" title={bar.title}>
            {bar.segments.map((seg, i) => (
              <div key={i} className="seg" style={{ height: seg.heightPx + "px", background: seg.color }} />
            ))}
          </div>
        ))}
      </div>
      <div className="ctx-legend" style={{ padding: "0 10px 10px" }}>
        {view.legend.map((l) => (
          <span key={l.key}>
            <i style={{ background: l.color }} />
            {l.key}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function CandidateView({ row, candidate, context }: CandidateViewProps) {
  const obs = candidate.observations;
  const ctrls = candidate.controls || [];

  const dnsGroups = computeDnsGroupInputs(obs, ctrls).map(computeDnsGroupView);
  const endpointPanels = computeEndpointPanels(obs, ctrls);
  const controlOnly = computeControlOnlyEndpoints(obs, ctrls);

  return (
    <>
      <div className="subject">
        <span className="eyebrow">
          {row.test_name} · {row.measurement_uid}
        </span>
        <h2>{obs[0]?.hostname || row.domain || row.input || "—"}</h2>
        <div className="meta">
          <span>
            probe <b>{row.probe_cc} AS{row.probe_asn}</b>
          </span>
          <span>
            resolver <b>AS{row.resolver_asn || "?"}</b>
            {row.resolver_asn && row.resolver_asn === row.probe_asn ? " (ISP)" : ""}
          </span>
          <span>
            at <b>{String(row.measurement_start_time).replace("T", " ").slice(0, 19)}</b>
          </span>
          <span>
            observations <b>{obs.length}</b>
          </span>
          <span>
            control rows <b>{ctrls.length}</b>
          </span>
        </div>
      </div>

      {context && context.series.length > 0 && <ContextStrip context={context} />}

      {dnsGroups.map((view, i) => (
        <DnsGroup key={view.hostname + "|" + (view.resolverTag || "") + "|" + i} view={view} />
      ))}

      {endpointPanels.map((panel) => (
        <div key={panel.key}>
          {panel.layers.map((layer) => (
            <div className="layer" key={panel.key + layer.name}>
              <header>
                <span className="eyebrow">{layer.name}</span>
                {panel.tag && <span className="eyebrow">{panel.tag}</span>}
              </header>
              <LayerTable rows={layer.rows} hasCtrl={panel.hasCtrl} />
              {!panel.hasCtrl && (
                <div className="no-ctrl">
                  The control never tried this address, so there is nothing to compare against here.
                  That is itself worth noting: it usually means DNS sent the probe somewhere the control
                  never went.
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {controlOnly.length > 0 && (
        <div className="layer">
          <header>
            <span className="eyebrow">Control reached, probe never tried</span>
            <span className="eyebrow">
              {controlOnly.length} address{controlOnly.length === 1 ? "" : "es"}
            </span>
          </header>
          <table className="answers">
            <thead>
              <tr>
                <th>Address</th>
                <th>TCP</th>
                <th>TLS</th>
                <th>HTTP</th>
                <th>Organisation</th>
              </tr>
            </thead>
            <tbody>
              {controlOnly.map((c, i) => (
                <tr key={endpointRowKey(c, i)}>
                  <td className="ans">
                    {c.ip}
                    {c.port ? ":" + c.port : ""}
                    {c._n > 1 && <span className="flag">×{c._n}</span>}
                  </td>
                  <td className="dim">{(c.tcp_failure as string) || (c.tcp_success ? "ok" : "—")}</td>
                  <td className="dim">{(c.tls_failure as string) || (c.tls_success ? "ok" : "—")}</td>
                  <td className="dim">
                    {(c.http_failure as string) || (c.http_response_status_code ? String(c.http_response_status_code) : "—")}
                  </td>
                  <td className="dim">{(c.ip_as_org_name as string) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!ctrls.length && (
        <div className="banner">
          No control rows for this measurement. Without a control you are guessing at whether the
          failure is interference — X (unusable) is often the honest call.
        </div>
      )}
    </>
  );
}

function endpointRowKey(c: { ip?: string | null; port?: number | null }, i: number): string {
  return `${c.ip || ""}:${c.port ?? ""}|${i}`;
}
