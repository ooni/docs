import { useId, useMemo, useRef, useState } from "react";
import type { DomainEntry } from "./types";

const MAX_SUGGESTIONS = 12;
const fmt = new Intl.NumberFormat("en-US");

interface Props {
  domains: DomainEntry[];
  value: string;
  // Called when the user settles on a domain: picks a suggestion, presses
  // Enter or leaves the field. Free text is allowed — the changepoint API
  // takes any hostname, the list only helps typing it.
  onCommit: (domain: string) => void;
}

// Prefix matches first, then substring matches; busiest domains first in each
function suggest(domains: DomainEntry[], query: string): DomainEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const prefix: DomainEntry[] = [];
  const contains: DomainEntry[] = [];
  for (const d of domains) {
    if (d.domain_name.startsWith(q)) prefix.push(d);
    else if (d.domain_name.includes(q)) contains.push(d);
  }
  const byCount = (a: DomainEntry, b: DomainEntry) =>
    b.measurement_count - a.measurement_count;
  return [...prefix.sort(byCount), ...contains.sort(byCount)].slice(
    0,
    MAX_SUGGESTIONS
  );
}

export default function DomainInput({ domains, value, onCommit }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const lastValue = useRef(value);

  // Follow external changes (deep link, reset) without clobbering typing
  if (value !== lastValue.current) {
    lastValue.current = value;
    setText(value);
  }

  const matches = useMemo(() => suggest(domains, text), [domains, text]);

  const commit = (domain: string) => {
    const d = domain.trim().toLowerCase();
    setText(d);
    setOpen(false);
    setActive(-1);
    if (d && d !== value) onCommit(d);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(active >= 0 && matches[active] ? matches[active].domain_name : text);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && matches.length > 0;

  return (
    <div className="relative">
      <input
        id="ed-domain"
        className="ed-input w-full font-mono text-sm"
        placeholder={domains.length ? "twitter.com" : "loading domains…"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => commit(text)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {showList && (
        <ul id={listId} role="listbox" className="ed-listbox">
          {matches.map((d, i) => (
            <li
              key={d.domain_name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`ed-option ${i === active ? "ed-option-active" : ""}`}
              // mousedown, not click: it fires before the input blurs
              onMouseDown={(e) => {
                e.preventDefault();
                commit(d.domain_name);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="font-mono truncate">{d.domain_name}</span>
              <span className="text-muted text-xs tabular-nums shrink-0">
                {d.category_code} · {fmt.format(d.measurement_count)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
