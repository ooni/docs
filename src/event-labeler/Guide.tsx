import { useEffect, useRef } from "react";

export interface GuideProps {
  open: boolean;
  anchor: string | null;
  onClose: () => void;
}

/**
 * The in-app guide. Same shape as the measurement labeler's: a full-screen
 * overlay, anchor-linked from the fields it explains, so the reasoning behind
 * a field is one click from the field itself rather than in a design doc
 * nobody has open while adjudicating.
 */
export default function Guide({ open, anchor, onClose }: GuideProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const root = wrapRef.current;
    if (root) {
      root.scrollTop = 0;
      const t = anchor && root.querySelector(anchor);
      if (t) t.scrollIntoView({ block: "start" });
    }
    closeBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  const jumpTo = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a[href^='#g-']") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const t = wrapRef.current?.querySelector(a.getAttribute("href")!);
    if (t) t.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div id="guide" ref={wrapRef} onClick={jumpTo}>
      <div className="gwrap">
        <div className="gclose">
          <span className="eyebrow">Event adjudication guide</span>
          <button className="btn" ref={closeBtnRef} onClick={onClose}>
            Back to adjudicating{" "}
            <kbd style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: 0.6 }}>Esc</kbd>
          </button>
        </div>

        <h1>The event grain</h1>
        <p className="lede">
          One row per censorship event: when it started, where, against what, and how. This is the
          corpus the <em>detector</em> gets scored against — time-to-detect, missed events, false
          alarms per quiet week. No per-measurement metric can express any of those.
        </p>

        <div className="toc">
          <span className="eyebrow">Contents</span>
          <ol>
            <li>
              <a href="#g-job">What you are actually deciding</a>
            </li>
            <li>
              <a href="#g-scope">Scope, and the explicit unknown</a>
            </li>
            <li>
              <a href="#g-when">Onset as a bracket</a>
            </li>
            <li>
              <a href="#g-mechanism">Naming the mechanisms</a>
            </li>
            <li>
              <a href="#g-class">The three classes</a>
            </li>
            <li>
              <a href="#g-scoreable">Scoreable, and the coverage check</a>
            </li>
            <li>
              <a href="#g-derived">Derived, never stored</a>
            </li>
            <li>
              <a href="#g-export">Import, export, and what the harness does</a>
            </li>
            <li>
              <a href="#g-keys">Keyboard reference</a>
            </li>
          </ol>
        </div>

        <h2 id="g-job">
          <span className="n">01</span> What you are actually deciding
        </h2>
        <p>
          An event row says: <em>something happened, here, to these targets, in roughly this
          window, by these techniques</em>. It is a claim about the world, built from a report, an
          operator statement or your own analysis — not a summary of what the pipeline output.
        </p>
        <p>
          The two grains share sourcing. Working an incident produces both in one pass: the event
          row here, and a sample of measurements from inside and around it in the measurement
          queue. They are kept separate on purpose.
        </p>
        <div className="callout warn">
          <span className="eyebrow">The failure mode</span>
          <p>
            Labels carry no <code>event_id</code>, and that is deliberate. Linking the grains would
            invite propagating one incident adjudication onto every measurement in the window, which
            mislabels the unaffected ones — the single most damaging defect this corpus can acquire.
            Measurements drawn from an event window carry{" "}
            <code>sampling_stratum = incident_window</code> and are judged on their own evidence.
          </p>
        </div>

        <h2 id="g-scope">
          <span className="n">02</span> Scope, and the explicit unknown
        </h2>
        <p>
          <code>asn_scope_kind</code> and <code>target_set_kind</code> exist so that "national, but
          we do not know which ASNs" is a thing you can enter. Without them, analysts either guess
          an ASN list or drop the event, and both are worse than recording the uncertainty.
        </p>
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Means</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>all</code>
              </td>
              <td>every network in the country; the block was national</td>
            </tr>
            <tr>
              <td>
                <code>listed</code>
              </td>
              <td>exactly the ASNs in <code>asn_scope</code>, and no claim about the others</td>
            </tr>
            <tr>
              <td>
                <code>unknown</code>
              </td>
              <td>the event is real, its network extent was never established</td>
            </tr>
            <tr>
              <td>
                <code>enumerated</code>
              </td>
              <td>the named domains, and no claim about anything else</td>
            </tr>
            <tr>
              <td>
                <code>category</code>
              </td>
              <td>a citizenlab category code rather than a domain list</td>
            </tr>
          </tbody>
        </table>
        <p>
          Recall is reported stratified by <code>size_band</code>, because adjudicated events skew
          large and famous and unstratified recall is optimistic. The band is derived from the scope
          — see <a href="#g-derived">§07</a> — so it is not something you can enter wrongly.
        </p>

        <h2 id="g-when">
          <span className="n">03</span> Onset as a bracket
        </h2>
        <p>
          Two pickers, <em>no earlier than</em> and <em>no later than</em>. Published reports date
          events coarsely; an analyst made to enter a single onset invents precision that is not
          there, and the harness then scores detection latency against a fiction.
        </p>
        <p>
          The chart is the honest way to fill them. Load the series, arm a bound, click the bucket;
          four clicks fill both brackets. Each bar is one time bucket of <em>observations</em>,
          stacked by outcome: clean observations (<code>none</code>) in green at the bottom, failure
          strings above it coloured by layer — orange DNS, purple TCP, red TLS, blue HTTP. An onset
          is then a shape: the green band collapsing and a failure band taking its place. The
          bracket you draw should be as wide as your evidence actually is — a 24-hour bracket you
          can defend beats an hour you cannot.
        </p>
        <p>
          <b>Split it.</b> A summed chart hides the thing that decides scope. Switch to{" "}
          <b>by ASN</b> or <b>by target</b> and each gets its own panel, sorted by volume, sharing
          one time axis: two ASNs behaving differently, or one domain moving a day before the rest,
          is invisible in the sum and obvious in the split. That is the evidence for{" "}
          <code>asn_scope</code> and <code>target_set</code>, which you have to fill in anyway.
        </p>
        <p>
          Splitting on one axis still sums the other, so each axis also has a filter: pick one
          target, or one ASN, or leave both on <em>all</em>. "Per ASN, for this one domain" is a
          question the scope fields cannot answer otherwise — and since the filter narrows the query
          rather than the drawing, the filtered view is also the faster one.
        </p>
        <p>
          <b>Drag to zoom</b> into a span; the bars get wide enough to hit the bucket you mean. With
          a zoom active the load button becomes <b>Load zoomed range</b>, which re-queries just that
          span — the way to get hourly resolution over a window the API would time out on at full
          width. Each bound also has a <b>✕</b> to clear it; clearing{" "}
          <code>resolution_earliest</code> is how an event goes back to ongoing.
        </p>
        <p>
          <b>count</b> shows observations per bucket; <b>share</b> normalises each bucket to 100% so
          an onset stays legible when probe volume swings, with a volume rail underneath. Check the
          rail before calling an onset from the share view: a volume collapse — a shutdown quieting
          the probes, or a country simply not being measured that night — renders as a clean green
          bar, and is the case most worth not misreading.
        </p>
        <div className="callout">
          <span className="eyebrow">Why not plot the pipeline's blocking probability</span>
          <p>
            Because you would be reading the onset off the thing this corpus exists to evaluate.
            Anchoring the bracket to the pipeline's own opinion of when blocking started is the
            circularity requirement V1 rules out, and scored probabilities move whenever the rules
            are refit. "<code>tls.connection_reset</code> replaced <code>none</code> at 14:00" is a
            fact about the network and still means the same thing in a year.
          </p>
        </div>
        <div className="callout">
          <span className="eyebrow">Latency can be negative</span>
          <p>
            The harness measures from <code>onset_earliest</code>. Reports are day-granular and
            usually lag the block, so a detector firing before the bracket opens is a good outcome,
            not a sign error.
          </p>
        </div>
        <p>
          Leave <code>resolution_earliest</code> blank for an ongoing event. An inverted bracket, or
          a resolution before the onset, is refused rather than warned about: either makes the row
          unusable to the replay harness.
        </p>

        <h2 id="g-mechanism">
          <span className="n">04</span> Naming the mechanisms
        </h2>
        <p>
          The same taxonomy v1 as the measurement queue, for the same reason: a label keyed to a
          rule id ages badly as rules split and get renamed, a label recording "this was an SNI
          reset" does not. Paths are <code>&lt;layer&gt;.&lt;action&gt;.&lt;qualifier&gt;</code> and
          every prefix is itself a valid entry — <code>tls.mitm</code> and bare <code>tls</code> both
          mean "this layer, sub-type not identified".
        </p>
        <p>
          Multi-select, so one event carries both <code>dns.injection.bogon</code> and{" "}
          <code>tls.reset.sni</code> when it used both. Adding a narrower path replaces its ancestor;
          adding a prefix on top of a narrower path is refused as adding nothing.
        </p>
        <p>
          A <code>true_event</code> cannot be saved without at least one. An event with no mechanism
          is not scored by the harness — it is counted as excluded, which is worse than a coarse
          layer entry.
        </p>

        <h2 id="g-class">
          <span className="n">05</span> The three classes
        </h2>
        <div className="verdict blocked">
          <h4>
            <kbd>T</kbd> true_event
          </h4>
          <p>Interference happened. The detector is expected to fire inside the window.</p>
        </div>
        <div className="verdict ok">
          <h4>
            <kbd>F</kbd> false_positive_event
          </h4>
          <p>
            An alert, or a widely repeated claim, that adjudication found was not censorship. These
            are first-class corpus rows, not rejects: gold negatives for the measurement grain and a
            must-not-fire regression test for the detector. The harness inverts the pass condition.
          </p>
          <p className="ex">
            e.g. a CDN migration that moved every answer in a country on one afternoon
          </p>
        </div>
        <div className="verdict un">
          <h4>
            <kbd>D</kbd> disputed
          </h4>
          <p>
            Sources conflict and you cannot resolve it. Say so in the rationale; a disputed row with
            a real rationale is more useful than a coin-flip <code>true_event</code>.
          </p>
        </div>
        <p>
          <b>Confidence</b> records how sure <em>you</em> are, on this row. It is not a probability
          the harness multiplies by; it is what lets a later reader drop the uncertain rows and see
          whether a conclusion survives.
        </p>

        <h2 id="g-scoreable">
          <span className="n">06</span> Scoreable, and the coverage check
        </h2>
        <p>
          An event on networks where OONI had no probes during the window cannot be detected by any
          detector. Counting it as a miss makes recall meaninglessly pessimistic.{" "}
          <code>scoreable</code> is the event-level counterpart of <code>unusable</code> on a
          measurement label.
        </p>
        <p>
          <b>Check coverage</b> (<kbd>C</kbd>) resolves it with a query instead of a guess: it counts
          measurements in this scope and window, broken down by ASN, and sets the field from the
          answer. Traffic in the country but none on the listed ASNs correctly reads as{" "}
          <code>no_coverage</code>. The harness reports the excluded count alongside recall, so the
          exclusion stays visible rather than quietly flattering the number.
        </p>

        <h2 id="g-derived">
          <span className="n">07</span> Derived, never stored
        </h2>
        <p>
          Three fields are computed on read and never written. A stored <code>ongoing = true</code>{" "}
          next to a non-null <code>resolution_earliest</code> is not extra information, it is a bug
          that renders as data.
        </p>
        <pre>
          <code>{`ongoing   = resolution_earliest is null
layers    = distinct first path segment of each mechanism
size_band = asn_scope_kind = 'all'      -> national
            asn_scope_kind = 'unknown'  -> unknown
            len(asn_scope) > 1          -> multi_asn
            target_set_kind = 'enumerated' and len(target_set) = 1 -> micro
                                        -> single_asn`}</code>
        </pre>
        <p>
          They are shown live in the rail as you type, which is also how a scope entry error becomes
          visible immediately: a national block reading <code>size_band: micro</code> means the
          scope fields are wrong.
        </p>

        <h2 id="g-export">
          <span className="n">08</span> Import, export, and what the harness does
        </h2>
        <p>
          Drafts are seeded from OONI's published incidents by{" "}
          <code>scripts/incidents_to_events.py</code>. Import merges by <code>event_id</code> — a
          uuid5 of the incident id, so re-import is idempotent — and leaves rows you have already
          adjudicated untouched. A refreshed draft costs you nothing.
        </p>
        <p>
          Nothing is stored server-side. Events live in this browser and leave by copy-paste; export
          early and often. <code>oonipipeline event-eval &lt;events.json&gt;</code> reads exactly the
          exported file, replays the detector per event and prints event recall stratified by{" "}
          <code>size_band</code>, median detection latency, false alerts per quiet series-week and
          alerts per detected true event.
        </p>
        <div className="callout">
          <span className="eyebrow">Volume</span>
          <p>
            50–150 adjudicated events is the working target. Events are curated, not sampled: there
            is no frame to draw from and no weight to carry, so recall over them is a coverage
            statement about a hand-built set rather than an estimate of a population.
          </p>
        </div>

        <h2 id="g-keys">
          <span className="n">09</span> Keyboard reference
        </h2>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <kbd>T</kbd> <kbd>F</kbd> <kbd>D</kbd>
              </td>
              <td>true_event · false_positive_event · disputed</td>
            </tr>
            <tr>
              <td>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>
              </td>
              <td>confidence: certain · probable · uncertain</td>
            </tr>
            <tr>
              <td>
                <kbd>M</kbd> <kbd>R</kbd>
              </td>
              <td>jump to mechanisms · rationale</td>
            </tr>
            <tr>
              <td>
                <kbd>C</kbd>
              </td>
              <td>check coverage and set scoreable</td>
            </tr>
            <tr>
              <td>
                <kbd>N</kbd>
              </td>
              <td>next incomplete event</td>
            </tr>
            <tr>
              <td>
                <kbd>⏎</kbd> / <kbd>⌘⏎</kbd>
              </td>
              <td>save the event (⌘⏎ from inside a field)</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>step back through the flow</td>
            </tr>
            <tr>
              <td>
                <kbd>?</kbd>
              </td>
              <td>this guide</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
