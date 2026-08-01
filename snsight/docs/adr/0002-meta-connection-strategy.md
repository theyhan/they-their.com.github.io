# ADR-0002: Two independent Meta connections; Instagram authenticates through Facebook Login

- Status: Provisional
- Amends: FR-002, spec 9.2, section 13 Phase 1
- Date: 2026-08-01

## Context

FR-002 asks for "Meta OAuth authentication" with separate connection statuses per platform, as
if one consent flow produced both. It does not. Instagram and Threads are distinct products with
distinct authorization surfaces, and the Instagram side has two mutually exclusive flows:

- *Instagram API with Instagram Login* — simpler, no Facebook Page required, but scoped to the
  authenticated account.
- *Instagram API with Facebook Login* — requires a Facebook Page linked to a Professional
  account, and is the flow that supports reading data about other accounts.
  [Meta's platform overview](https://developers.facebook.com/docs/instagram-platform/) directs
  apps that need data about other Instagram users to the Facebook Login variant.

ADR-0001 keeps Business Discovery in the MVP, which forces the second flow. This is not a
preference: choosing Instagram Login would delete FR-007.

## Decision

1. **`oauth_connections` holds one row per platform per social account**, each with its own
   status, granted scope list, token expiry and error state. There is no combined "Meta
   connected" boolean anywhere in the schema or the UI.
2. **Instagram uses Instagram API with Facebook Login.** Onboarding must therefore explain the
   Facebook Page requirement *before* the consent redirect, because a user without a linked Page
   cannot complete the flow and a post-hoc error is a dead end. Requested scopes are recorded per
   connection rather than assumed globally, since App Review may grant a subset.
3. **Threads uses its own authorization and its own token lifecycle.** A user may connect
   Threads without Instagram, or the reverse. Every dashboard must render correctly with exactly
   one platform connected — this is the default state, not an edge case.
4. **Token expiry is a first-class UI state, not an error.** Each connection stores
   `tokenExpiresAt` and a `status` of `ACTIVE`, `EXPIRING_SOON`, `EXPIRED`, `REVOKED`,
   `INSUFFICIENT_SCOPE` or `RATE_LIMITED`. Sync jobs refuse to run against a non-`ACTIVE`
   connection instead of generating failures, and the dashboard shows the last successful sync
   time from FR-003 alongside the reason data has stopped advancing.
5. **Disconnection is a two-step choice.** Per FR-002 the user picks retain-or-delete for
   historical data. Deletion is a queued job recorded in `audit_logs` (ADR-0005), not a cascade
   delete, so a mis-click is recoverable within the grace window and the deletion itself is
   auditable per spec 10.2.
6. **Scope-gated features degrade, they do not disappear.** FR-004 requires profile visits and
   link actions to display "dynamically based on current API availability". A feature whose
   scope was not granted renders its own empty state naming the missing permission and offering
   reconnection, rather than being hidden.

## Consequences

- App Review covers two submissions with different reviewer instructions and screencasts. This
  is the single largest schedule risk in section 13, and Phase 1 cannot be considered complete
  on the basis of local development alone.
- Onboarding (SCR-001) needs a pre-consent explanation screen and a recovery path for users who
  arrive without a Facebook Page. Budget for it in Phase 1 rather than discovering it in QA.
- Because Facebook Login returns Pages and their linked Instagram accounts, account selection is
  a real screen with potentially many candidates, not an implicit single-account bind.

## Confirming check

The exact scope names and whether a single Facebook Login grant can cover both insights and
Business Discovery for our use case must be confirmed in the App Dashboard before Phase 1 exit.
Scope strings are intentionally held in configuration, not hardcoded at call sites, so that
correcting them is a config change.
