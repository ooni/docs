import { useEffect, useRef } from "react";

export interface GuideProps {
  open: boolean;
  anchor: string | null;
  onClose: () => void;
}

/**
 * The in-app guide, same shape as the other two labellers': a full-screen
 * overlay, anchor-linked from the fields it explains. Shorter than theirs on
 * purpose — this grain has four verdicts and no taxonomy — but the parts about
 * what "quiet" is allowed to mean carry the whole corpus, so they are spelled
 * out rather than assumed.
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
          <span className="eyebrow">Quiet-interval guide</span>
          <button className="btn" ref={closeBtnRef} onClick={onClose}>
            Back to adjudicating{" "}
            <kbd style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: 0.6 }}>Esc</kbd>
          </button>
        </div>

        <h1>The interval grain</h1>
        <p className="lede">
          One row per detector cell-week: a country, a network, a domain, seven days. The event
          corpus says whether the detector <em>finds</em> things. This one says how often it
          shouts when nothing is there — and that is a rate, so it needs a denominator, and a
          denominator has to be sampled from a frame rather than assembled from interesting cases.
        </p>

        <div className="toc">
          <span className="eyebrow">Contents</span>
          <ol>
            <li>
              <a href="#g-job">What you are deciding</a>
            </li>
            <li>
              <a href="#g-quiet">Why the verdict is "quiet observed"</a>
            </li>
            <li>
              <a href="#g-frame">The frame, the floor and the bands</a>
            </li>
            <li>
              <a href="#g-design">Strata, weights and replicates</a>
            </li>
            <li>
              <a href="#g-blinding">The blinding rule</a>
            </li>
            <li>
              <a href="#g-keys">Keyboard</a>
            </li>
          </ol>
        </div>

        <h2 id="g-job">What you are deciding</h2>
        <p>
          Look at the failure mix for this cell across the padded window and answer one question:{" "}
          <b>did the state change inside the highlighted week?</b> Change, not level — the detector
          is a changepoint detector, so a transition is the only thing it can be right or wrong
          about.
        </p>
        <p>
          That is why there are two negative verdicts rather than one. A week can have no
          transition in it because nothing was happening, or because the same thing was happening
          all week. Both mean the detector should stay silent, and both belong in the false-alarm
          denominator — but only the first is a week where OONI saw nothing wrong, and only the
          first can be reused as a clean negative elsewhere.
        </p>
        <div className="verdict">
          <h4>
            <kbd>Q</kbd> quiet_observed
          </h4>
          <p>
            Nothing in OONI's data for this cell shows interference in this week. The usual shape
            is a flat mix — a stable trickle of failures, or none — with no step at any point
            inside the band.
          </p>
        </div>
        <div className="verdict blocked">
          <h4>
            <kbd>B</kbd> blocked_throughout
          </h4>
          <p>
            Interference runs across the whole week, and starts before it. There is no step inside
            the band because the step already happened — look at the padding to tell this apart
            from a week where the block begins. The detector should be silent here, so an alert is
            a false alarm just as it is in a quiet week.
          </p>
          <p className="ex">
            not quiet: the cell is blocked. Not an event either: nothing changed in this window.
          </p>
        </div>
        <div className="verdict">
          <h4>
            <kbd>E</kbd> event_present
          </h4>
          <p>
            The state changed inside this window — a step into a failure mode, a collapse of ok, or
            a recovery where a block lifts. Say which direction in the rationale. It does not have
            to be an event anyone reported.
          </p>
          <p className="ex">
            a mechanism shift mid-block (injected DNS answers giving way to TLS resets) is also a
            change, and belongs here rather than in blocked_throughout
          </p>
        </div>
        <div className="verdict un">
          <h4>
            <kbd>U</kbd> uncertain
          </h4>
          <p>
            You looked and cannot call it. First-class and counted, not a skip. If ambiguous cells
            get quietly passed over, the surviving negatives are the easy ones and the false-alarm
            rate comes out flattering for a reason that never appears in any number.
          </p>
        </div>
        <div className="verdict">
          <h4>
            <kbd>X</kbd> unusable
          </h4>
          <p>
            The window itself is broken — a probe with a nonsense clock, an obviously mangled
            series. About the data, not the network.
          </p>
        </div>

        <div className="callout warn">
          <span className="eyebrow">Why the padding exists</span>
          <p>
            A week in the middle of a long-running block and a week where nothing is wrong look
            identical from inside the band: flat, no step. Only the fortnight either side tells
            them apart, which is the whole reason the chart pads the window. Judge the week; read
            the fortnight.
          </p>
          <p>
            Get this one wrong in the <code>event_present</code> direction and it costs twice: the
            detector is credited with a detection it never earned — it missed the real onset weeks
            earlier — and the week leaves the false-alarm denominator, so a detector that re-fires
            all through a long block scores clean on both metrics.
          </p>
        </div>

        <h3>How the harness reads the five verdicts</h3>
        <table>
          <thead>
            <tr>
              <th>Verdict</th>
              <th>Counts toward</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>quiet_observed</code>
              </td>
              <td>false-alarm denominator; the only verdict reusable as a clean negative</td>
            </tr>
            <tr>
              <td>
                <code>blocked_throughout</code>
              </td>
              <td>false-alarm denominator — an alert here is a duplicate on an ongoing block</td>
            </tr>
            <tr>
              <td>
                <code>event_present</code>
              </td>
              <td>recall and detection latency</td>
            </tr>
            <tr>
              <td>
                <code>uncertain</code> · <code>unusable</code>
              </td>
              <td>excluded, and reported as an excluded count rather than dropped</td>
            </tr>
          </tbody>
        </table>

        <h2 id="g-quiet">Why the verdict is "quiet observed"</h2>
        <p>
          You are judging quiet from the same data the detector reads. A block on a network with
          no probes, at a time nothing was measured, reads exactly like calm. Naming the verdict{" "}
          <code>quiet_observed</code> caps the claim at "no interference visible in OONI's data",
          which is the honest ceiling and, incidentally, the fair one: a better detector that
          finds subtle real events should not be charged a false alarm for finding one.
        </p>
        <div className="callout">
          <span className="eyebrow">Contamination cuts the safe way</span>
          An unreported real event inside a week called quiet inflates the measured false-alarm
          rate. That makes the detector look worse than it is, which is the direction to err in.
          A <em>reported</em> one is different: when the queue flags an overlap with the event
          corpus, commit <code>event_present</code> if the event starts or ends inside the week,
          and <code>blocked_throughout</code> if it merely covers it — the banner says which,
          per event. Do not skip the row either way; dropping it shrinks the denominator with
          nothing on the record to say why.
        </div>

        <h2 id="g-frame">The frame, the floor and the bands</h2>
        <p>
          The population is cell-weeks with at least the volume floor of measurements in them.
          Without a floor, a uniform draw is dominated by cells too thin for any detector to fire
          in, and every detector scores brilliantly on arithmetic. Rows carry the count they were
          drawn with and a <code>volume_band</code> derived from it, and the harness reports the
          rate per band — a pooled number would average a busy cell and a nearly empty one as
          though they were the same kind of evidence.
        </p>
        <p>
          Frames are snapped to whole ISO weeks. A partial week is a shorter observation window,
          not a smaller one, and mixing the two silently changes what "per series-week" means.
        </p>

        <h2 id="g-design">Strata, weights and replicates</h2>
        <p>
          Rows are drawn from strata that <em>partition</em> the frame: every cell-week in it
          belongs to exactly one, so every row has one selection probability and one correct
          weight. <code>detector_alerted</code> is the weeks the deployed detector fired in,{" "}
          <code>near_miss</code> is the ones that scored blocked-leaning without firing, and{" "}
          <code>random_covered</code> is everything else — the denominator.
        </p>
        <p>
          Oversampling the interesting strata is deliberate, not a bias: most random cell-weeks
          are trivially quiet and carry almost no information per minute of your time. The weights
          correct for it, which is the entire reason a design is recorded rather than a queue
          simply drawn.
        </p>
        <p>
          <b>Replicate</b> makes a draw reproducible. The same parameters give the same design id
          and the same queue, so two adjudicators can be handed an overlap set and their agreement
          measured with no coordination at all. Increment it for fresh cell-weeks from the same
          population.
        </p>

        <h2 id="g-blinding">The blinding rule</h2>
        <p>
          Whether the detector alerted, where its changepoints landed and what it scored are all
          hidden until you commit. In the measurement queue this prevents anchoring. Here it is
          stronger than that: one stratum <em>is</em> the detector's output, so an unblinded alert
          would not merely nudge you, it would tell you the answer to the question being asked.
        </p>
        <p>
          After commit, the reveal shows the alert log and the stratum the row came from. Use it
          to find detector bugs, and re-commit if it genuinely changes your mind — the old row is
          superseded, not erased, and both stay in the export.
        </p>
        <p>
          The commit also opens the <b>What the pipeline scored</b> panels under the observation
          chart, on the same time axis: the blocking probability, the per-layer scores, the DNS
          triple, and a strip showing which outcome carried each bucket. That is where you see{" "}
          <em>why</em> the detector did or did not fire on a week you have already judged on the
          evidence. Two things to keep in mind while reading them:
        </p>
        <ul>
          <li>
            <code>blocked_probability_mean</code> and <code>blocked_max</code> are different
            statistics, not bounds on each other — the first averages the per-measurement blocking
            probability, the second is the largest per-layer score, so either can exceed the other.
          </li>
          <li>
            The DNS <code>ok</code> / <code>down</code> / <code>blocked</code> values are{" "}
            <b>componentwise maxima</b>, not a distribution: they routinely sum above 1, and{" "}
            <code>dns_ok</code> sits at 1.0 in almost every bucket because <em>something</em> in it
            resolved cleanly. They are drawn as three independent lines for that reason — stacking
            them would be the error the user guide calls "three existential answers wearing a state
            vector".
          </li>
        </ul>

        <h2 id="g-keys">Keyboard</h2>
        <p>
          <kbd>Q</kbd> <kbd>B</kbd> <kbd>E</kbd> <kbd>U</kbd> <kbd>X</kbd> set the verdict ·{" "}
          <kbd>1</kbd>{" "}
          <kbd>2</kbd> <kbd>3</kbd> set confidence · <kbd>Enter</kbd> commits, and again moves on
          · <kbd>N</kbd> next unlabelled · <kbd>?</kbd> this guide.
        </p>
      </div>
    </div>
  );
}
