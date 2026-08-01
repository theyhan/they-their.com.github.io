# SNSight

Instagram and Threads integrated insights platform. This repository currently holds the Phase 1
foundation: the decisions that resolve conflicts in the specification, the data model, the metric
engine, and a fixture-backed platform provider that lets Phases 2-3 proceed while Meta App Review
is outstanding.

There is no UI yet. See "What exists" below for the honest state of things.

## Read this first

The specification (v1.0 EN) contains requirements that no official API can satisfy, and one metric
formula that cannot be implemented as written. Those are resolved in
[`docs/adr/`](docs/adr/README.md), with a section-by-section map in
[`docs/spec-amendments.md`](docs/spec-amendments.md). Four decisions change product scope and need
sign-off:

1. **Competitor monitoring is Instagram-only.** Threads publishes no API for accounts you do not
   own, and the spec excludes scraping. Threads competitors can be registered as reference links
   but display no metrics. ([ADR-0001](docs/adr/0001-competitor-data-path.md))
2. **Instagram must use the Facebook Login flow**, which requires users to have a Facebook Page
   linked to their professional account. This is forced by Business Discovery, so it follows from
   decision 1. ([ADR-0002](docs/adr/0002-meta-connection-strategy.md))
3. **Engagement rate is two formulas, not one.** Spec 6.1 summed Instagram-only and Threads-only
   interaction types over an ambiguous denominator. ([ADR-0003](docs/adr/0003-metric-definition-registry.md))
4. **Threads click-through rate is account-scope only.** Per-post clicks have no numerator.
   ([ADR-0003](docs/adr/0003-metric-definition-registry.md))

## What exists

| Area | State |
| --- | --- |
| ADRs and spec amendments | Complete, awaiting product sign-off |
| `prisma/schema.prisma` | All spec section 8 tables plus the seven additions in ADR-0005. **Never parsed by the Prisma CLI** - see Verification |
| `src/lib/metrics/` | Registry, per-platform formulas, performance index, confidence rubric. Verified by execution |
| `src/lib/platform/` | Provider contract, error translation, deterministic fixture backend. Verified by execution |
| `src/lib/dashboard/` | Unified dashboard view model, formatting, drill-down resolution. Verified by execution |
| `src/lib/design/` | Colour and type tokens, with WCAG contrast enforced by a check. Verified by execution |
| `src/lib/auth/` | Roles and capabilities, password policy, login throttling, sessions, onboarding. Verified by execution |
| `src/lib/auth/service.ts`, `current-user.ts` | Sign-in, sign-up, session and audit orchestration. **Never run** - needs a database |
| `src/app/(auth)/`, `src/middleware.ts` | Sign-in and sign-up screens, server actions, route guard. Types check against stubs only |
| `src/components/dashboard/`, `src/app/` | React rendering of the view model. Transpiles; **types unverified** - React is not installed |
| `preview/` | Static render of the dashboard for review before install |
| `prisma/seed.ts` | Seeds `metric_definitions` from the code registry. Unrun |
| Auth, queue, live Meta adapters, AI pipeline, other screens | Not started |

## Reviewing the dashboard without installing

`npm run preview` writes a browsable static site to `preview/`, generated from the same view model
the React components consume:

- `preview/index.html` - landing page, with what to look at and how much is verified
- `preview/dashboard-7d.html`, `-30d.html`, `-90d.html` - the same account across three date ranges,
  with drill-downs pre-resolved into expandable sections so the pages need no JavaScript
- `preview/dashboard.md` - the 30-day render as text, for reviewing copy in a plain file viewer

The three ranges are worth comparing: 7 days yields `LOW` AI confidence and 30 or 90 days yields
`HIGH`, because the rubric reads the evidence base rather than asking a model how sure it feels.

The current render exercises all four metric states - 244 plain values, 4 disclosed view-fallbacks,
3 not-calculable and 3 not-collected - which is what the awkward fixture data is for.

## Design rules worth knowing before editing

- **A metric that cannot be computed is a value, not an absence.** Every calculator returns
  `MetricValue`, a union of a number and `NotCalculable` with a reason code. The compiler forces
  call sites to handle both, which is how spec 6.1's "Not Calculable" reaches the screen instead of
  becoming a zero. Empty-state copy lives beside the reason codes in `types.ts`.
- **Metrics are defined once**, in `src/lib/metrics/registry.ts`, and the database table is seeded
  from it. Do not inline arithmetic in a component or a query.
- **Competitor types cannot hold owner-only metrics.** `CompetitorMediaMetrics` has two fields,
  likes and comments. Spec 3.2 is enforced by the type, not by remembering to omit columns.
- **A fallback denominator travels with its value.** If an Instagram rate was computed on views
  because reach was unavailable, `isFallbackDenominator` says so and the UI must disclose it.
- **The fixture provider generates awkward data on purpose**: missing reach, zero-view posts,
  cohorts below the scoring minimum, a two-week collection gap, and a Threads history that starts
  at the platform epoch. Building against clean data is how those states end up unimplemented.
- **The mandatory UX rules live in the view model, not in JSX.** Labels, tooltips, empty-state
  sentences, change glyphs and drill-down references are fields on `MetricDisplay`, `ChangeIndicator`
  and `DrilldownRef`, so they can be checked by execution. Components render those decisions; they do
  not make them. A rule that exists only inside a component is a rule nobody checks.
- **Registry `description` text is user-facing.** It becomes the metric tooltip verbatim, so internal
  notes about spec sections and ADRs belong in the `notes` field instead.
- **Nothing is pooled across platforms unless the definitions match.** Post counts and followers are
  combined; views, reach, interactions and engagement rates stay per platform, with the performance
  index as the only cross-platform comparator (spec 6.4, ADR-0004).
