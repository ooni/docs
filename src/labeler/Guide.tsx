import { useEffect, useRef } from "react";

export interface GuideProps {
  open: boolean;
  anchor: string | null;
  onClose: () => void;
}

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
          <span className="eyebrow">Adjudication guide</span>
          <button className="btn" ref={closeBtnRef} onClick={onClose}>
            Back to labelling <kbd style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: 0.6 }}>Esc</kbd>
          </button>
        </div>

        <h1>How this works</h1>
        <p className="lede">
          You are building the yardstick the censorship pipeline gets measured against. This explains
          what each judgment means, how to read the evidence, and why some of the interface
          deliberately withholds things from you.
        </p>

        <div className="toc">
          <span className="eyebrow">Contents</span>
          <ol>
            <li><a href="#g-job">What you are actually deciding</a></li>
            <li><a href="#g-questions">The three questions, in order</a></li>
            <li><a href="#g-dns">Reading the DNS answer set</a></li>
            <li><a href="#g-verdicts">The five judgments</a></li>
            <li><a href="#g-mechanism">Naming the mechanisms</a></li>
            <li><a href="#g-confidence">Confidence and rationale</a></li>
            <li><a href="#g-blinding">Why the verdict is sealed</a></li>
            <li><a href="#g-design">Sampling, weights and the design ID</a></li>
            <li><a href="#g-export">What happens to your labels</a></li>
            <li><a href="#g-keys">Keyboard reference</a></li>
          </ol>
        </div>

        <h2 id="g-job"><span className="n">01</span> What you are actually deciding</h2>
        <p>
          One sentence: <b>you are judging a single measurement, using only what was available when it
          was taken.</b> You are not deciding whether a site is blocked in a country.
        </p>
        <p>
          That distinction does most of the work. A measurement taken during a well-documented national
          block can still be a perfectly clean <code>ok</code> — because the probe was on an unaffected
          network, or used an offshore resolver, or ran before the block landed. Those rows are the most
          valuable in the corpus and the easiest to get wrong.
        </p>
        <div className="callout warn">
          <span className="eyebrow">The failure mode to watch for in yourself</span>
          <p>
            If you notice you are reaching for <code>blocked</code> because you know the country was
            blocking that week, stop. That is incident adjudication wearing a measurement's clothes, and
            it poisons every rate computed from these labels afterwards.
          </p>
        </div>

        <h2 id="g-questions"><span className="n">02</span> The three questions, in order</h2>
        <h3>Q1 — Is this row judgeable at all?</h3>
        <p>
          Missing control, malformed response, truncated capture, nonsense timestamps. Mark it{" "}
          <kbd>X</kbd> and move on. Do this first and do it ruthlessly — every minute spent agonising
          over a broken row is a minute not spent on a real one.
        </p>
        <h3>Q2 — Did the connection fail, and how?</h3>
        <p>
          Separate <i>failure</i> from <i>interference</i>. A timeout where the control also timed out
          is the site being down. A reset against a working control is something interfering. This is
          where most disagreement between adjudicators lives, so it is worth slowing down here
          specifically.
        </p>
        <h3>Q3 — Is the interference deliberate?</h3>
        <p>
          A blockpage, an injected DNS answer, a reset that lands consistently at the same point in the
          handshake: deliberate. Transient, single probe, no pattern in the ±6h strip: probably just
          down, at <code>uncertain</code> confidence.
        </p>

        <h2 id="g-dns"><span className="n">03</span> Reading the DNS answer set</h2>
        <p>
          DNS is shown as a <b>set comparison per hostname</b>, not field by field. A resolution
          returning four addresses produces four rows in the pipeline; what matters is whether the
          probe's set of answers relates to the control's set, so they are collapsed and compared
          together.
        </p>
        <pre>
          <code>{`answers 1 probe / 4 control   IP overlap 0 of 1   ASN overlap 0 of 1   org overlap 0 of 1

SEEN BY    ADDRESS          ASN        ORGANISATION      GEO
probe      41.222.10.8      AS37693    TunisiaNet        TN
control    104.16.132.229   AS13335    Cloudflare        US
control    104.16.133.229   AS13335    Cloudflare        US`}</code>
        </pre>
        <p>
          Only addresses the control's <i>own DNS query</i> returned count on the control side. The
          control also connects to the probe's answers over TCP and TLS, producing control rows with{" "}
          <code>dns_success</code> unset — those are the probe's answers being probed, not an
          independent resolution, and counting them would read an injected address back as agreement.
        </p>
        <p>
          The three overlap figures exist because <b>exact IP comparison on its own is misleading</b>.
          CDNs and geo-DNS rotate addresses constantly and legitimately, so "the probe got a different
          IP than the control" is routine and means almost nothing by itself. Read them together:
        </p>
        <table>
          <tbody>
            <tr><th>Pattern</th><th>What it usually means</th></tr>
            <tr>
              <td>IP <b>no</b>, ASN <b>yes</b></td>
              <td>Same network, different edge node. Normal CDN behaviour. Not evidence of anything.</td>
            </tr>
            <tr>
              <td>IP <b>no</b>, ASN <b>no</b>, org <b>yes</b></td>
              <td>Same operator across ASNs. Still ordinary.</td>
            </tr>
            <tr>
              <td>No overlap at any level, probe answer in the probe's own country</td>
              <td>The shape of DNS poisoning. Look at what is hosted there.</td>
            </tr>
            <tr>
              <td>No overlap, probe answer flagged <code>bogon</code></td>
              <td>Blackholing. Rarely anything else.</td>
            </tr>
            <tr>
              <td>Probe resolved nothing, control resolved fine</td>
              <td>
                Check the failure string — <code>nxdomain</code> against a working control is a strong
                signal; a timeout is much weaker.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Rows the probe saw and the control did not are highlighted, because those are the answers you
          have to account for. Control-only rows are left plain: a control returning more addresses than
          a single probe query is completely normal.
        </p>
        <p>
          Below DNS, each endpoint gets its own <span className="swatch s-probe" />probe /{" "}
          <span className="swatch s-control" />control column for TCP, TLS and HTTP, with diverging
          fields marked <span className="swatch s-diverge" />. Those layers genuinely are per-address, so
          they stay row-wise.
        </p>

        <h2 id="g-verdicts"><span className="n">04</span> The five judgments, and the mechanisms</h2>
        <div className="verdict blocked">
          <h4><kbd>B</kbd> Blocked</h4>
          <p>
            Someone deliberately prevented this connection. You should be able to name the mechanism —
            or mechanisms: co-occurring techniques get one path each.
          </p>
          <p className="ex">
            blockpage returned · injected DNS answer · reset at the SNI · certificate from an
            interception middlebox
          </p>
        </div>
        <div className="verdict down">
          <h4><kbd>D</kbd> Down</h4>
          <p>
            It failed, but not because anyone made it fail. The control usually failed too, or the
            failure is the ordinary kind.
          </p>
          <p className="ex">control also timed out · server returned 5xx to both sides · no IPv6 connectivity on the probe</p>
        </div>
        <div className="verdict ok">
          <h4><kbd>O</kbd> OK</h4>
          <p>
            It worked. Also the correct call for a measurement inside a known incident window that
            simply was not affected.
          </p>
          <p className="ex">answers overlap the control · handshake completed · expected content returned</p>
        </div>
        <div className="verdict un">
          <h4><kbd>U</kbd> Can't call it</h4>
          <p>
            The evidence is real but genuinely ambiguous. This is a legitimate outcome, not a cop-out —
            forcing a call on an ambiguous row damages the calibration in exactly the place calibration
            matters most.
          </p>
        </div>
        <div className="verdict unus">
          <h4><kbd>X</kbd> Unusable row</h4>
          <p>
            Not a judgment about the network — a judgment about the data. Missing control, malformed
            capture, broken measurement. Distinct from <i>can't call it</i>, and worth keeping distinct:
            a stratum that is 40% unusable is telling you something about the pipeline.
          </p>
        </div>

        <h3 id="g-mechanism">Naming the mechanisms</h3>
        <p>
          A <code>blocked</code> call requires <b>at least one</b> mechanism: <i>how</i> the
          interference was implemented, as distinct from whether it happened. Each comes from a fixed
          taxonomy of dot-separated paths, <code>{"<layer>.<action>.<qualifier>"}</code>.
        </p>
        <p>
          <b>More than one is normal, not an edge case.</b> Censors run defence-in-depth: DNS injection
          alongside SNI-triggered resets is a routine deployment, and a measurement can show both. Add
          one path per distinct technique the evidence in front of you supports — not one per symptom of
          the same technique. The tool collapses redundant pairs for you (adding{" "}
          <code>tls.mitm.self_signed</code> replaces a bare <code>tls.mitm</code>, since a prefix means
          "not narrowed further"). Two paths in the same layer are allowed and occasionally right — an
          injected A record next to an NXDOMAIN on the AAAA — but then the rationale must say which
          evidence supports which, because same-layer pairs are also what over-eager labelling looks
          like.
        </p>

        <div className="callout">
          <span className="eyebrow">Every prefix is a valid label</span>
          <p>
            <code>tls.mitm.self_signed</code>, <code>tls.mitm</code> and bare <code>tls</code> are all
            legitimate. Picking a shorter path means "interference here, not narrowed further" — so the
            requirement is always satisfiable, and you never have to invent a specificity you do not
            have. Guessing a leaf you are not sure of is worse than picking its parent.
          </p>
        </div>

        <p>
          <b>Why not just record which rule fired?</b> Because the labels exist to measure the rules. A
          corpus labelled <code>bogon_not_in_ctrl</code> can only tell you that rule reproduces itself.
          Rule ids also change as rules split — every label referencing a split rule would need
          re-adjudicating — and they are not how anyone actually describes a measurement. You would say
          "DNS injection returning an address in the ISP's own range", not a rule id. So labels use this
          taxonomy, predictions use rule ids, and comparing them is the whole point. It is also why the
          corpus survives a scoring rewrite.
        </p>

        <p>
          The <code>layer</code> is where the interference <i>manifested</i> — observed, not inferred.
          The <code>qualifier</code>'s meaning depends on the action it follows: the trigger for a reset,
          the payload for an injection, the certificate class for a MITM. It is a taxonomy, not a
          grammar; do not assume the third segment means the same thing everywhere.
        </p>

        <table>
          <tbody>
            <tr><th>Path</th><th>Meaning</th></tr>
            <tr><td><code>dns.injection.blockpage</code></td><td>answer is a known blockpage address</td></tr>
            <tr><td><code>dns.injection.bogon</code></td><td>answer is a bogon or provider-internal address</td></tr>
            <tr><td><code>dns.injection.other</code></td><td>injected, but neither of the above</td></tr>
            <tr><td><code>dns.nxdomain</code></td><td>NXDOMAIN for a name that resolves elsewhere</td></tr>
            <tr><td><code>dns.refused</code> · <code>dns.timeout</code></td><td>REFUSED · no answer</td></tr>
            <tr><td><code>tcp.reset</code></td><td>RST during connection establishment</td></tr>
            <tr><td><code>tcp.timeout</code> · <code>tcp.refused</code></td><td>SYN unanswered · RST in response to SYN</td></tr>
            <tr><td><code>tls.reset.sni</code></td><td>RST after ClientHello, triggered by the server name</td></tr>
            <tr><td><code>tls.reset.other</code></td><td>RST during handshake, trigger unidentified</td></tr>
            <tr><td><code>tls.timeout</code></td><td>handshake stalls</td></tr>
            <tr><td><code>tls.timeout.sni</code></td><td>handshake stalls after the ClientHello, triggered by the server name</td></tr>
            <tr><td><code>tls.mitm.self_signed</code></td><td>presented certificate is self-signed</td></tr>
            <tr><td><code>tls.mitm.ca_signed</code></td><td>validly signed, but for an unexpected name or issuer</td></tr>
            <tr><td><code>http.blockpage</code> · <code>http.redirect</code></td><td>block page served · redirect to one</td></tr>
            <tr><td><code>http.error</code></td><td>status-code refusal (403 and similar)</td></tr>
            <tr><td><code>http.reset.host</code></td><td>RST after the request line or Host header</td></tr>
            <tr><td><code>http.timeout</code></td><td>no response</td></tr>
            <tr><td><code>ip.unreachable</code></td><td>ICMP unreachable or no route</td></tr>
          </tbody>
        </table>

        <p>
          Three nodes are marked in the dropdown because the evidence to support them is not in this
          view: <code>tls.throttle.sni</code> and <code>http.throttle.host</code> are not measurable with
          the data OONI collects today, and <code>ip.prefix_null_route</code> needs co-affected targets to
          distinguish it from a single-host failure. They exist so the vocabulary is complete; pick one
          only if you have evidence from somewhere else.
        </p>

        <h2 id="g-confidence"><span className="n">05</span> Confidence and rationale</h2>
        <p>
          <b>Confidence</b> (<kbd>1</kbd> certain, <kbd>2</kbd> probable, <kbd>3</kbd> uncertain) records
          how sure <i>you</i> are. It is used later to test how much any conclusion depends on judgment
          calls: if a rule's numbers move sharply when the <code>probable</code> labels are dropped, that
          rule's evidence turns out to be adjudicator-dependent, and it gets flagged as such. So being
          honest about uncertainty is more useful than being confident.
        </p>
        <p>
          <b>Rationale</b> is required for everything except <kbd>X</kbd>. One sentence naming the
          specific evidence:
        </p>
        <pre>
          <code>{`Control returned 3 Cloudflare A-records; probe got a single answer in
AS12345, in-country, serving the ISP's standard notice page.`}</code>
        </pre>
        <p>
          Not "looks blocked". The rationale is what makes a disagreement resolvable six months later,
          and what makes a label defensible if it ever ends up in front of someone who wants to argue
          with it.
        </p>

        <h2 id="g-blinding"><span className="n">06</span> Why the verdict is sealed</h2>
        <p>
          Until you commit, the panel on the right hides what the pipeline concluded — the LoNI values,
          the top analysis, the anomaly and confirmed flags. After you commit, all of it appears.
        </p>
        <p>
          This is not ceremony. These labels exist to <i>evaluate</i> the pipeline. If you see its answer
          first, your judgment is anchored to it, and every statistic computed from these labels is
          inflated by an amount nobody can measure afterwards. Blinding costs you one extra click and
          removes the whole problem.
        </p>
        <p>
          The reveal afterwards is genuinely useful — it is how rule bugs get found — and if it changes
          your mind, just re-label and commit again. The old label is superseded, not erased, and both
          travel in the export.
        </p>
        <div className="callout">
          <span className="eyebrow">On the agree / disagree flag</span>
          <p>
            After commit you will see whether the pipeline agreed with you. Treat that as a diagnostic,
            not a score. A high agreement rate is not the goal; if it ever starts creeping toward
            perfect, the most likely explanation is that blinding has stopped working somewhere.
          </p>
        </div>

        <h2 id="g-design"><span className="n">07</span> Sampling, weights and the design ID</h2>
        <p>
          You are not labelling a random slice of OONI data, and you should not want to. Blocking is
          rare enough per-measurement that a uniform sample would be almost entirely uninteresting rows.
          So the queue is drawn in <b>strata</b>: heavily from measurements that look interesting,
          lightly but never zero from the ones that do not.
        </p>
        <table>
          <tbody>
            <tr><th>Stratum</th><th>Share of queue</th><th>Why it exists</th></tr>
            <tr>
              <td><code>screen_positive</code></td><td>40%</td>
              <td>Rows the pipeline finds blocked-leaning. Where most positives come from.</td>
            </tr>
            <tr>
              <td><code>screen_negative</code></td><td>35%</td>
              <td>Rows it does not. The only thing that bounds how much blocking the pipeline is <i>missing</i>.</td>
            </tr>
            <tr>
              <td><code>fingerprint_match</code></td><td>15%</td>
              <td>Exact blockpage matches. High-precision positives, tagged so they can be excluded from later checks.</td>
            </tr>
            <tr>
              <td><code>incident_window</code></td><td>10%</td>
              <td>Inside a known event. Remember §01 — many of these are honestly <code>ok</code>.</td>
            </tr>
          </tbody>
        </table>
        <p>
          The share is the fraction of <i>your queue</i>, not a sampling rate: ask for 50 rows across the
          first two strata and you get 27 and 23. Shares are normalised over whichever strata you pick,
          so dropping one hands its place to the others rather than shrinking the queue.
        </p>
        <p>
          Rows from different strata are <b>interleaved</b> in your queue, and the stratum is never
          displayed. A queue that ran all the interesting rows first would tell you which stratum you
          were in, and that is most of the way to telling you the answer.
        </p>

        <h3>What <code>sampling_weight</code> means</h3>
        <p>
          Each label carries a weight: how many production measurements that one row stands for. It is{" "}
          <b>measured, not declared</b> — the eligible population divided by how many rows were actually
          drawn from it. Draw 27 rows out of five million eligible and each one carries a weight of about
          185,000.
        </p>
        <p>
          That is what converts a deliberately lopsided corpus back into statements about the real world.
          Without it, the numbers describe how the sample was drawn rather than what is happening on the
          network. And because the weight comes from the draw rather than from a setting, it cannot drift
          away from what the query did: shrink the queue and every weight rises to match.
        </p>

        <h3>What <code>design_id</code> means</h3>
        <p>
          A <b>design</b> is the complete specification of a draw: which strata, at what rates, over what
          date frame, scoped to which country, domain and tests. The <code>design_id</code> is that
          specification's name — and you do not choose it. It is a fingerprint computed from the
          specification itself, so it looks like <code>d6cfcc19df4</code> and appears in the left rail
          after you draw.
        </p>
        <p>Deriving it rather than typing it does three things:</p>
        <ol>
          <li>
            <b>The weights keep their meaning.</b> <code>weight: 10</code> means "one in ten of the
            population <i>this design</i> defines". Scope a design to <code>web_connectivity</code> in
            Italy and that sentence points at a different population than an unscoped one — same number,
            different claim. Because the scope is part of the fingerprint, those two can never end up
            sharing an id.
          </li>
          <li>
            <b>The draw is reproducible.</b> The id is mixed into the hash that selects rows, so the same
            settings return the same rows in the same order. Two people can draw an identical queue and
            compare judgments. Raising the row count extends the same list rather than reshuffling it.
          </li>
          <li>
            <b>Nothing is left to discipline.</b> Change a rate, a stratum, the tests, the country, the
            dates — the id changes on its own. There is no way to reuse one across different parameters,
            which used to be the single mistake here that failed silently and could not be repaired
            afterwards.
          </li>
        </ol>

        <h3>Replicate</h3>
        <p>
          The one thing a fingerprint cannot give you is a <i>second, different</i> sample from the same
          settings — identical settings mean an identical draw, by design. That is what <b>replicate</b>{" "}
          is for.
        </p>
        <p>
          Leave it at 1 normally. Raise it when you have worked through a queue and want fresh rows from
          the same population: replicate 2 is an independent draw that will not repeat what replicate 1
          already covered. It is part of the specification, so it produces its own id and its own
          recorded design.
        </p>
        <div className="callout">
          <span className="eyebrow">Rule of thumb</span>
          <p>
            <b>Same settings, same replicate</b> — same rows. Use this when two people need to label the
            same queue.
            <br />
            <b>Same settings, next replicate</b> — new rows, same population, weights still comparable.
            <br />
            <b>Different settings</b> — new design, new id, different population. Weights are only
            comparable within a design.
          </p>
        </div>

        <h3>Why the frame is not randomised for you</h3>
        <p>
          It would be tempting to have each draw pick its own random date window, for variety. It is the
          wrong lever, for two reasons.
        </p>
        <p>
          It gives you <i>less</i> variety, not more: every row in the draw would come from the same
          random week, where a wide frame gives you a queue where each row is from a different point in
          time. And it would quietly corrupt the weights. A row's chance of reaching you would become{" "}
          <i>(chance its window was picked) × (its stratum rate)</i>, but only the second half is knowable
          to the sampler, so every weight would be wrong by the number of windows that could have been
          chosen — silently, and in the direction that understates how much production data each label
          speaks for.
        </p>
        <p>
          So: widen the frame for variety, raise the replicate for fresh rows. If you do want each session
          focused on its own period, that is a real design and it is expressible — but the window choice
          has to be part of the specification, with its probability folded into the weight, not an
          accident of when you clicked Draw.
        </p>

        <h3>Choosing tests</h3>
        <p>
          The test list shows real volume in your frame, biggest first, so you can see what is worth your
          time. <code>web_connectivity</code> is the bulk of OONI's data and the sensible place to start.
          The <code>screen+</code> figure tells you whether a draw will actually return anything at all: a
          stratum with fewer eligible rows than its share of the queue comes back short, and is flagged{" "}
          <code>exhausted</code> in the recorded design.
        </p>

        <h2 id="g-export"><span className="n">08</span> What happens to your labels</h2>
        <p>
          They stay in this browser. Nothing is written back to OONI, there is no server-side corpus, and
          clearing your browser data deletes them. <b>Export at the end of every session</b> — the button
          is at the bottom of the left rail — and send the JSON wherever your team collects it.
        </p>
        <p>
          The export carries the sampling designs alongside the labels, which is what keeps the weights
          reconstructable by someone who was not there when you drew them. Superseded labels ride along
          too, deliberately: a changed judgment is information about how hard the row was.
        </p>
        <p>
          Downstream, these labels become likelihood ratios — statements of the form "this evidence
          pattern is about 40 times more likely when something is truly blocked than when it is not",
          each with an interval and a stated sample size. That is why the rationale, the confidence, and
          the honest <code>U</code> and <code>X</code> calls all matter: they are what those numbers are
          made of.
        </p>
        <p>
          One correction is applied for you at fitting time: labels are clustered per probe, using the
          credentialed <code>probe_id</code> where the measurement carries one and <code>report_id</code>{" "}
          otherwise. An incident measured forty times by one probe counts once, so a chatty probe cannot
          inflate a rule's evidence. Label whatever the queue gives you; deduplication is not your job.
        </p>

        <h2 id="g-keys"><span className="n">09</span> Keyboard reference</h2>
        <p>
          The judgment panel is a stepped flow — <b>Verdict → Mechanisms → Confidence → Rationale →
          commit</b> — and every answer advances it, so a full label never needs the mouse. The ribbon
          above the buttons shows where you are. A typical blocked row is:
        </p>
        <p>
          <kbd>B</kbd> → type <code>inj</code> <kbd>⏎</kbd> (adds the highlighted path) <kbd>⏎</kbd>{" "}
          (empty input: move on) → <kbd>1</kbd>–<kbd>3</kbd> or <kbd>⏎</kbd> to keep <i>probable</i> →
          one line of rationale <kbd>⏎</kbd> (commits) → <kbd>⏎</kbd> (next unlabelled row).
        </p>
        <table>
          <tbody>
            <tr><th>Key</th><th>Action</th></tr>
            <tr>
              <td><kbd>B</kbd> <kbd>D</kbd> <kbd>O</kbd> <kbd>U</kbd> <kbd>X</kbd></td>
              <td>Set the verdict and advance (to Mechanisms when blocked, else to Confidence)</td>
            </tr>
            <tr><td>typing, <kbd>↑</kbd> <kbd>↓</kbd></td><td>Filter and highlight in the mechanism list</td></tr>
            <tr><td><kbd>⏎</kbd> in mechanism box</td><td>Add the highlighted path; on an empty box, advance</td></tr>
            <tr><td><kbd>Tab</kbd> in mechanism box</td><td>Add the highlighted path and keep typing (for a second one)</td></tr>
            <tr><td><kbd>⌫</kbd> in empty mechanism box</td><td>Remove the last chip</td></tr>
            <tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>Certain / probable / uncertain (advances when on the Confidence step)</td></tr>
            <tr><td><kbd>⏎</kbd> in rationale</td><td>Commit and reveal (<kbd>Shift</kbd>+<kbd>⏎</kbd> for a newline)</td></tr>
            <tr><td><kbd>⏎</kbd> after commit</td><td>Next unlabelled row</td></tr>
            <tr><td><kbd>M</kbd> / <kbd>R</kbd></td><td>Jump to Mechanisms / Rationale</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Step back (or close this guide)</td></tr>
            <tr><td><kbd>N</kbd></td><td>Next unlabelled row</td></tr>
            <tr><td><kbd>?</kbd></td><td>Open this guide</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
