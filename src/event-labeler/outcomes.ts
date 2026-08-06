/**
 * Colouring for observation outcomes — the `failure` strings the observations
 * aggregation returns, plus `none` for a clean observation.
 *
 * Failure strings are layer-prefixed (`tls.connection_reset`), the same first
 * segment the mechanism taxonomy uses, so colour by layer family and vary the
 * shade within it. An analyst reading the chart then sees "the TLS band grew"
 * without consulting the legend, and the layer they see is the layer they will
 * type as a mechanism.
 *
 * Unlike ../labeler/candidate.ts's `ctxColor`, assignment here is a pure
 * function of the outcome list rather than order of first appearance, so the
 * legend does not shift colours between events.
 */

export const OK = "none";
export const OTHER = "other";

const FAMILIES: Record<string, string[]> = {
  dns: ["#ffb84d", "#e09a2b", "#b87a17"],
  tcp: ["#9d84f7", "#7a63d6", "#5b47a8"],
  tls: ["#ff7359", "#d9543c", "#a83a26"],
  http: ["#6ec7de", "#4a9fb5", "#33788c"],
  ip: ["#e885bd", "#c26597", "#9c4a76"],
};
const FALLBACK = ["#8b99a9", "#6b7684", "#525c68"];

/**
 * The layer a failure belongs to. Observation failure strings carry variants
 * on the bare layer — `dns_isp.generic_timeout_error` is a DNS failure seen on
 * the ISP resolver — so fold anything that starts with a known layer into it.
 * Otherwise those land in the grey fallback and a DNS onset stops looking like
 * a DNS onset.
 */
export const layerOf = (outcome: string): string => {
  const head = outcome.split(".")[0];
  return Object.keys(FAMILIES).find((l) => head === l || head.startsWith(l + "_")) ?? head;
};

export const outcomeLabel = (outcome: string): string => (outcome === OK ? "ok" : outcome);

/** Ordered outcome list -> colour per outcome. Order decides the shade. */
export function assignOutcomeColors(outcomes: string[]): Record<string, string> {
  const used: Record<string, number> = {};
  const colors: Record<string, string> = {};
  for (const o of outcomes) {
    if (o === OK) {
      colors[o] = "#7dd195"; // --agree: the only outcome that is not a failure
      continue;
    }
    const fam = o === OTHER ? FALLBACK : (FAMILIES[layerOf(o)] ?? FALLBACK);
    const i = used[o === OTHER ? "_" : layerOf(o)] ?? 0;
    used[o === OTHER ? "_" : layerOf(o)] = i + 1;
    colors[o] = fam[Math.min(i, fam.length - 1)];
  }
  return colors;
}

/**
 * Keep the biggest failure kinds and fold the tail into `other`. A legend with
 * thirty entries is not a legend, and a two-observation failure kind is not
 * what an onset looks like.
 */
export function collapseOutcomes(
  buckets: { counts: Record<string, number> }[],
  keep: number
): string[] {
  const totals: Record<string, number> = {};
  for (const b of buckets)
    for (const [k, v] of Object.entries(b.counts)) totals[k] = (totals[k] || 0) + v;

  const failures = Object.keys(totals)
    .filter((k) => k !== OK)
    .sort((a, b) => totals[b] - totals[a]);

  const kept = failures.slice(0, keep);
  const folded = failures.slice(keep);
  if (folded.length) {
    for (const b of buckets) {
      let n = 0;
      for (const k of folded) {
        n += b.counts[k] || 0;
        delete b.counts[k];
      }
      if (n) b.counts[OTHER] = (b.counts[OTHER] || 0) + n;
    }
  }

  // ok first: it is the baseline the eye reads the rest against.
  return [...(totals[OK] ? [OK] : []), ...kept, ...(folded.length ? [OTHER] : [])];
}
