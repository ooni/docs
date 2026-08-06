import { useEffect, useRef } from "react";
import type { Confidence, IntervalReveal, IntervalRow, IntervalVerdict } from "./types";
import type { Overlap } from "./overlap";

export interface Draft {
  verdict: IntervalVerdict | null;
  confidence: Confidence;
}

export interface VerdictPanelProps {
  row: IntervalRow | null;
  draft: Draft;
  why: string;
  onWhyChange: (v: string) => void;
  whyRequiredError: boolean;
  onSetVerdict: (v: IntervalVerdict) => void;
  onSetConfidence: (c: Confidence) => void;
  onCommit: () => void;
  commitDisabled: boolean;
  overlaps: Overlap[];
  sealed: boolean;
  reveal: IntervalReveal | null;
  revealLoading: boolean;
  revealError: string | null;
  committedVerdict: IntervalVerdict | null;
  onNextUnlabelled: () => void;
  onGuideLink: (anchor: string) => void;
}

const CHOICES: { v: IntervalVerdict; key: string; cls: string; text: string; hint: string }[] = [
  {
    v: "quiet_observed",
    key: "Q",
    cls: "c-quiet",
    text: "Quiet (observed)",
    hint: "no interference visible in OONI's data for this cell, this week",
  },
  {
    v: "blocked_throughout",
    key: "B",
    cls: "c-blocked-throughout",
    text: "Blocked throughout",
    hint: "interference all week, but no transition inside it — the detector should stay silent",
  },
  {
    v: "event_present",
    key: "E",
    cls: "c-event",
    text: "Event present",
    hint: "the state changed inside this window: an onset, or a recovery",
  },
  {
    v: "uncertain",
    key: "U",
    cls: "c-un",
    text: "Can't call it",
    hint: "counted, not skipped — see the guide",
  },
  {
    v: "unusable",
    key: "X",
    cls: "c-unusable",
    text: "Unusable window",
    hint: "the data itself is broken, not the network",
  },
];

const CONFS: { key: Confidence; label: string }[] = [
  { key: "certain", label: "Certain" },
  { key: "probable", label: "Probable" },
  { key: "uncertain", label: "Uncertain" },
];

