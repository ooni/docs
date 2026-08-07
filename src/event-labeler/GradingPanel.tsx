import { useEffect, useRef } from "react";
import MechanismPicker from "./MechanismPicker";
import { layersOf, ongoing, sizeBand } from "./derive";
import type { EventClass, Confidence, EventDraft, EventLabel, Scoreable } from "./types";

export type FlowStep = "class" | "mechanism" | "confidence" | "rationale";
const FLOW: FlowStep[] = ["class", "mechanism", "confidence", "rationale"];
const FLOW_NAMES: Record<FlowStep, string> = {
  class: "Class",
  mechanism: "Mechanisms",
  confidence: "Confidence",
  rationale: "Rationale",
};

const CLASSES: { value: EventClass; key: string; cls: string; text: string }[] = [
  { value: "true_event", key: "T", cls: "c-true", text: "True event" },
  { value: "false_positive_event", key: "F", cls: "c-false", text: "False alarm" },
  { value: "disputed", key: "D", cls: "c-disputed", text: "Disputed" },
];

const CONFS: { key: Confidence; label: string }[] = [
  { key: "certain", label: "Certain" },
  { key: "probable", label: "Probable" },
  { key: "uncertain", label: "Uncertain" },
];

const SCOREABLE: { key: Scoreable; label: string }[] = [
  { key: "yes", label: "yes" },
  { key: "no_coverage", label: "no_coverage" },
  { key: "unknown", label: "unknown" },
];

export interface GradingPanelProps {
  title: string;
  hasEvent: boolean;
  draft: EventDraft;
  resolved: EventLabel;
  set: (patch: Partial<EventDraft>) => void;

  flowStep: FlowStep;
  onGotoStep: (s: FlowStep) => void;
  mechRequiredError: boolean;

  coverageLines: string[] | null;
  coverageLoading: boolean;
  onCheckCoverage: () => void;

  onSave: () => void;
  saveMsg: { kind: "ok" | "err" | "warn"; text: string } | null;
  onNext: () => void;
  onGuideLink: (anchor: string) => void;
}

export default function GradingPanel(props: GradingPanelProps) {
  const { draft, set, resolved, flowStep, onGotoStep } = props;
  const mechInputRef = useRef<HTMLInputElement>(null);
  const whyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (flowStep === "mechanism") mechInputRef.current?.focus();
    else if (flowStep === "rationale") whyRef.current?.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [flowStep]);

  const layers = layersOf(resolved);

  return (
    <div className="judgment">
      <span className="eyebrow">Your adjudication</span>
      <h3>{props.title}</h3>
      <p className="hint">
        What did <em>this event</em> consist of? The measurements inside its window are judged
        separately, on their own evidence.
      </p>

      <ol className="flow" title="The keyboard walks you through these in order">
        {FLOW.map((step) => {
          const i = FLOW.indexOf(step);
          const at = FLOW.indexOf(flowStep);
          const cls = [step === flowStep ? "on" : "", i < at ? "done" : ""].filter(Boolean).join(" ");
          return (
            <li key={step} className={cls} onClick={() => onGotoStep(step)}>
              {FLOW_NAMES[step]}
            </li>
          );
        })}
      </ol>

      <div className="choices">
        {CLASSES.map((c) => (
          <button
            key={c.value}
            className={"choice " + c.cls}
            aria-pressed={draft.event_class === c.value}
            onClick={() => set({ event_class: c.value })}
          >
            <kbd>{c.key}</kbd> {c.text}
          </button>
        ))}
      </div>
      {draft.event_class === "false_positive_event" && (
        <div className="stat" style={{ margin: "-8px 0 12px" }}>
          An adjudicated false alarm is first-class: gold negatives for the measurement corpus, and a
          must-not-fire regression test. The harness inverts the pass condition for this row.
        </div>
      )}

      <label className="field">
        <span className="eyebrow">
          Mechanisms
          <a
            href="#g-mechanism"
            className="guide-link"
            style={{ float: "right", fontSize: 11, color: "var(--dim)", textTransform: "none", letterSpacing: 0 }}
            onClick={(e) => {
              e.preventDefault();
              props.onGuideLink("#g-mechanism");
            }}
          >
            taxonomy
          </a>
        </span>
        <MechanismPicker
          mechs={draft.mechanisms}
          onChange={(mechanisms) => set({ mechanisms })}
          requiredError={props.mechRequiredError}
          inputRef={mechInputRef}
          onDone={() => onGotoStep("confidence")}
          onEscape={() => onGotoStep("class")}
        />
      </label>

      <span className="eyebrow">Confidence</span>
      <div className="seg-group">
        {CONFS.map((c) => (
          <button
            key={c.key}
            className="btn"
            aria-pressed={draft.confidence === c.key}
            onClick={() => set({ confidence: c.key })}
          >
            {c.label}
          </button>
        ))}
      </div>

      <span className="eyebrow">
        Scoreable
        <a
          href="#g-scoreable"
          className="guide-link"
          style={{ float: "right", fontSize: 11, color: "var(--dim)", textTransform: "none", letterSpacing: 0 }}
          onClick={(e) => {
            e.preventDefault();
            props.onGuideLink("#g-scoreable");
          }}
        >
          why
        </a>
      </span>
      <div className="seg-group">
        {SCOREABLE.map((s) => (
          <button
            key={s.key}
            className="btn"
            aria-pressed={draft.scoreable === s.key}
            onClick={() => set({ scoreable: s.key })}
          >
            {s.label}
          </button>
        ))}
      </div>
      <button
        className="btn"
        style={{ width: "100%", marginBottom: 10 }}
        disabled={props.coverageLoading}
        onClick={props.onCheckCoverage}
      >
        {props.coverageLoading ? "Querying…" : "Check coverage"} <kbd style={{ opacity: 0.7 }}>C</kbd>
      </button>
      {props.coverageLines && <div className="cov">{props.coverageLines.join("\n")}</div>}

      <label className="field">
        <span className="eyebrow">Rationale</span>
        <textarea
          rows={4}
          ref={whyRef}
          placeholder="Name the evidence. 'Operator confirmed the order; OONI DNS answers in AS3352 turn to a single bogon within the bracket.'"
          value={draft.rationale}
          onChange={(e) => set({ rationale: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              (e.target as HTMLTextAreaElement).blur();
              onGotoStep("confidence");
              e.preventDefault();
            }
          }}
        />
      </label>

      <button
        className="btn btn-primary"
        style={{ width: "100%" }}
        disabled={!props.hasEvent}
        onClick={props.onSave}
      >
        Save event <kbd style={{ opacity: 0.7 }}>⌘⏎</kbd>
      </button>
      {props.saveMsg && (
        <div className={"save-msg " + props.saveMsg.kind} role="status">
          {props.saveMsg.text}
        </div>
      )}
      <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={props.onNext}>
        Next incomplete <kbd style={{ opacity: 0.7 }}>N</kbd>
      </button>

      <div className="derived-box">
        <span className="eyebrow">Derived, never stored</span>
        <dl>
          <dt>ongoing</dt>
          <dd>{String(ongoing(resolved))}</dd>
          <dt>layers</dt>
          <dd>{layers.length ? layers.join(", ") : "—"}</dd>
          <dt>size_band</dt>
          <dd>{sizeBand(resolved)}</dd>
        </dl>
        <p className="hint">
          These are recomputed from the fields above every time they are read, so the corpus cannot
          carry a size_band that contradicts its own scope.
        </p>
      </div>
    </div>
  );
}
