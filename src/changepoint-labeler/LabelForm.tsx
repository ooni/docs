import { useEffect, useState } from "react";
import { isoHour } from "../event-dashboard/inspect";
import type { ChangepointLabel, StoredChangepoint, TimeField, Verdict } from "./types";
import { TIME_FIELDS } from "./types";

export interface Draft {
  verdict: Verdict | null;
  notes: string;
  times: Record<TimeField, number | null>; // ms, hour starts
}

export const emptyDraft = (): Draft => ({
  verdict: null,
  notes: "",
  times: { last_ok_time: null, first_block_time: null, last_block_time: null, first_ok_time: null },
});

export const draftFromLabel = (l: ChangepointLabel): Draft => ({
  verdict: l.verdict,
  notes: l.notes,
  times: {
    last_ok_time: l.last_ok_time ? Date.parse(l.last_ok_time) : null,
    first_block_time: l.first_block_time ? Date.parse(l.first_block_time) : null,
    last_block_time: l.last_block_time ? Date.parse(l.last_block_time) : null,
    first_ok_time: l.first_ok_time ? Date.parse(l.first_ok_time) : null,
  },
});

export const TIME_META: Record<TimeField, { label: string; key: string; hint: string }> = {
  last_ok_time: { label: "Last OK", key: "1", hint: "the last hour the site still worked" },
  first_block_time: { label: "First blocked", key: "2", hint: "the first hour it was clearly blocked" },
  last_block_time: { label: "Last blocked", key: "3", hint: "the last hour it was still blocked" },
  first_ok_time: { label: "First OK", key: "4", hint: "the first hour it worked again" },
};

const VERDICTS: { v: Verdict; label: string; key: string }[] = [
  { v: "blocked", label: "Blocked", key: "b" },
  { v: "ok", label: "OK", key: "o" },
  { v: "undecided", label: "Undecided", key: "u" },
];

// Ordering the times must respect, when both ends are set
const ORDER: [TimeField, TimeField, string][] = [
  ["last_ok_time", "first_block_time", "Last OK must come before First blocked"],
  ["first_block_time", "last_block_time", "First blocked must not come after Last blocked"],
  ["last_block_time", "first_ok_time", "Last blocked must come before First OK"],
];

export function validate(d: Draft, author: string): string[] {
  const errs: string[] = [];
  if (!author.trim()) errs.push("Set your name (top right) before saving");
  if (!d.verdict) errs.push("Pick a verdict");
  for (const [a, b, msg] of ORDER) {
    const ta = d.times[a];
    const tb = d.times[b];
    if (ta !== null && tb !== null && (a === "first_block_time" ? ta > tb : ta >= tb)) errs.push(msg);
  }
  if (d.verdict === "undecided" && !d.notes.trim()) errs.push("Say in the notes what makes it undecidable");
  return errs;
}

interface Props {
  cp: StoredChangepoint;
  draft: Draft;
  // takes an updater so quick successive keys never overwrite each other
  onChange: (update: (d: Draft) => Draft) => void;
  selectedHour: number | null;
  onJump: (ms: number) => void;
  author: string;
  saving: boolean;
  onSave: () => void;
  history: ChangepointLabel[];
}

// The detector's call decides which pair of times brackets the transition
const primaryTimes = (cp: StoredChangepoint): TimeField[] =>
  cp.state === "BLOCK" ? ["last_ok_time", "first_block_time"] : ["last_block_time", "first_ok_time"];

