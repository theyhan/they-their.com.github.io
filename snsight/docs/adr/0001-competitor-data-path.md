# ADR-0001: Competitor monitoring is Instagram-only in the MVP

- Status: Accepted
- Amends: spec 3.2, FR-006, FR-007, 12
- Date: 2026-08-01

## Context

FR-006 accepts an `@username` for "an eligible public account" and FR-007 builds competitor
groups, snapshots and trend tracking on top of that input. The spec presents this as
platform-neutral, while section 12 excludes "collection of private metrics through unofficial
scraping" from the MVP.

Two facts constrain this:

1. Instagram offers an official third-party read path, Business Discovery, which returns a
   target account's public profile counts and recent posts with like and comment counts. See
   [Meta's Business Discovery guide](https://developers.facebook.com/docs/instagram-api/guides/business-discovery/)
   and this [reference summary](https://gist.github.com/jameschapman2c/65eff9f54a2d350b17a6ce5127b9fe42).
   It is limited to Business and Creator targets and is queried through the requesting user's
   own account, not by arbitrary username lookup.
2. Threads has no comparable official endpoint. Its Insights API covers the authenticated
   account only. Every available Threads-competitor data source is an unofficial scraper,
   which section 12 excludes.

Building FR-007 as written would therefore require either scraping Threads or silently
producing Threads competitor numbers with no lawful source.

## Decision

1. **Competitor collection is Instagram-only.** `competitor_accounts.platform` accepts
   `INSTAGRAM` in the MVP. `THREADS` is a valid value in the enum but rejected at the service
   boundary with a documented reason, so the schema does not need migrating later.
2. **Threads competitors may be registered but not measured.** A user may add a Threads handle
   to a competitor group as a reference link. Its card renders the `NO_OFFICIAL_SOURCE` empty
   state explaining that Threads exposes no third-party analytics API, per the FR-007 UI
   requirement that collectible scope is communicated clearly. No number is ever displayed.
3. **Owner-only metrics are unrepresentable for competitors, not merely unrendered.** The
   `CompetitorMediaMetrics` type declares no `reach`, `saves`, `shares`, `profileViews` or
   demographic fields, so a future contributor cannot populate them by accident. This enforces
   spec 3.2 in the type system rather than in the view layer.
4. **Non-professional targets get a precise empty state.** When Business Discovery returns no
   data because the target is a personal account, private, or does not exist, the three cases
   are surfaced distinctly (`TARGET_NOT_PROFESSIONAL`, `TARGET_PRIVATE`, `TARGET_NOT_FOUND`).
   FR-006's "eligible" is defined as: a public Instagram Business or Creator account.
5. **Follower counts at post time are estimates.** Competitor follower history begins at
   monitoring start (FR-007), so any follower-normalized competitor metric is derived by
   interpolating between snapshots and carries the `ESTIMATE` label with the interpolation
   distance shown.

## Consequences

- FR-007's comparison tables hold a mix of Instagram rows with data and Threads rows in an
  explanatory empty state. The Threads column set must not be rendered as zeroes.
- The Account Analyzer (FR-006) has two distinct capability tiers: full analysis for connected
  first-party accounts on either platform, and reduced public-data analysis for Instagram
  competitors. The UI must state which tier produced the report, and the PDF must carry the
  same statement.
- Threads competitive intelligence is deferred. If it becomes a launch requirement, section 12
  must be amended to permit a licensed data provider, and that provider's terms reviewed
  against Meta platform policy. That is a product and legal decision, not an engineering one.

## Confirming check

Once the Meta app exists, call Business Discovery against (a) a Business target, (b) a personal
public target, and (c) a private target, and record the exact error payloads. The three empty
states in decision 4 are currently mapped from documented behaviour, not from observed
responses.
