import DomainInput from "./DomainInput";
import { todayUTC, windowFor } from "./derive";
import type { Country, DomainEntry } from "./types";

export interface Query {
  probeCc: string;
  domain: string;
  date: string; // YYYY-MM-DD, last day of the window
}

export const isComplete = (q: Query): boolean =>
  !!q.probeCc && !!q.domain && /^\d{4}-\d{2}-\d{2}$/.test(q.date);

interface Props {
  query: Query;
  onChange: (q: Query) => void;
  onRun: () => void;
  running: boolean;
  // the inputs no longer match the results on screen
  stale: boolean;
  countries: Country[];
  domains: DomainEntry[];
}

export default function QueryBar({
  query,
  onChange,
  onRun,
  running,
  stale,
  countries,
  domains,
}: Props) {
  const win = query.date ? windowFor(query.date) : null;
  return (
    <form
      className="card mb-6"
      onSubmit={(e) => {
        e.preventDefault();
        onRun();
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] gap-3 items-end">
        <div>
          <label className="ed-label" htmlFor="ed-country">
            Country
          </label>
          <select
            id="ed-country"
            className="ed-input w-full text-sm"
            value={query.probeCc}
            onChange={(e) => onChange({ ...query, probeCc: e.target.value })}
          >
            <option value="">
              {countries.length ? "Pick a country…" : "loading countries…"}
            </option>
            {countries.map((c) => (
              <option key={c.alpha_2} value={c.alpha_2}>
                {c.name} ({c.alpha_2})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ed-label" htmlFor="ed-domain">
            Domain
          </label>
          <DomainInput
            domains={domains}
            value={query.domain}
            onCommit={(domain) => onChange({ ...query, domain })}
          />
        </div>
        <div>
          <label className="ed-label" htmlFor="ed-date">
            Date
          </label>
          <input
            id="ed-date"
            type="date"
            className="ed-input text-sm tabular-nums"
            value={query.date}
            max={todayUTC()}
            onChange={(e) => onChange({ ...query, date: e.target.value })}
          />
        </div>
        <button
          type="submit"
          className={`ed-button ${stale ? "ed-button-stale" : ""}`}
          disabled={running || !isComplete(query)}
        >
          {running ? "Detecting…" : "Detect events"}
        </button>
      </div>
      {win && (
        <p className="text-xs text-muted mt-2 tabular-nums">
          Window {win.startDate} → {win.endDate} (UTC)
        </p>
      )}
    </form>
  );
}
