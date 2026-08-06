import { useEffect, useRef, useState } from "react";
import { filterMechanisms, isInternalMechanism, MECH_BY_PATH } from "./mechanisms";
import type { Confidence, RevealResponse, Verdict } from "./types";

export type FlowStep = "verdict" | "mechanism" | "confidence" | "rationale";
const FLOW: FlowStep[] = ["verdict", "mechanism", "confidence", "rationale"];

export interface Draft {
  label: Verdict | null;
  confidence: Confidence;
  mechs: string[];
}

export interface JudgmentPanelProps {
  rowTitle: string;
  hasRow: boolean;
  draft: Draft;
  flowStep: FlowStep;
  why: string;
  onWhyChange: (v: string) => void;
  whyRequiredError: boolean;
  onSetLabel: (label: Verdict) => void;
  onSetConfidence: (c: Confidence) => void;
  onAddMech: (path: string) => void;
  onRemoveMech: (path: string) => void;
  onGotoStep: (step: FlowStep) => void;
  onCommit: () => void;
  commitDisabled: boolean;
  mechRequiredError: boolean;
  sealed: boolean;
  revealData: RevealResponse | null;
  revealLoading: boolean;
  revealError: string | null;
  revealForLabel: Verdict | null;
  onNextUnlabelled: () => void;
  onGuideLink: (anchor: string) => void;
}

const CHOICES: { label: Verdict; key: string; cls: string; text: string }[] = [
  { label: "blocked", key: "B", cls: "c-blocked", text: "Blocked" },
  { label: "down", key: "D", cls: "c-down", text: "Down" },
  { label: "ok", key: "O", cls: "c-ok", text: "OK" },
  { label: "unadjudicated", key: "U", cls: "c-un", text: "Can't call it" },
  { label: "unusable", key: "X", cls: "c-unusable", text: "Unusable row" },
];

const CONFS: { key: Confidence; label: string }[] = [
  { key: "certain", label: "Certain" },
  { key: "probable", label: "Probable" },
  { key: "uncertain", label: "Uncertain" },
];

function standingMechNote(mechs: string[]): string {
  const fams = new Set(mechs.map((m) => m.split(".")[0]));
  const warned = mechs.map((m) => MECH_BY_PATH.get(m)).filter((m): m is NonNullable<typeof m> => !!m?.warn);
  let html = "";
  if (mechs.length > fams.size) {
    html +=
      "two mechanisms in one layer: legitimate when the evidence genuinely shows both " +
      "(an injected A next to an NXDOMAIN AAAA, say), but the rationale must name which evidence supports which.";
  }
  if (warned.length) {
    html +=
      (html ? "<br>" : "") +
      warned
        .map(
          (m) =>
            `<span style="color:var(--probe)">${m.p}: ${m.warn} — pick this only if you have evidence outside this view</span>`
        )
        .join("<br>");
  }
  return html;
}

