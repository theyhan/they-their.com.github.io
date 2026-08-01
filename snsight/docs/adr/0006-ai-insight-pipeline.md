# ADR-0006: Precomputed AI runs, deterministic confidence, mandatory evidence

- Status: Accepted
- Amends: FR-011, spec 3.3, 9.1, 10.1
- Date: 2026-08-01

## Context

FR-006 and FR-011 are AI-heavy, spec 3.3 requires AI output to be labelled and evidenced, and
FR-013 requires the AI version to be frozen into reports. Yet section 9.1's stack names no model
provider, and section 10.1 caps dashboard load at two seconds on a cache hit — a budget no
language model call fits inside. Section 15 also names overconfident AI conclusions as a key
risk, mitigated by "evidence, confidence, hypotheses, and user-feedback controls".

A model asked to rate its own confidence will report high confidence on three posts. That makes
self-reported confidence the wrong mechanism for the required High/Medium/Low rating.

## Decision

1. **No language model call happens in a request path that renders a dashboard.** Insight
   generation is a queued job writing `analysis_runs`; the dashboard reads completed rows. A
   pending run renders a progress state, per the 10.1 rule that long analyses run
   asynchronously. This is what makes the two-second budget achievable at all.
2. **The provider is behind an interface with a pinned model identifier.** Provider, model,
   prompt version and formula version are recorded in `ai_model_versions` and referenced by every
   run, so a report generated in September can state what produced it even after the default model
   changes. Choosing the vendor is a configuration decision; changing vendors must not require
   touching insight logic.
3. **Confidence is computed by rule, before the model is called, and passed to the renderer, not
   requested from the model.** Inputs: number of posts analysed, days of coverage in the window,
   share of required metrics that were calculable rather than `NotCalculable`, and whether the
   subject is a connected account or a public-data competitor. The published rubric:
   - `HIGH` — 20+ posts, 28+ days of coverage, 90%+ of required metrics calculable, first-party.
   - `MEDIUM` — 8+ posts, 14+ days, 70%+ calculable.
   - `LOW` — anything less, or any competitor-scope analysis, since those rest on public
     estimates per ADR-0001.
4. **A run without evidence is rejected, not published.** Every conclusion row requires at least
   one `analysis_evidence` row referencing the media it rests on. If the model returns a claim
   with no resolvable post reference, the run fails validation and the claim is dropped rather
   than displayed unsupported. Spec 3.3's "show supporting posts" becomes an invariant enforced in
   code, not a template that may render an empty list.
5. **Every run stores its own window and sample size** and the UI displays them next to the text,
   so "three major changes compared with the previous period" is always readable against the
   period it describes.
6. **Causal language is constrained.** Metrics can establish association, not cause. Spec 6.1's
   "content growth contribution" is a statistical association and is labelled as a hypothesis with
   its supporting evidence, never as a cause. Prompt templates are held in version control and
   reviewed for this, since it is the practical form the section 15 mitigation takes.
7. **User feedback on insights is stored** (accept / reject / correct) against the run, giving the
   feedback control that section 15 requires and a measurable quality signal over time.

## Consequences

- Insight freshness lags data freshness. The UI must show the insight's generation time
  separately from the last successful sync in FR-003, or users will read stale narratives as
  current.
- The deterministic rubric will often return `LOW` in the first weeks of a workspace, which is
  correct given Threads has no history before 2024-04-13 and initial sync coverage is limited.
  Onboarding should set that expectation rather than the product appearing weak.
- Costs scale with accounts multiplied by run frequency, so runs are scheduled per plan tier and
  deduplicated by content hash: an unchanged window is not re-analysed.
