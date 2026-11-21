// Defaults for the event dashboard. Every value here can be overridden from
// the page query string (see readConfig) so a deployment or a shared link can
// point at a different backend without a rebuild.

// Public OONI API. The /api/_/ listings serve CORS for any origin, but the
// measurement endpoints (aggregation, observations) only for *.ooni.org, so
// in dev the astro server proxies /ooni-api to it (see astro.config.mjs).
export const DEFAULT_OONI_API = import.meta.env.DEV
  ? "/ooni-api"
  : "https://api.ooni.org";

// Changepoint API (data/changepoint-api). It sends no CORS headers, so in dev
// the astro server proxies /changepoint-api to it (see astro.config.mjs).
export const DEFAULT_CHANGEPOINT_API = "/changepoint-api";

// How far back from the picked date the detection window reaches
export const WINDOW_DAYS = 21;

// Upper bound on how many networks can be stacked in the timeline at once
export const DEFAULT_MAX_ASNS = 8;

export interface DashboardConfig {
  ooniApi: string;
  changepointApi: string;
  maxAsns: number;
}

export function readConfig(q: URLSearchParams): DashboardConfig {
  const max = Number(q.get("max_asns"));
  return {
    ooniApi: q.get("ooni_api") || DEFAULT_OONI_API,
    changepointApi: q.get("changepoint_api") || DEFAULT_CHANGEPOINT_API,
    maxAsns: Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_ASNS,
  };
}
