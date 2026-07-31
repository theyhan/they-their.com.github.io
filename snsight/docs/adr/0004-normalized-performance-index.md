# ADR-0004: The 0-100 index is a self-referential percentile within a cohort

- Status: Accepted
- Amends: spec 6.4
- Date: 2026-08-01

## Context

Spec 6.4 requires the unified dashboard to show "platform-native values alongside normalized
0-100 performance indices", but does not define the normalization. The method is not a detail:
percentile-against-a-cohort and min-max-against-a-range produce different rankings from the same
data, and any method needs a baseline population that a new workspace does not have. On the Free
plan (one account, 30 days) there is no peer set at all, and cross-account normalization would
require pooling other customers' data, which workspace isolation in spec 10.2 forbids.

## Decision

1. **The index is a percentile of a post within its own cohort**, where a cohort is
   `(social_account, platform, media_type)` over a trailing window, default 90 days. Nothing is
   normalized against other workspaces, so isolation holds.
2. **The ranked quantity is the platform-native engagement rate from ADR-0003.** Because ranking
   happens inside a single platform and media type, the incomparability problem in 6.4 does not
   arise: an Instagram carousel is ranked against that account's carousels, a Threads text post
   against its text posts. The resulting 0-100 values are then displayed side by side, which is
   what makes them comparable — the index expresses "how this performed for this account", not an
   absolute quality score.
3. **Minimum sample is 8 posts in the cohort.** Below that the index is `NotCalculable` with
   `INSUFFICIENT_SAMPLE`, showing the count present and the count required. A percentile over
   three posts is noise, and presenting it as a score would be exactly the overconfidence that
   section 15 warns about.
4. **Ties share the midrank.** Posts with equal engagement rate receive the same index, computed
   as the mean of the ranks they span, so identical inputs cannot produce different scores.
5. **Posts whose engagement rate is `NotCalculable` are excluded from the cohort** rather than
   treated as zero, and the excluded count is disclosed with the index. Otherwise missing
   permissions would inflate every other post's score.
6. **The index is labelled `CALCULATED`, never `RAW_API_METRIC`**, per spec 3.3, and its tooltip
   states the cohort definition, window, and sample size. A percentile with an undisclosed
   denominator population is not auditable.

## Consequences

- The index is unstable in early life: as a cohort grows from 8 towards 90 days of posts, a
  post's index will move without its underlying metrics changing. The UI must state that the
  index is relative to the current window, and reports (FR-013) must freeze the cohort
  membership alongside the formula version.
- A post can hold a high index and low absolute numbers simultaneously. Both are shown; the
  index never replaces the native value.
- Because cohorts are per media type, accounts that publish one format almost exclusively will
  have one populated cohort and several `INSUFFICIENT_SAMPLE` ones. That is the correct output,
  and the empty state should read as informative rather than broken.
