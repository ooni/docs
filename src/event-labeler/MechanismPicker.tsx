import { useEffect, useRef, useState } from "react";
import { addMechanism, filterMechanisms, isInternalMechanism, MECH_BY_PATH } from "./mechanisms";

export interface MechanismPickerProps {
  mechs: string[];
  onChange: (next: string[]) => void;
  /** Shown in place of the standing note when a save was refused for want of one. */
  requiredError?: boolean;
  onDone?: () => void;
  onEscape?: () => void;
  inputRef?: React.RefObject<HTMLInputElement>;
}

function highlightMatch(path: string, q: string): string {
  if (!q) return path;
  const idx = path.indexOf(q);
  if (idx === -1) return path;
  return path.slice(0, idx) + `<b style="color:var(--probe)">${q}</b>` + path.slice(idx + q.length);
}

function standingNote(mechs: string[]): string {
  const warned = mechs
    .map((m) => MECH_BY_PATH.get(m))
    .filter((m): m is NonNullable<typeof m> => !!m?.warn);
  const layers = [...new Set(mechs.map((m) => m.split(".")[0]))];
  let html = mechs.length
    ? `layers: ${layers.join(", ")}`
    : "an event with no mechanism cannot be scored by the harness";
  if (warned.length)
    html +=
      "<br>" +
      warned
        .map(
          (m) =>
            `<span style="color:var(--probe)">${m.p}: ${m.warn} — pick this only if you have evidence outside OONI</span>`
        )
        .join("<br>");
  return html;
}

/**
 * Chips plus a type-ahead over taxonomy v1. Same interaction as the
 * measurement queue's mechanism field, deliberately: an analyst working an
 * incident fills both grains in one pass and should not have to learn two
 * widgets. Prefixes are selectable, and adding a narrower path replaces its
 * ancestor rather than sitting next to it.
 */
export default function MechanismPicker({
  mechs,
  onChange,
  requiredError,
  onDone,
  onEscape,
  inputRef,
}: MechanismPickerProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const [value, setValue] = useState("");
  const [hl, setHl] = useState(0);
  const [open, setOpen] = useState(false);
  const [noteOverride, setNoteOverride] = useState<string | null>(null);

  useEffect(() => setNoteOverride(null), [mechs]);

  const matches = filterMechanisms(value, mechs).slice(0, 14);

  const pick = (i: number) => {
    const m = matches[i];
    if (!m) return;
    const { mechs: next, rejectedByDeeper } = addMechanism(mechs, m.p);
    if (rejectedByDeeper) {
      setNoteOverride(`already carrying the narrower <b>${rejectedByDeeper}</b>; the prefix adds nothing`);
    } else {
      onChange(next);
    }
    setValue("");
    setHl(0);
    ref.current?.focus();
  };

  const note = requiredError
    ? '<span style="color:var(--diverge)">A true_event needs at least one mechanism. If you cannot narrow it, add the bare layer.</span>'
    : noteOverride ?? standingNote(mechs);

  return (
    <>
      <div className="chips">
        {mechs.map((p) => (
          <span className="chip" key={p}>
            <span>{p}</span>
            <button type="button" title={"remove " + p} onClick={() => onChange(mechs.filter((x) => x !== p))}>
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
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setHl(0);
            setOpen(true);
          }}
          onFocus={() => {
            if (value) setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              setHl((h) => Math.min(h + 1, matches.length - 1));
              setOpen(true);
              e.preventDefault();
            } else if (e.key === "ArrowUp") {
              setHl((h) => Math.max(h - 1, 0));
              e.preventDefault();
            } else if (e.key === "Tab" && value.trim()) {
              pick(hl);
              e.preventDefault();
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (value.trim()) pick(hl);
              else onDone?.();
            } else if (e.key === "Backspace" && !value) {
              if (mechs.length) onChange(mechs.slice(0, -1));
            } else if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
              onEscape?.();
              e.preventDefault();
            }
          }}
        />
        {open && matches.length > 0 && (
          <div className="mech-list" role="listbox">
            {matches.map((m, i) => {
              const desc = m.d || (isInternalMechanism(m.p) ? "sub-type not identified" : "");
              return (
                <div
                  key={m.p}
                  className={"mi" + (i === hl ? " hl" : "")}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                >
                  <span
                    className="pth"
                    dangerouslySetInnerHTML={{ __html: highlightMatch(m.p, value.trim()) }}
                  />
                  {desc && <span className="d">{desc}</span>}
                  {m.warn && (
                    <span className="d" style={{ color: "var(--probe)" }}>
                      [{m.warn}]
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {note && <div className="stat" style={{ marginTop: 6 }} dangerouslySetInnerHTML={{ __html: note }} />}
    </>
  );
}
