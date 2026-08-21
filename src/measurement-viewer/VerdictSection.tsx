import type { MeasurementAnalysis, MeasurementMeta } from "./types";

// A layer counts as blocked when its blocked score carries the majority of the
// weight. The three scores per layer sum to ~1, so 0.5 is the decision point.
const BLOCKED_THRESHOLD = 0.5;

interface Layer {
  key: string;
  label: string;
  blocked: number;
  down: number;
  ok: number;
  failure: string | null;
  ruleId: string | null;
}

function layers(a: MeasurementAnalysis): Layer[] {
  return [
    {
      key: "dns",
      label: "DNS",
      blocked: a.dns_blocked,
      down: a.dns_down,
      ok: a.dns_ok,
      failure: a.top_dns_failure,
      ruleId: a.top_dns_rule_id,
    },
    {
      key: "tcp",
      label: "TCP",
      blocked: a.tcp_blocked,
      down: a.tcp_down,
      ok: a.tcp_ok,
      failure: a.top_tcp_failure,
      ruleId: a.top_tcp_rule_id,
    },
    {
      key: "tls",
      label: "TLS",
      blocked: a.tls_blocked,
      down: a.tls_down,
      ok: a.tls_ok,
      failure: a.top_tls_failure,
      ruleId: a.top_tls_rule_id,
    },
  ];
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

const dash = <span className="text-muted">—</span>;

// The fastpath flags shipped with the measurement itself, kept next to the
// analysis call so a disagreement between the two is visible.
function FastpathVerdict({ meta }: { meta: MeasurementMeta }) {
  if (meta.confirmed) return <span className="badge-fail">✕ confirmed blocked</span>;
  if (meta.anomaly) return <span className="badge-warn">! anomaly</span>;
  if (meta.failure) return <span className="text-muted">measurement failure</span>;
  return <span className="badge-ok">✓ ok</span>;
}

function AnalysisVerdict({ analysis }: { analysis: MeasurementAnalysis }) {
  const blocked = layers(analysis).filter((l) => l.blocked > BLOCKED_THRESHOLD);
  if (blocked.length === 0) return <span className="badge-ok">✓ ok</span>;
  return (
    <span className="badge-fail">
      ✕ blocked{" "}
      <span className="text-muted font-normal">
        · {blocked.map((l) => l.label).join(", ")}
      </span>
    </span>
  );
}

function AnalysisDetail({ analysis }: { analysis: MeasurementAnalysis }) {
  return (
    <table className="data-table mt-3">
      <thead>
        <tr>
          <th>Layer</th>
          <th className="text-right">Blocked</th>
          <th className="text-right">Down</th>
          <th className="text-right">Ok</th>
          <th>Failure</th>
          <th>Rule</th>
        </tr>
      </thead>
      <tbody>
        {layers(analysis).map((l) => (
          <tr key={l.key}>
            <td className="text-sm font-medium">{l.label}</td>
            <td
              className={`text-xs text-right tabular-nums ${
                l.blocked > BLOCKED_THRESHOLD ? "badge-fail" : "text-muted"
              }`}
            >
              {pct(l.blocked)}
            </td>
            <td className="text-xs text-right tabular-nums text-muted">
              {pct(l.down)}
            </td>
            <td className="text-xs text-right tabular-nums text-muted">
              {pct(l.ok)}
            </td>
            <td className="text-xs font-mono">
              {l.failure ? (
                <span className="badge-fail">✕ {l.failure}</span>
              ) : (
                dash
              )}
            </td>
            <td className="text-xs font-mono text-secondary">
              {l.ruleId ?? dash}
            </td>
          </tr>
        ))}
        <tr>
          <td className="text-sm font-medium">Probe</td>
          <td colSpan={5} className="text-xs font-mono">
            {analysis.top_probe_analysis ?? dash}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// The measurement verdict: the analysis engine's blocked/ok call with the
// fastpath verdict directly underneath, expandable into the per-layer scores
// that produced the analysis call. When /v1/analysis has nothing yet only
// fastpath is shown.
export default function VerdictSection({
  meta,
  analysis,
}: {
  meta: MeasurementMeta;
  analysis: MeasurementAnalysis | null;
}) {
  return (
    <div className="verdict-section">
      <table className="data-table">
        <tbody>
          <tr>
            <th scope="row" className="w-24">
              Analysis
            </th>
            <td className="text-sm">
              {analysis ? (
                <AnalysisVerdict analysis={analysis} />
              ) : (
                <span className="text-muted">not computed yet</span>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row" className="w-24">
              Fastpath
            </th>
            <td className="text-sm">
              <FastpathVerdict meta={meta} />
            </td>
          </tr>
        </tbody>
      </table>

      {analysis && (
        <details className="mt-2">
          <summary className="text-xs text-muted cursor-pointer">
            Analysis detail
          </summary>
          <AnalysisDetail analysis={analysis} />
        </details>
      )}
    </div>
  );
}
