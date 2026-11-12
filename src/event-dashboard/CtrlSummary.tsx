import { CtrlResolutionBlock } from "../measurement-viewer/HostnameSection";
import type { CtrlBlockProps } from "../measurement-viewer/HostnameSection";
import type { CtrlGroundTruthEntry } from "../measurement-viewer/types";

type Family = "v4" | "v6";
const familyOf = (ip: string): Family => (ip.includes(":") ? "v6" : "v4");

interface Cell {
  ok: number; // addresses that worked at least once at this layer
  tested: number; // addresses the control tried at this layer
}

interface Summary {
  dns: Record<Family, number>; // addresses in the control's DNS answers
  tcp: Record<Family, Cell>;
  tls: Record<Family, Cell>;
}

// The control lists one row per ip:port; an address counts once, and is
// reachable at a layer when any of its rows succeeded there
function summarize(entries: CtrlGroundTruthEntry[]): Summary {
  const byIp = new Map<string, CtrlGroundTruthEntry[]>();
  for (const e of entries) byIp.set(e.ip, [...(byIp.get(e.ip) ?? []), e]);
  const cell = (): Record<Family, Cell> => ({ v4: { ok: 0, tested: 0 }, v6: { ok: 0, tested: 0 } });
  const s: Summary = { dns: { v4: 0, v6: 0 }, tcp: cell(), tls: cell() };
  for (const [ip, rows] of byIp) {
    const f = familyOf(ip);
    if (rows.some((r) => r.in_dns_answers)) s.dns[f]++;
    const tcpOk = rows.reduce((n, r) => n + r.tcp_success_count, 0);
    const tcpAll = tcpOk + rows.reduce((n, r) => n + r.tcp_failure_count, 0);
    if (tcpAll > 0) {
      s.tcp[f].tested++;
      if (tcpOk > 0) s.tcp[f].ok++;
    }
    const tlsOk = rows.reduce((n, r) => n + r.tls_success_count, 0);
    const tlsAll = tlsOk + rows.reduce((n, r) => n + r.tls_failure_count, 0);
    if (tlsAll > 0) {
      s.tls[f].tested++;
      if (tlsOk > 0) s.tls[f].ok++;
    }
  }
  return s;
}

function Reach({ c }: { c: Cell }) {
  if (c.tested === 0) return <span className="text-muted">—</span>;
  const cls = c.ok === 0 ? "badge-fail" : c.ok < c.tested ? "badge-warn" : "badge-ok";
  return (
    <span className={`${cls} tabular-nums`}>
      {c.ok}/{c.tested}
    </span>
  );
}

// Compact stand-in for the measurement viewer's control resolution block:
// how many IPv4 / IPv6 addresses the control resolved and could reach at each
// layer, with the full address list folded underneath
export default function CtrlSummary(p: CtrlBlockProps) {
  const s = summarize(p.ctrlEntries);
  const answerIPs = new Set(p.ctrlEntries.filter((c) => c.in_dns_answers).map((c) => c.ip));
  const common = [...p.probeIPs].filter((ip) => answerIPs.has(ip)).length;
  return (
    <div>
      {p.showHostname && <div className="text-xs font-mono text-secondary mb-1">{p.hostname}</div>}
      <table className="ctrl-sum">
        <thead>
          <tr>
            <th />
            <th>IPv4</th>
            <th>IPv6</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>DNS</th>
            <td className="tabular-nums">{s.dns.v4} resolved</td>
            <td className="tabular-nums">{s.dns.v6} resolved</td>
          </tr>
          <tr>
            <th>TCP</th>
            <td>
              <Reach c={s.tcp.v4} /> <span className="text-muted">reachable</span>
            </td>
            <td>
              <Reach c={s.tcp.v6} /> <span className="text-muted">reachable</span>
            </td>
          </tr>
          <tr>
            <th>TLS</th>
            <td>
              <Reach c={s.tls.v4} /> <span className="text-muted">reachable</span>
            </td>
            <td>
              <Reach c={s.tls.v6} /> <span className="text-muted">reachable</span>
            </td>
          </tr>
        </tbody>
      </table>
      {p.probeIPs.size > 0 && (
        <p className={`text-xs mt-2 ${common > 0 ? "badge-ok" : "badge-warn"}`}>
          {common > 0 ? "✓" : "!"} {common} of {p.probeIPs.size} probe answer
          {p.probeIPs.size === 1 ? "" : "s"} also in control DNS
        </p>
      )}
      <details className="mt-2">
        <summary className="text-xs cursor-pointer font-bold">
          {answerIPs.size} control address{answerIPs.size === 1 ? "" : "es"}
        </summary>
        <div className="mt-2">
          <CtrlResolutionBlock {...p} showHostname={false} />
        </div>
      </details>
    </div>
  );
}