export default function LabelForm({
  cp,
  draft,
  onChange,
  selectedHour,
  onJump,
  author,
  saving,
  onSave,
  history,
}: Props) {
  const primary = primaryTimes(cp);
  const secondary = TIME_FIELDS.filter((f) => !primary.includes(f));
  const [showSecondary, setShowSecondary] = useState(false);
  useEffect(() => {
    setShowSecondary(secondary.some((f) => draft.times[f] !== null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cp.uuid]);

  const errors = validate(draft, author);
  const setTime = (f: TimeField, ms: number | null) =>
    onChange((d) => ({ ...d, times: { ...d.times, [f]: ms } }));

  // Keyboard: b/o/u verdict, 1-4 set a time from the selected hour,
  // Cmd/Ctrl+Enter saves. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (validate(draft, author).length === 0 && !saving) {
          e.preventDefault();
          onSave();
        }
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VERDICTS.find((x) => x.key === e.key);
      if (v) {
        onChange((d) => ({ ...d, verdict: v.v }));
        return;
      }
      const f = TIME_FIELDS.find((x) => TIME_META[x].key === e.key);
      if (f && selectedHour !== null) {
        if (!primary.includes(f)) setShowSecondary(true);
        setTime(f, selectedHour);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const agrees =
    draft.verdict && draft.verdict !== "undecided"
      ? (draft.verdict === "blocked") === (cp.state === "BLOCK")
      : null;
  const step1 = selectedHour !== null;
  const step2 = draft.verdict !== null;
  const step3 = primary.every((f) => draft.times[f] !== null) || draft.verdict === "undecided";

  return (
    <div className="lf">
      <Step n={1} done={step1} title="Look at the evidence">
        <p className="lf-help">
          Read the three layer charts and the observations around the change. Click a bar to load the
          measurements of that hour and compare them with the control.
        </p>
      </Step>

      <Step n={2} done={step2} title="What state is the network in after the change?">
        <p className="lf-help">
          The detector says{" "}
          <strong className={cp.state === "BLOCK" ? "badge-fail" : "badge-ok"}>
            {cp.state === "BLOCK" ? "blocking started" : "blocking ended"}
          </strong>{" "}
          on {cp.layer.toUpperCase()} at {isoHour(Date.parse(cp.ts_hour))} UTC.
        </p>
        <div className="lf-verdicts" role="radiogroup" aria-label="Verdict">
          {VERDICTS.map(({ v, label, key }) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={draft.verdict === v}
              className={`lf-verdict lf-verdict-${v} ${draft.verdict === v ? "lf-verdict-on" : ""}`}
              onClick={() => onChange((d) => ({ ...d, verdict: v }))}
            >
              {label}
              <kbd>{key}</kbd>
            </button>
          ))}
        </div>
        {agrees !== null && (
          <p className={`text-xs mt-1 ${agrees ? "badge-ok" : "badge-warn"}`}>
            {agrees ? "✓ agrees with the detector" : "! disagrees with the detector — say why in the notes"}
          </p>
        )}
      </Step>

      <Step n={3} done={step3} title="Bracket the transition">
        <p className="lf-help">
          Select an hour on any chart, then set it with the button or its number key. Times are the
          start of the hour, UTC.
        </p>
        <div className="space-y-1.5">
          {primary.map((f) => (
            <TimeRow key={f} field={f} value={draft.times[f]} selectedHour={selectedHour} onSet={setTime} onJump={onJump} />
          ))}
        </div>
        <button type="button" className="link text-xs mt-2" onClick={() => setShowSecondary((v) => !v)}>
          {showSecondary ? "hide" : "also mark"} {secondary.map((f) => TIME_META[f].label).join(" / ")}
          {cp.state === "BLOCK" ? " (the block also ended)" : " (when it had started)"}
        </button>
        {showSecondary && (
          <div className="space-y-1.5 mt-1.5">
            {secondary.map((f) => (
              <TimeRow key={f} field={f} value={draft.times[f]} selectedHour={selectedHour} onSet={setTime} onJump={onJump} />
            ))}
          </div>
        )}
      </Step>

      <Step n={4} done={false} title="Notes and save">
        <textarea
          className="ed-input w-full text-sm"
          rows={3}
          placeholder="What convinced you — or what is missing"
          value={draft.notes}
          onChange={(e) => {
            const notes = e.target.value;
            onChange((d) => ({ ...d, notes }));
          }}
        />
        {errors.length > 0 && (
          <ul className="text-xs badge-warn mt-1 space-y-0.5">
            {errors.map((e) => (
              <li key={e}>! {e}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="ed-button w-full mt-2"
          disabled={errors.length > 0 || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save label"} <span className="opacity-60 normal-case">⌘↵</span>
        </button>
      </Step>

      {history.length > 0 && (
        <details className="lf-history">
          <summary className="text-xs font-bold cursor-pointer">
            {history.length} earlier label{history.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 space-y-2">
            {[...history]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((l) => (
                <li key={l.id} className="text-xs">
                  <div>
                    <strong className={`lf-tag lf-tag-${l.verdict}`}>{l.verdict}</strong>{" "}
                    {l.author} · <span className="tabular-nums">{l.created_at.slice(0, 16).replace("T", " ")}</span>
                  </div>
                  <div className="text-muted tabular-nums">
                    {TIME_FIELDS.filter((f) => l[f])
                      .map((f) => `${TIME_META[f].label} ${isoHour(Date.parse(l[f] as string))}`)
                      .join(" · ")}
                  </div>
                  {l.notes && <div className="text-secondary">{l.notes}</div>}
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="lf-step">
      <h3 className="lf-step-title">
        <span className={`lf-step-n ${done ? "lf-step-done" : ""}`}>{done ? "✓" : n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const toInput = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString().slice(0, 16));
const fromInput = (v: string) => {
  const ms = Date.parse(v + ":00Z");
  return Number.isNaN(ms) ? null : Math.floor(ms / 3600e3) * 3600e3;
};

function TimeRow({
  field,
  value,
  selectedHour,
  onSet,
  onJump,
}: {
  field: TimeField;
  value: number | null;
  selectedHour: number | null;
  onSet: (f: TimeField, ms: number | null) => void;
  onJump: (ms: number) => void;
}) {
  const m = TIME_META[field];
  return (
    <div className="lf-time">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide">
          {m.label} <kbd>{m.key}</kbd>
        </span>
        {value !== null && (
          <span className="flex gap-2 text-xs">
            <button type="button" className="link" onClick={() => onJump(value)}>
              show
            </button>
            <button type="button" className="link" onClick={() => onSet(field, null)}>
              clear
            </button>
          </span>
        )}
      </div>
      <div className="flex gap-1 mt-0.5">
        <input
          type="datetime-local"
          step={3600}
          className="ed-input text-xs flex-1 min-w-0 tabular-nums"
          value={toInput(value)}
          onChange={(e) => onSet(field, fromInput(e.target.value))}
          aria-label={`${m.label} (UTC)`}
          title={m.hint}
        />
        <button
          type="button"
          className="seg-btn"
          disabled={selectedHour === null}
          onClick={() => selectedHour !== null && onSet(field, selectedHour)}
          title={selectedHour === null ? "Select an hour on a chart first" : `Set to ${isoHour(selectedHour)}`}
        >
          ← selected
        </button>
      </div>
      <div className="text-[0.65rem] text-muted mt-0.5">{m.hint}</div>
    </div>
  );
}