export default function VerdictPanel(props: VerdictPanelProps) {
  const whyRef = useRef<HTMLTextAreaElement>(null);
  const { row, draft } = props;

  // Picking a verdict moves you to the rationale, which is the only field left
  // to fill: this grain has no mechanism step, so the whole flow is two keys
  // and a sentence.
  useEffect(() => {
    if (draft.verdict && props.sealed) whyRef.current?.focus();
  }, [draft.verdict, props.sealed]);

  return (
    <div className="judgment">
      <span className="eyebrow">Your judgment</span>
      <h3>{row ? `${row.domain} · AS${row.probe_asn}` : "Nothing loaded"}</h3>
      <p className="hint">
        Did the state <em>change</em> inside this week? Not whether the cell is blocked — a week
        inside an ongoing block has no transition in it — and not whether the detector was right.
      </p>

      <div className="choices">
        {CHOICES.map((c) => (
          <button
            key={c.v}
            className={"choice " + c.cls}
            aria-pressed={draft.verdict === c.v}
            onClick={() => props.onSetVerdict(c.v)}
            title={c.hint}
            type="button"
          >
            <kbd>{c.key}</kbd> {c.text}
          </button>
        ))}
      </div>

      {draft.verdict === "quiet_observed" && props.overlaps.length > 0 && (
        <div className="stat" style={{ color: "var(--diverge)", margin: "-6px 0 12px" }}>
          A known event overlaps this window. Calling it quiet charges the detector for being
          right — say in the rationale why the corpus entry does not apply here, or use{" "}
          <b>blocked throughout</b> if it covers the week without changing inside it.
        </div>
      )}
      {draft.verdict === "event_present" &&
        props.overlaps.length > 0 &&
        props.overlaps.every((o) => o.coversWholeWindow) && (
          <div className="stat" style={{ color: "var(--probe)", margin: "-6px 0 12px" }}>
            Every overlapping event covers this week without starting or ending inside it, so
            there is no transition here for a detector to catch. Unless you can see one in the
            chart, this is <b>blocked throughout</b> — scoring it as an event credits a detection
            nobody earned.
          </div>
        )}

      <span className="eyebrow">Confidence</span>
      <div className="seg-group">
        {CONFS.map((c) => (
          <button
            key={c.key}
            className="btn"
            aria-pressed={draft.confidence === c.key}
            onClick={() => props.onSetConfidence(c.key)}
            type="button"
          >
            {c.label}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="eyebrow">Rationale</span>
        <textarea
          rows={4}
          ref={whyRef}
          placeholder={
            props.whyRequiredError
              ? "Required — name what you looked at."
              : "'Failure mix flat at ~2% dns.nxdomain across the fortnight, no step at any point in the week.'"
          }
          value={props.why}
          onChange={(e) => props.onWhyChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              props.onCommit();
              e.preventDefault();
            } else if (e.key === "Escape") {
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
      </label>

      <button
        className="btn btn-primary"
        style={{ width: "100%" }}
        disabled={props.commitDisabled}
        onClick={props.onCommit}
        type="button"
      >
        Commit &amp; reveal <kbd style={{ opacity: 0.7 }}>⏎</kbd>
      </button>

      {props.sealed ? (
        <div className="sealed-box">
          <span className="eyebrow">Sealed until you commit</span>
          Whether the detector alerted in this window, where its changepoints landed, and the
          scores it read are all hidden. This matters more here than in the measurement queue:
          one of the strata <em>is</em> the detector's output, so an unblinded alert does not
          just anchor you, it hands you the answer.{" "}
          <a
            href="#g-blinding"
            className="guide-link"
            style={{ color: "var(--sealed)" }}
            onClick={(e) => {
              e.preventDefault();
              props.onGuideLink("#g-blinding");
            }}
          >
            Why
          </a>
        </div>
      ) : (
        <RevealBox
          loading={props.revealLoading}
          error={props.revealError}
          data={props.reveal}
          row={row}
          verdict={props.committedVerdict}
          onNextUnlabelled={props.onNextUnlabelled}
        />
      )}
    </div>
  );
}

function RevealBox({
  loading,
  error,
  data,
  row,
  verdict,
  onNextUnlabelled,
}: {
  loading: boolean;
  error: string | null;
  data: IntervalReveal | null;
  row: IntervalRow | null;
  verdict: IntervalVerdict | null;
  onNextUnlabelled: () => void;
}) {
  if (loading || error || !data) {
    return (
      <div className="reveal-box">
        <span className="eyebrow">What the detector did</span>
        <p className="hint">{loading ? "Loading…" : error ? `Could not load: ${error}` : ""}</p>
        {!loading && (
          <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={onNextUnlabelled}>
            Next unlabelled (N)
          </button>
        )}
      </div>
    );
  }

  const alerted = data.alerts_in_window > 0;
  // The two cells of the confusion matrix this corpus exists to fill. Neither
  // is a verdict on the analyst: the interesting rows are the disagreements,
  // and a false alarm is only a false alarm because someone looked.
  const flag =
    verdict === "quiet_observed" && alerted
      ? { cls: "diff", text: "Alerted in a window you called quiet — a false alarm, on the record" }
      : verdict === "blocked_throughout" && alerted
        ? {
            cls: "diff",
            text:
              "Alerted inside an ongoing block — a false alarm too: the onset was before this " +
              "window, so there was nothing here to catch",
          }
        : verdict === "event_present" && !alerted
          ? { cls: "diff", text: "Did not alert in a window you called an event — a miss" }
          : verdict === "quiet_observed"
            ? { cls: "same", text: "Quiet, and the detector agreed" }
            : verdict === "blocked_throughout"
              ? { cls: "same", text: "Blocked throughout, and the detector stayed silent" }
              : verdict === "event_present"
                ? { cls: "same", text: "Event, and the detector fired" }
                : null;

  return (
    <div className="reveal-box">
      <span className="eyebrow">What the detector did</span>
      {flag && (
        <div className={"agree-flag " + flag.cls} style={{ marginTop: 8 }}>
          {flag.text}
        </div>
      )}
      <dl>
        <dt>alerts inside the week</dt>
        <dd>{data.alerts_in_window}</dd>
        <dt>changepoints in the padded window</dt>
        <dd>
          {data.changepoints.length === 0
            ? "none"
            : data.changepoints
                .map(
                  (c) =>
                    `${c.ts.slice(0, 16).replace("T", " ")} ${c.block_type} ` +
                    `${c.change_dir > 0 ? "→blk" : "→ok"}${c.in_window ? " *" : ""}`
                )
                .join("\n")}
        </dd>
        {row && (
          <>
            <dt>stratum this row was drawn from</dt>
            <dd>
              {String(row.sampling_stratum)} · weight {Number(row.sampling_weight).toFixed(1)} ·{" "}
              1 of {Number(row.sample_rows)} from {Number(row.sample_population).toLocaleString()}
            </dd>
          </>
        )}
      </dl>
      <p className="hint">
        {data.caveat ||
          "The deployed detector is online; this is the log it emitted, not a replay."}{" "}
        Changed your mind? Re-label and commit again; the old row is superseded, not erased.
      </p>
      <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={onNextUnlabelled}>
        Next unlabelled (N)
      </button>
    </div>
  );
}
