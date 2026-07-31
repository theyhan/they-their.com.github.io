# ADR-0005: Seven tables added to the section 8 data model

- Status: Accepted
- Amends: spec 8
- Date: 2026-08-01

## Context

The section 8 table list omits storage that other sections of the same spec require. Each
addition below is traceable to a requirement that cannot otherwise be satisfied.

## Decision

Add the following to the section 8 core tables.

| Table | Required by | Why the existing tables do not cover it |
| --- | --- | --- |
| `raw_api_payloads` | 8 prose, 9.2 step 4, 15 | Section 8 mandates raw responses in access-controlled storage separated from analytics tables, but lists no table for them. Holds provider, endpoint, API version, request fingerprint, storage pointer and checksum; the body itself goes to object storage, not Postgres. |
| `audit_logs` | 10.2 | "Maintain administrative audit logs" has no home. Records actor, workspace, action, target, IP, user agent and before/after digest for permission changes, disconnections, deletions, exports and share-link access. |
| `report_share_links` | FR-013 | Expiring, password-protected share links need a token, an Argon2 password hash, expiry, revocation state and an access counter. `reports` describes an artifact, not a grant. |
| `classification_corrections` | FR-010 | Users must be able to correct automatic classifications and those corrections may improve later runs. Overwriting `content_classifications` in place would destroy the training signal and the audit trail; corrections are stored as separate rows with the superseded value. |
| `usage_counters` | 11 | Plan limits such as "three account analyses per day" and connected-account caps are unenforceable without counters. Keyed by workspace, metric, and period bucket with a unique constraint so increments are atomic. |
| `alert_rules` | FR-012 | Thresholds for sharp change, breakout detection and per-channel delivery are configuration, not events. `alerts` stores fired instances; the rule that fired them needs its own row, including the email opt-in that FR-012 makes optional. |
| `ai_model_versions` | FR-013, 3.3 | Reports must freeze "the AI-analysis version". Pinning provider, model identifier, prompt version and formula version in one row lets `analysis_runs` reference it, so an old report can state exactly what produced its text. |

Three constraints apply across the model:

1. **Workspace isolation is enforced at the row level.** Every tenant-scoped table carries
   `workspace_id`, and reads go through a repository layer that requires it. Spec 10.2 asks for
   isolation; a shared connection with app-level filtering satisfies it only if the filter cannot
   be forgotten, so the column is non-nullable and indexed first in composite keys.
2. **Insight tables are keyed for idempotent upsert.** `media_insights_daily` and
   `audience_insights_daily` use a unique key over (account, subject, metric, date) so a
   re-delivered job overwrites rather than duplicates, which is how the idempotency requirement
   in 10.3 is realised in storage rather than only in the queue.
3. **Competitor tables physically cannot hold owner-only metrics.** Per ADR-0001,
   `competitor_media_snapshots` has columns for likes and comments only. There is no nullable
   `reach` column awaiting misuse.

## Consequences

- Deletion procedures in 10.2 must cover object storage, not just Postgres, because
  `raw_api_payloads` points outward. A row delete that leaves the payload behind is not a
  deletion.
- `usage_counters` needs a defined reset boundary. Daily counters use UTC date buckets; the plan
  copy in section 11 should say so, since "three per day" is ambiguous across time zones.
- Audit logging is only trustworthy if it is written in the same transaction as the change it
  records. Emitting it from a background listener would allow a change to commit without its log.
