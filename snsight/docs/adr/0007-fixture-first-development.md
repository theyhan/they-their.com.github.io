# ADR-0007: A provider interface with a fixture backend, so App Review does not block Phases 2-3

- Status: Accepted
- Amends: section 13, 15, SCR-001
- Date: 2026-08-01

## Context

Section 13 sequences Phase 1 as authentication plus Meta integration plus collection jobs, with
Phases 2-4 building on it, and then notes that "Meta App Review and API permission approval
remain external schedule variables". Taken literally, an unapproved app blocks 8 of the 10-14
weeks. ADR-0002 makes this worse: two submissions, one of which needs a Facebook Page.

SCR-001 already requires a demo dashboard before a user connects an account, so realistic
synthetic data is a product requirement regardless of scheduling.

## Decision

1. **All platform reads go through a `PlatformProvider` interface** returning normalized domain
   models, never raw API shapes. Adapters translate; callers never see a provider-specific field
   name. This is also the section 15 mitigation for API-version change, since a metric rename is
   absorbed in one adapter.
2. **A `FixtureProvider` implements the same interface** over a deterministic seeded generator.
   Given a seed it produces identical accounts, posts and daily insights on every run, so
   snapshots and expectations are stable and a failure is reproducible.
3. **The fixture data reproduces the awkward cases, not the happy path.** It emits posts with
   missing reach, accounts with fewer than 8 posts in a cohort, Threads posts with no per-post
   click data, cohorts below the demographics threshold, gaps where collection failed, and
   Threads history that starts at 2024-04-13. Building against clean data is how
   `NotCalculable` states end up unimplemented and discovered in QA.
4. **Provider selection is configuration** (`SNSIGHT_PROVIDER=fixture|live`), and the demo
   workspace in SCR-001 uses the fixture provider in production. One code path serves both,
   so the demo cannot drift from the real product.
5. **Fixture-sourced data is visibly marked.** A workspace fed by fixtures carries a flag, and
   the UI shows a demo banner. Synthetic numbers must never be mistakable for a real account's
   performance, and no PDF may be exported from a demo workspace without the marking.
6. **Revised phase order.** Phase 1 delivers auth, workspaces, schema, the provider interface and
   the fixture backend; live adapters proceed in parallel with App Review and are swapped in
   behind the flag. Phases 2-3 therefore start on schedule, and the risk is contained to the
   adapters rather than the product.

## Consequences

- The fixture generator is real code needing maintenance. It stays useful because it powers the
  public demo, not only tests.
- A fixture provider proves logic, not integration. Field mappings, pagination, rate-limit
  behaviour and error payloads remain genuinely unverified until a live token exists, and the
  plan must say so rather than treating green local runs as integration confidence. Contract
  checks against recorded live responses are the follow-up, once tokens are available.
- Acceptance criteria in section 14 that depend on real connection cannot be signed off in this
  mode. They are tagged as blocked on App Review so the distinction stays explicit.