- **Colours live in `src/lib/design/tokens.ts` and nowhere else.** Every pair the UI renders is
  registered there and checked against its WCAG minimum, and `globals.css` is generated from it by
  `npm run tokens:css`. A hand-edited colour in a component is a colour nobody verified.
- **Authorisation is decided only in `src/lib/auth/permissions.ts`.** Ask `can(role, capability)` or
  `authorize(...)`. Comparing role strings at a call site is how a permission gets missed when a fifth
  role appears.
- **Login identity is not data access.** `auth_accounts` proves who someone is; `oauth_connections`
  grants access to Instagram or Threads data. Nothing joins them, and sign-in never requests an
  insights scope (ADR-0008).

## Local setup

The sandbox this was authored in had no access to the npm registry, so dependencies were never
installed and versions in `package.json` are pinned but unproven. Expect to resolve peer versions on
first install.

```bash
npm install
cp .env.example .env.local     # defaults to the fixture provider; no Meta credentials needed
npm run typecheck
npm run check                  # 66 metric, fixture and dashboard checks; no database required
npm run preview                # regenerate preview/dashboard.{html,md}
```

The dashboard is at `/dashboard` and reads fixture data, so it runs with no Meta credentials and no
database.

Once Postgres is available:

```bash
npm run db:migrate
npm run db:seed                # populates metric_definitions from the registry
```

## Verification

Be precise about what has been checked, because a passing local run is not integration confidence.

**Verified by execution** - 126 checks passing: `verify-core.ts` (37), `verify-dashboard.ts` (29),
`verify-design.ts` (12) and `verify-auth.ts` (48).

From the auth layer, the invariants most likely to be lost in a later refactor:

- A viewer cannot export. Bulk egress is a separate capability from reading.
- An admin cannot mint owners, including themselves, and cannot modify an owner.
- A workspace cannot be left without an owner, including by the last owner demoting themselves.
- Absent evidence of recent authentication is treated as stale, never as fresh, so omitting the field
  cannot grant a sensitive action.
- `accountScope` restricts data for every role, owners included.
- An unknown email and a wrong password return the same message and cost the same hashing work, so the
  form is not an account-enumeration oracle.
- An escalated lockout holds for its full hour. An earlier version counted failures over 15 minutes
  while locking for 60, so the lockout silently expired early; the check now covers it.

From the design layer: every registered colour pair meets its WCAG minimum (lowest is 3.12:1 for
borders, which need 3:1; all body text is 6.3:1 or better), no text style falls below 14px, and
`globals.css` is compared against the token source so the verified palette is the one that renders.

From the dashboard layer:

- Every metric the UI can show carries a definition tooltip and a provenance label.
- Every absent value carries both a reason and a corrective action, and never also carries a value.
- Every view-fallback value names the substituted denominator and warns against direct comparison.
- Change is legible without colour, and direction is independent of polarity, so a falling publishing
  interval reads as an improvement.
- Change from a zero baseline reports the movement rather than an infinite percentage; a missing
  baseline reads as unknown rather than flat.
- No incomparable metric appears as a combined KPI, and the pooled follower total discloses that it
  double counts people.
- Quiet days and out-of-coverage days are distinct from each other and from a real zero.
- A chart point resolves to exactly the posts published on that date; a quiet date returns an
  explained empty state.
- Sorting places unavailable metrics last rather than treating them as zero.
- Period engagement rate is view-weighted rather than a mean of per-post rates, and aggregates
  disclose how many posts they excluded.
- The AI panel is pending, holds no evidence, and still states a rule-derived confidence.

From the metric core:

- Instagram and Threads engagement rates, save and share rates, conversation spread rate,
  follower growth, publishing interval.
- Denominator precedence, including that a fallback to views is flagged and that save rate refuses
  to fall back.
- That a missing numerator term produces `MISSING_NUMERATOR_INPUT` rather than a quietly smaller
  percentage.
- Zero and missing denominators, and missing-scope handling.
- Performance index: minimum sample refusal, 0-100 bounds, midrank ties, and that uncalculable
  posts are excluded rather than counted as zero.
- Confidence rubric thresholds, and that competitor scope is capped at LOW.
- Provider error translation: expired versus revoked tokens, rate-limit deferral, unmapped codes
  staying visible, and that credentials never reach diagnostics.
- Fixture determinism, the Threads epoch floor, presence of the awkward states, and that competitor
  media carries exactly likes and comments.

**Typechecked**: `src/**` is clean under `strict` plus `noUncheckedIndexedAccess`. Before
`npm install`, a full `tsc --noEmit` reports missing `@types/node` and `@prisma/client`, which are
module-resolution errors in `scripts/` and `prisma/`, not type errors in the library code.

**Not verified**:

- `prisma/schema.prisma` has never been run through `prisma validate` or a migration. Relations were
  reviewed by hand. Treat the first migration as a real test.
- The React components have never been type-checked or rendered, because React, Next.js and their
  type packages are not installed. They transpile without syntax errors, and that is all that is
  known about them. Expect to fix prop and JSX type errors on the first `npm run typecheck`.
- No live Meta call has been made. Field mappings, pagination, rate-limit behaviour and the exact
  error codes in `errors.ts` are drawn from documentation, not from observed responses. The
  `Provisional` ADRs name the checks that would confirm them.
- Section 14 acceptance criteria that require a real connection cannot be signed off in fixture
  mode.

## Suggested next step

Install the toolchain and run the dashboard, so the React layer gets its first real type check and
the layout can be judged on a phone. After that, the highest-value work is the queue and collection
jobs behind `sync_jobs`: every screen beyond this one depends on accumulated daily snapshots rather
than on a single fetch, and snapshots only exist once collection has been running.
