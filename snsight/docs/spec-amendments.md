# Spec amendments

Changes the ADRs make to SNSight specification v1.0 EN (2026-08-01). Where an ADR and the spec
disagree, the ADR governs implementation until the spec is revised.

| Spec section | Reads today | Amended to | ADR |
| --- | --- | --- | --- |
| 3.2 Competitor accounts | Public data collection implied for both platforms | Instagram only, via Business Discovery; Threads competitors are reference links with no metrics | [0001](adr/0001-competitor-data-path.md) |
| 6.1 Post engagement rate | One formula summing IG and Threads interactions over "views or reach" | Two platform-specific formulas with declared denominator precedence | [0003](adr/0003-metric-definition-registry.md) |
| 6.3 Click-through rate | Per-post `link clicks / views` | Account scope only; per-post returns `NotCalculable` | [0003](adr/0003-metric-definition-registry.md) |
| 6.4 Comparison rules | "Normalized 0-100 performance indices", method unspecified | Midrank percentile within `(account, platform, media_type)` over 90 days, minimum 8 posts | [0004](adr/0004-normalized-performance-index.md) |
| 8 Data model | 20 core tables | Plus `raw_api_payloads`, `audit_logs`, `report_share_links`, `classification_corrections`, `usage_counters`, `alert_rules`, `ai_model_versions` | [0005](adr/0005-data-model-additions.md) |
| 9.1 Stack | No AI provider named | Provider-agnostic interface with a pinned model version recorded per run | [0006](adr/0006-ai-insight-pipeline.md) |
| 13 Phase 1 | Meta integration precedes analytics work | Provider interface plus fixture backend in Phase 1; live adapters run parallel to App Review | [0007](adr/0007-fixture-first-development.md) |
| FR-002 | "Meta OAuth authentication" as one flow | Two independent connections; Instagram requires Facebook Login and a linked Page | [0002](adr/0002-meta-connection-strategy.md) |
| FR-005 | Per-post Threads shares and clicks | Removed from post scope pending live confirmation | [0003](adr/0003-metric-definition-registry.md) |
| FR-006 | "@username of an eligible public account" | Eligible means a public Instagram Business or Creator account; three distinct ineligibility states | [0001](adr/0001-competitor-data-path.md) |
| FR-011 | AI states its own confidence | Confidence computed by rule from sample size, coverage and metric availability | [0006](adr/0006-ai-insight-pipeline.md) |

## Platform limits that reach the UI

These are not amendments but constraints the interface must express, drawn from the sources cited
in the ADRs:

- Threads history does not predate 2024-04-13, so trend windows and "same period last year"
  comparisons (FR-003) are unavailable for Threads at launch and must be disclosed rather than
  rendered empty.
- Threads follower demographics require at least 100 followers, so FR-005's demographic views
  need a below-threshold state.
- Instagram competitor data covers profile counts and per-post likes and comments only. Reach,
  saves, shares and demographics are first-party only, per spec 3.2.
- Instagram `views` has replaced older impression-style metrics in recent API versions, which is
  why `metric_definitions` carries availability windows per API version instead of assuming a
  single current shape.

## Open questions for the product owner

1. Is Instagram-only competitor monitoring acceptable for launch, or should section 12 be
   reopened to permit a licensed Threads data source? (ADR-0001)
2. Which AI provider, and what monthly cost ceiling per workspace tier? (ADR-0006)
3. Do the section 11 plan limits reset on UTC days or workspace-local days? (ADR-0005)
4. Free plan allows "one connected account" — one per workspace total, or one per platform?
   ADR-0002 makes single-platform operation normal, so the wording matters commercially.

## Compliance note

API behaviour summarised in these documents was rephrased from the linked public sources for
licensing compliance. Items marked `Provisional` rest on documentation rather than observed
responses from a live Meta app.
