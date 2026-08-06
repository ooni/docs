# Quiet-interval labels: the missing negative grain

The third label grain: what lets the event-replay harness report a *false-alarm
rate* rather than only a recall number. Companion to
`docs/data/pipeline-label-corpus` §1.3 (the schema as built), §1.2 (event
labels) and §1.1 (measurement labels).

**Built.** The sampler is `GET /api/v1/labeling/interval_sample` and the
post-commit reveal is `GET /api/v1/labeling/interval_reveal`, both in
`oonimeasurements/routers/labeling.py`. The UI is `src/interval-labeler/`,
served at `/tools/interval-labeler`. The estimator is §5 of
`docs/detector-evaluation.ipynb` in the pipeline repo, alongside the event
replay it supplies the denominator for. This document remains the reasoning;
the two places it was changed in the building are marked below.

## The problem

The event replay prints "false alerts per quiet series-week", but nothing in
the event corpus defines a quiet series-week. `false_positive_event`
(§1.2) does not fill the gap: it covers an *alleged* event that adjudication
rejected, so it is curated, sourced from someone claiming something happened,
and unweighted. It is a must-not-fire regression test, not a denominator.

A rate needs quiet time counted, and quiet time can only be counted if it was
sampled from a frame.

## Structural consequence

This inverts the rule that events carry no sampling columns. Events are
curated, so there is no frame and no weight. Quiet intervals are the opposite:
`sampling_design_id`, `sampling_stratum` and `sampling_weight` are
load-bearing, because the false-alarm rate is an *estimate over a population of
cell-weeks*. The measurement grain's sampling machinery (§1.4, §1.5) applies
here almost unchanged — it is the event grain that is the exception, not this.

## Unit

Match the detector exactly. `event_detector_cusums` keys on
`(cc, asn, domain)` (Architecture §"Storage"), so the row is:

```
(probe_cc, probe_asn, domain) x ISO week
```

Anything coarser measures a different denominator than the harness prints.

## Two strata, one sampler

Neither bootstrap works alone.

**`detector_alerted`** — intervals where the incumbent (or a candidate) fired.
Alone this is circular: it estimates the incumbent's PPV conditional on having
fired, not a rate over quiet time, and a candidate detector's alerts in cells
the incumbent never flagged land on intervals nobody adjudicated, so its false
alarms are structurally invisible. It is the event-grain twin of fitting
likelihood ratios on `screen_positive` only. Fine *as a stratum* with a
recorded screen and a weight. Note the incumbent's non-replayability (§4, "It
does not replay the incumbent") does not block this: the historical alert log
is being used as a screen, not replayed.

**`random_covered`** — a random draw from cell-weeks above a measurement-volume
floor. This is the stratum that supplies the denominator.

Drawn interleaved, blinded, weights recorded, the false-alarm rate comes out as
a weighted (Horvitz–Thompson) estimate per volume band, and the alerted stratum
stops being circular because its weight states how much of the frame it stands
for.

**Changed in the building: the strata partition the frame.** As written above
the two overlap — an alerted cell-week is also in `random_covered`'s
population, so it has two selection probabilities and no single correct weight.
The sampler resolves `random_covered` as the complement of whatever else is
being drawn, so the frame is covered exactly once for any subset of strata, and
the resolved predicate goes into the design spec: a weight can never be
reinterpreted under a partition it was not drawn under.

## Biases, and the guard for each

| Bias | Effect | Guard |
|---|---|---|
| Verification / absence of evidence | "Quiet" is judged from the same OONI data the detector reads, so an unmeasured block reads as quiet — and a *better* candidate that finds subtle real events is charged a false alarm | Name the verdict `quiet_observed`, never `quiet`. It caps the claim at "no interference visible in OONI's data", which is the honest ceiling |
| Frame definition | Uniform draws over all cell-weeks are dominated by cells with too little data for any detector to fire; include them and every detector scores well | Frame = cell-weeks above a volume floor; stratify by volume band and report per band, as `size_band` does for events |
| Anchoring | Worse than in the measurement queue: the alerted stratum *is* the detector's output, so seeing "CUSUM fired" invites rationalising | Blind alert state, changepoints and LoNI until commit; record `blinded` per row (§3.4) |
| Contamination | An unreported real event inside a week called quiet | Biases the rate *upward*, the safe direction. Cross-check draws against the incident list and the adjudicated event corpus; mark overlaps `event_present` rather than dropping them, since dropping silently shrinks the denominator |
| Differential effort | Ambiguous cells get skipped, surviving negatives are the easy ones | Keep `uncertain` first-class and count it, as `unusable` and `scoreable` are counted |
| Non-independence | Cell-weeks autocorrelate in time and correlate across ASNs in a country | Cluster-bootstrap by `(cc, week)`; do not treat cell-weeks as iid |

## Schema sketch

```jsonc
{
  "interval_id": "uuid",
  "probe_cc": "TZ", "probe_asn": 33765, "domain": "telegram.org",
  "window_start": "2026-03-02T00:00:00", "window_end": "2026-03-09T00:00:00",

  "verdict": "quiet_observed",   // quiet_observed | event_present | uncertain | unusable
  "confidence": "probable",
  "rationale": "…",

  "sampling_stratum": "detector_alerted",  // | random_covered | near_miss
  "screen_kind": "incumbent_alert",        // | volume_stratified_random
                                           // | near_miss_score
  "sampling_weight": 41022.5,
  "sampling_design_id": "…",

  "volume_band": "high",                   // derived from the count, never entered
  "measurements_in_window": 3184,          // from the coverage query, not a guess

  "blinded": true,
  "adjudicator": "…", "adjudicated_at": "…",
  "superseded_by": null, "supersede_reason": null
}
```

`volume_band` follows the `ongoing`/`size_band` rule: derived on read, never
stored in a form an analyst can contradict.

## Efficiency

Most random cell-weeks are trivially quiet and carry almost no information per
minute of analyst time. Importance-sample toward near-misses (cells with
partial or high-variance signal that did not alert) and let the weights correct
for it. That is the whole reason to record a design rather than draw uniformly.

**Changed in the building: the near-miss draw is a third stratum**,
`near_miss`, defined as "did not alert, and something in the week scored
blocked-leaning". Making it a stratum rather than a tilt inside `random_covered`
keeps every row's selection probability a single recorded number; it is
optional, and when it is not selected those cells stay in `random_covered`,
which is what makes the partition hold either way.

## UI

Closer to the measurement labeler than to the event editor: a drawn queue, one
cell-week at a time, the observation-outcome timeline from `Timeline.tsx`,
blinded until commit, `Q` / `E` / `U` plus a rationale. Lives in
`src/interval-labeler/`, reusing that timeline (extended with markers for the
revealed changepoints), the labeller shell CSS and the sampler plumbing.

Two things the note did not anticipate and the UI needed. The chart pads the
week on both sides, because a week inside a long-running block has no change in
it and reads as quiet from its own shape alone. And the queue takes an imported
event corpus, flagging cell-weeks a known event overlaps: that is the
contamination cross-check, and it is external ground truth rather than detector
output, so showing it before commit is not unblinding.

## Sampler

`GET /api/v1/labeling/interval_sample`, the sibling endpoint this note asked
for, recording the predicate and population before drawing as W2 does for
measurements. Two additions the frame turned out to need: it snaps to whole ISO
weeks, since a partial week is a shorter observation window rather than a
smaller one, and it defaults to the domains the detector actually runs on,
since counting quiet time in cells nothing watches flatters every detector for
free. Both are in the spec, so both are in the design id.
