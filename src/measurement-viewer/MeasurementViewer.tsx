import { useCallback, useEffect, useState } from "react";
import {
  fetchCtrlGroundTruth,
  fetchMeasurementMeta,
  fetchObservations,
} from "./api";
import { chartWindow, ctrlWindow, groupByTarget } from "./derive";
import type { TargetGroup } from "./derive";
import HostnameSection from "./HostnameSection";
import type { MeasurementMeta } from "./types";
import "./measurement-viewer.css";

const EXAMPLE_UID = "20260816193530.814074_ES_webconnectivity_b83fb9e51ea5bfde";

interface Loaded {
  meta: MeasurementMeta;
  groups: TargetGroup[];
  observationCount: number;
}

type State =
  | { phase: "idle" }
  | { phase: "loading"; step: string }
  | { phase: "error"; message: string }
  | { phase: "loaded"; data: Loaded };

const readQuery = (key: string): string =>
  typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get(key) ?? "";

export default function MeasurementViewer() {
  const [uidInput, setUidInput] = useState("");
  const [apiBaseInput, setApiBaseInput] = useState("https://api.ooni.org");
  const [state, setState] = useState<State>({ phase: "idle" });
  const [loadedFor, setLoadedFor] = useState<{ uid: string; apiBase: string } | null>(
    null
  );

  const load = useCallback(async (uid: string, apiBase: string) => {
    const trimmed = uid.trim();
    if (!trimmed) return;
    const base = apiBase.trim();
    setLoadedFor({ uid: trimmed, apiBase: base });

    const q = new URLSearchParams(window.location.search);
    q.set("measurement_uid", trimmed);
    if (base) q.set("api_base", base);
    else q.delete("api_base");
    window.history.replaceState(null, "", "?" + q.toString());

    try {
      setState({ phase: "loading", step: "measurement metadata" });
      const meta = await fetchMeasurementMeta(base, trimmed);

      setState({ phase: "loading", step: "observations" });
      const observations = await fetchObservations(base, meta.measurement_uid);
      if (observations.length === 0) {
        throw new Error(
          "No observations found for this measurement (only web observations are indexed)"
        );
      }

      setState({ phase: "loading", step: "control ground truth" });
      const hostnames = [
        ...new Set(observations.map((o) => o.hostname).filter((h): h is string => !!h)),
      ];
      meta.test_version = observations[0].test_version;
      const win = ctrlWindow(trimmed, meta.measurement_start_time);
      const ctrl =
        hostnames.length > 0
          ? await fetchCtrlGroundTruth(base, hostnames, win.since, win.until)
          : [];

      setState({
        phase: "loaded",
        data: {
          meta,
          groups: groupByTarget(observations, ctrl),
          observationCount: observations.length,
        },
      });
    } catch (e) {
      setState({ phase: "error", message: String((e as Error).message ?? e) });
    }
  }, []);

  // Deep-linking: ?measurement_uid=…&api_base=…
  useEffect(() => {
    const uid = readQuery("measurement_uid");
    const base = readQuery("api_base");
    if (base) setApiBaseInput(base);
    if (uid) {
      setUidInput(uid);
      load(uid, base);
    }
  }, [load]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    load(uidInput, apiBaseInput);
  };

  return (
    <div className="mv-root min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">OONI Observations viewer</h1>
          <p className="text-sm text-muted mt-1">
            What the probe observed for a measurement — DNS, TCP, TLS and HTTP —
            side by side with the control ground truth.
          </p>
        </header>

        <form onSubmit={submit} className="card mb-6">
          <label className="block text-sm font-medium mb-1" htmlFor="mv-uid">
            Measurement UID
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="mv-uid"
              className="mv-input flex-1 font-mono text-sm"
              placeholder={EXAMPLE_UID}
              value={uidInput}
              onChange={(e) => setUidInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="mv-button"
              disabled={state.phase === "loading" || !uidInput.trim()}
            >
              {state.phase === "loading" ? "Loading…" : "View observations"}
            </button>
          </div>
          <details className="mt-2">
            <summary className="text-xs text-muted cursor-pointer">
              API base URL
            </summary>
            <input
              className="mv-input mt-1 w-full font-mono text-xs"
              placeholder="same origin — /api is proxied to localhost:8000 in dev"
              value={apiBaseInput}
              onChange={(e) => setApiBaseInput(e.target.value)}
              spellCheck={false}
            />
          </details>
          {state.phase === "idle" && (
            <p className="text-xs text-muted mt-2">
              Try the example:{" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setUidInput(EXAMPLE_UID);
                  load(EXAMPLE_UID, apiBaseInput);
                }}
              >
                {EXAMPLE_UID}
              </button>
            </p>
          )}
        </form>

        {state.phase === "loading" && (
          <p className="text-sm text-muted">Fetching {state.step}…</p>
        )}
        {state.phase === "error" && (
          <div className="card">
            <p className="badge-fail text-sm">✕ {state.message}</p>
          </div>
        )}

        {state.phase === "loaded" && loadedFor && (
          <ViewerBody data={state.data} apiBase={loadedFor.apiBase} />
        )}
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function ViewerBody({ data, apiBase }: { data: Loaded; apiBase: string }) {
  const { meta, groups } = data;
  const chart = chartWindow(meta.measurement_uid, meta.measurement_start_time);
  return (
    <div className="space-y-8">
      <section className="card">
        <h2 className="card-title">Measurement</h2>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
          <MetaItem label="Test" value={`${meta.test_name} · ${meta.test_version}`} />
          <MetaItem
            label="Probe"
            value={`${meta.probe_cc} · AS${meta.probe_asn}`}
          />
          <MetaItem
            label="Start time"
            value={
              <span className="tabular-nums">
                {meta.measurement_start_time.replace("T", " ").replace("Z", " UTC")}
              </span>
            }
          />
          <MetaItem
            label="Verdict"
            value={
              meta.confirmed ? (
                <span className="badge-fail">✕ confirmed blocked</span>
              ) : meta.anomaly ? (
                <span className="badge-warn">! anomaly</span>
              ) : meta.failure ? (
                <span className="text-muted">measurement failure</span>
              ) : (
                <span className="badge-ok">✓ ok</span>
              )
            }
          />
          {meta.input && (
            <div className="col-span-2 md:col-span-4">
              <dt className="text-xs uppercase tracking-wide text-muted">Input</dt>
              <dd className="text-sm font-mono break-all">{meta.input}</dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-muted mt-3">
          {data.observationCount} observation{data.observationCount === 1 ? "" : "s"}{" "}
          across {groups.length} target{groups.length === 1 ? "" : "s"} · report{" "}
          <span className="font-mono">{meta.report_id}</span>
        </p>
      </section>

      {groups.map((g) => (
        <HostnameSection
          key={g.key}
          group={g}
          meta={meta}
          apiBase={apiBase}
          chartSince={chart.since}
          chartUntil={chart.until}
        />
      ))}
    </div>
  );
}