export default function JudgmentPanel(props: JudgmentPanelProps) {
  const {
    rowTitle,
    hasRow,
    draft,
    flowStep,
    why,
    onWhyChange,
    whyRequiredError,
    onSetLabel,
    onSetConfidence,
    onAddMech,
    onRemoveMech,
    onGotoStep,
    onCommit,
    commitDisabled,
    mechRequiredError,
    sealed,
    revealData,
    revealLoading,
    revealError,
    revealForLabel,
    onNextUnlabelled,
    onGuideLink,
  } = props;

  const mechInputRef = useRef<HTMLInputElement>(null);
  const whyRef = useRef<HTMLTextAreaElement>(null);

  const [mechInputValue, setMechInputValue] = useState("");
  const [mechHl, setMechHl] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mechNoteOverride, setMechNoteOverride] = useState<string | null>(null);

  useEffect(() => {
    setMechNoteOverride(null);
  }, [draft.mechs]);

  useEffect(() => {
    if (flowStep === "mechanism") mechInputRef.current?.focus();
    else if (flowStep === "rationale") whyRef.current?.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [flowStep]);

  const mechMatches = filterMechanisms(mechInputValue, draft.mechs).slice(0, 14);

  const pick = (i: number) => {
    const m = mechMatches[i];
    if (!m) return;
    const deeper = draft.mechs.find((x) => x.startsWith(m.p + "."));
    if (deeper) {
      setMechNoteOverride(`already carrying the narrower <b>${deeper}</b>; the prefix adds nothing`);
    } else {
      onAddMech(m.p);
    }
    setMechInputValue("");
    setMechHl(0);
    mechInputRef.current?.focus();
  };

  const mechNote = mechRequiredError
    ? '<span style="color:var(--diverge)">A blocked call needs at least one mechanism. If you cannot narrow it, add the bare layer.</span>'
    : mechNoteOverride ?? standingMechNote(draft.mechs);

  return (
    <div className="judgment">
      <span className="eyebrow">Your judgment</span>
      <h3>{rowTitle}</h3>
      <p className="hint">
        What does <em>this measurement</em> show? Not what the country was doing that week.
      </p>

      <ol className="flow" title="The keyboard walks you through these in order">
        {FLOW.map((step) => {
          const past = FLOW.indexOf(flowStep);
          const i = FLOW.indexOf(step);
          const skip = step === "mechanism" && draft.label !== null && draft.label !== "blocked";
          const cls = [step === flowStep ? "on" : "", i < past ? "done" : "", skip ? "skip" : ""]
            .filter(Boolean)
            .join(" ");
          const names: Record<FlowStep, string> = {
            verdict: "Verdict",
            mechanism: "Mechanisms",
            confidence: "Confidence",
            rationale: "Rationale",
          };
          return (
            <li key={step} className={cls} onClick={() => onGotoStep(step)}>
              {names[step]}
            </li>
          );
        })}
      </ol>

      <div className="choices">
        {CHOICES.map((c) => (
          <button
            key={c.label}
            className={"choice " + c.cls}
            aria-pressed={draft.label === c.label}
            onClick={() => onSetLabel(c.label)}
          >
            <kbd>{c.key}</kbd> {c.text}
          </button>
        ))}
      </div>

      <span className="eyebrow">Confidence</span>
      <div className="seg-group">
        {CONFS.map((c) => (
          <button key={c.key} className="btn" aria-pressed={draft.confidence === c.key} onClick={() => onSetConfidence(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <label className="field" style={{ opacity: draft.label !== null && draft.label !== "blocked" ? 0.45 : 1 }}>
        <span className="eyebrow">
          Mechanisms
          <a
            href="#g-mechanism"
            className="guide-link"
            style={{ float: "right", fontSize: 11, color: "var(--dim)", textTransform: "none", letterSpacing: 0 }}
            onClick={(e) => {
              e.preventDefault();
              onGuideLink("#g-mechanism");
            }}
          >
            taxonomy
          </a>
        </span>
        <div className="chips">
          {draft.mechs.map((pth) => (
            <span className="chip" key={pth}>
              <span>{pth}</span>
              <button type="button" title={"remove " + pth} onClick={() => onRemoveMech(pth)}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mech-wrap">
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            style={{ fontFamily: "var(--mono)" }}
            placeholder="type to filter · ⏎ adds · ⏎ on empty continues"
            ref={mechInputRef}
            value={mechInputValue}
            onChange={(e) => {
              setMechInputValue(e.target.value);
              setMechHl(0);
              setDropdownOpen(true);
            }}
            onFocus={() => {
              if (mechInputValue) setDropdownOpen(true);
            }}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                setMechHl((h) => Math.min(h + 1, Math.min(mechMatches.length, 14) - 1));
                setDropdownOpen(true);
                e.preventDefault();
              } else if (e.key === "ArrowUp") {
                setMechHl((h) => Math.max(h - 1, 0));
                e.preventDefault();
              } else if (e.key === "Tab" && mechInputValue.trim()) {
                pick(mechHl);
                e.preventDefault();
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (mechInputValue.trim()) pick(mechHl);
                else onGotoStep("confidence");
              } else if (e.key === "Backspace" && !mechInputValue) {
                if (draft.mechs.length) onRemoveMech(draft.mechs[draft.mechs.length - 1]);
              } else if (e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
                onGotoStep("verdict");
                e.preventDefault();
              }
            }}
          />
          {dropdownOpen && mechMatches.length > 0 && (
            <div className="mech-list" role="listbox">
              {mechMatches.map((m, i) => {
                const q = mechInputValue.trim();
                const desc = m.d || (isInternalMechanism(m.p) ? "sub-type not identified" : "");
                return (
                  <div
                    key={m.p}
                    className={"mi" + (i === mechHl ? " hl" : "")}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(i);
                    }}
                  >
                    <span className="pth" dangerouslySetInnerHTML={{ __html: highlightMatch(m.p, q) }} />
                    {desc && <span className="d">{desc}</span>}
                    {m.warn && <span className="d" style={{ color: "var(--probe)" }}>[{m.warn}]</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </label>
      {mechNote && <div className="stat" style={{ margin: "-8px 0 12px" }} dangerouslySetInnerHTML={{ __html: mechNote }} />}

      <label className="field">
        <span className="eyebrow">Rationale</span>
        <textarea
          rows={4}
          ref={whyRef}
          placeholder={
            whyRequiredError ? "Required — name the specific evidence you used." : "Name the evidence. 'Control returned 3 Cloudflare A-records; probe got one in-country IP in AS12345.'"
          }
          value={why}
          onChange={(e) => onWhyChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              onCommit();
              e.preventDefault();
            } else if (e.key === "Escape") {
              (e.target as HTMLTextAreaElement).blur();
              onGotoStep("confidence");
              e.preventDefault();
            }
          }}
        />
      </label>

      <button className="btn btn-primary" style={{ width: "100%" }} disabled={commitDisabled || !hasRow} onClick={onCommit}>
        Commit &amp; reveal <kbd style={{ opacity: 0.7 }}>⏎</kbd>
      </button>

      {sealed ? (
        <div className="sealed-box">
          <span className="eyebrow">Sealed until you commit</span>
          The pipeline's verdict and LoNI values are hidden. Seeing them first would anchor your
          judgment, and every likelihood ratio fit from these labels would be inflated by an amount
          nobody can measure.{" "}
          <a
            href="#g-blinding"
            className="guide-link"
            style={{ color: "var(--sealed)" }}
            onClick={(e) => {
              e.preventDefault();
              onGuideLink("#g-blinding");
            }}
          >
            Why
          </a>
        </div>
      ) : (
        <RevealBox
          loading={revealLoading}
          error={revealError}
          data={revealData}
          recLabel={revealForLabel}
          onNextUnlabelled={onNextUnlabelled}
        />
      )}
    </div>
  );
}

function highlightMatch(path: string, q: string): string {
  if (!q) return path;
  const idx = path.indexOf(q);
  if (idx === -1) return path;
  return path.slice(0, idx) + `<b style="color:var(--probe)">${q}</b>` + path.slice(idx + q.length);
}

function RevealBox({
  loading,
  error,
  data,
  recLabel,
  onNextUnlabelled,
}: {
  loading: boolean;
  error: string | null;
  data: RevealResponse | null;
  recLabel: Verdict | null;
  onNextUnlabelled: () => void;
}) {
  if (loading) {
    return (
      <div className="reveal-box">
        <span className="eyebrow">Pipeline verdict</span>
        <p className="hint">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="reveal-box">
        <span className="eyebrow">Pipeline verdict</span>
        <p className="hint">Could not load: {error}</p>
      </div>
    );
  }
  if (!data) return null;

  const a = data.analysis;
  const f = data.fastpath;
  const maxBlocked = a ? Math.max(a.loni.dns.blocked || 0, a.loni.tcp.blocked || 0, a.loni.tls.blocked || 0) : null;
  const pipelineSaysBlocked = maxBlocked !== null && maxBlocked >= 0.5;
  const agrees = recLabel !== null ? (recLabel === "blocked") === pipelineSaysBlocked : null;
  const showAgreeFlag = a && recLabel && ["blocked", "down", "ok"].includes(recLabel);

  return (
    <div className="reveal-box">
      <span className="eyebrow">Pipeline verdict</span>
      {showAgreeFlag && (
        <div className={"agree-flag " + (agrees ? "same" : "diff")} style={{ marginTop: 8 }}>
          {agrees ? "Agrees with your call" : "Disagrees with your call — worth a look"}
        </div>
      )}
      <dl>
        {a ? (
          <>
            <dt>top_probe_analysis</dt>
            <dd>{a.top_probe_analysis || "—"}</dd>
            <dt>LoNI blocked (dns / tcp / tls)</dt>
            <dd>
              {(a.loni.dns.blocked ?? 0).toFixed(2)} / {(a.loni.tcp.blocked ?? 0).toFixed(2)} /{" "}
              {(a.loni.tls.blocked ?? 0).toFixed(2)}
            </dd>
            <dt>top failures</dt>
            <dd>{[a.top_dns_failure, a.top_tcp_failure, a.top_tls_failure].filter(Boolean).join(" · ") || "—"}</dd>
          </>
        ) : (
          <>
            <dt>analysis</dt>
            <dd>no row in analysis_web_measurement</dd>
          </>
        )}
        {f && (
          <>
            <dt>fastpath</dt>
            <dd>
              anomaly {String(f.anomaly)} · confirmed {String(f.confirmed)}
            </dd>
          </>
        )}
      </dl>
      <p className="hint">
        These weights are hand-set and uncalibrated — a claim to check, not the answer. Changed your
        mind? Re-label and commit again; the old label is superseded, not erased.
      </p>
      <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={onNextUnlabelled}>
        Next unlabelled (N)
      </button>
    </div>
  );
}
