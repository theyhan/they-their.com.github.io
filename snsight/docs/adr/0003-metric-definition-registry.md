# ADR-0003: Per-platform formulas in a versioned registry; no cross-platform sums

- Status: Accepted
- Amends: spec 6.1, 6.3, FR-003, FR-005
- Date: 2026-08-01

## Context

Spec 6.1 defines one engagement rate for both platforms:

```
(likes + comments + saves + shares + replies + reposts + quotes) / views or reach x 100
```

This cannot be implemented as written. Three problems:

1. It sums metrics that never coexist. `saves` and `shares` are Instagram owner metrics;
   `replies`, `reposts` and `quotes` are Threads metrics. No single post has all seven, so the
   numerator silently omits terms and the resulting percentages are not comparable between
   platforms — which is exactly what spec 6.4 forbids.
2. "views or reach" leaves the denominator to the implementer. Reach and views differ in
   magnitude, so an unstated choice makes the same post score differently in two places in the
   product.
3. Spec 6.3 defines a per-post Threads click-through rate, but Threads exposes `clicks` at
   account level while per-post insights appear limited to views, likes, replies, reposts and
   quotes ([metric reference](https://help.funnel.io/en/articles/9582343-threads-dimensions-and-metrics)).
   A per-post CTR therefore has no numerator.

## Decision

1. **Every metric is defined once, in `src/lib/metrics/registry.ts`, and seeded into
   `metric_definitions`.** A definition carries its key, platform, scope (account or media),
   label kind per spec 3.3, unit, human-readable formula, required inputs, and the API version
   window in which it is available. Application code resolves metrics through the registry; it
   never inlines arithmetic. This is the section 15 mitigation for metric deprecation, and it
   only works if there is no second path.
2. **Engagement rate is split per platform**, replacing the 6.1 formula:
   - Instagram: `(likes + comments + saves + shares) / reach x 100`
   - Threads: `(likes + replies + reposts + quotes) / views x 100`
3. **Denominators are explicit, with a declared precedence and no silent fallback.** Instagram
   engagement rate prefers `reach`; if reach is unavailable for the account's permission set it
   falls back to `views` and the returned value records `denominator: "views"` so the UI can
   disclose it. Threads uses `views` only. A metric computed on a fallback denominator is never
   compared against one computed on the preferred denominator.
4. **A missing or zero denominator yields `NotCalculable` with a reason code**, per spec 6.1's
   closing rule. `NotCalculable` is a distinct variant of the return type rather than `null` or
   `0`, so the type checker forces every call site to handle it. Reasons include
   `MISSING_DENOMINATOR`, `ZERO_DENOMINATOR`, `MISSING_NUMERATOR_INPUT`,
   `METRIC_NOT_AVAILABLE_IN_API_VERSION`, `SCOPE_NOT_GRANTED`, `COMPETITOR_SCOPE_FORBIDDEN` and
   `INSUFFICIENT_SAMPLE`. Each maps to a specific empty-state sentence, satisfying the mandatory
   UX rule that empty states explain the reason.
5. **Threads click-through rate is account-scope only.** Requesting it per post returns
   `NotCalculable` with `METRIC_NOT_AVAILABLE_AT_SCOPE`. Spec 6.3's per-post CTR and FR-005's
   per-post "shares" and "clicks" are amended accordingly; if a live app proves per-post clicks
   exist, the registry's scope field is the only change needed.
6. **Interaction totals are platform-native.** The unified dashboard's common "interactions" KPI
   is the per-platform sum shown per platform, plus the ADR-0004 index for comparison. It is
   never a single number pooling both platforms.

## Consequences

- The dashboard renders four distinct value states per metric: a number, a number with a
  disclosed non-preferred denominator, `NotCalculable` with a reason, and not-yet-synced. All
  four need designs; only the first is usually mocked.
- Metric tooltips (a mandatory UX requirement) are generated from registry definitions, so a
  metric cannot ship without its definition text.
- Historical values keep the formula version that produced them, which is what makes FR-013's
  "freeze the formulas used at report-generation time" achievable.
