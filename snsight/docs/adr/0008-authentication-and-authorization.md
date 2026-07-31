# ADR-0008: Login identity is separate from Meta data access

- Status: Accepted
- Implements: FR-001, spec 10.2
- Relates to: [ADR-0002](0002-meta-connection-strategy.md)
- Date: 2026-08-01

## Context

FR-001 asks for email and social login, a personal workspace on onboarding, team invitations, and four
roles. ADR-0002 separately establishes that reading Instagram data requires the Instagram API with
Facebook Login plus a linked Page.

These two things will be confused, by users and by implementers. "Sign in with Facebook" and "connect
your Instagram account for analytics" look like the same action and are not. A user who signs in with
Facebook has proved who they are; they have granted no insights permission, and no data will appear.
If the product treats one as implying the other, the first support question is why the dashboard is
empty, and the first security review question is why a login token is being used to read business
data.

There is a second trap. If signing in with Facebook silently requested insights scopes, every user
would face a frightening permission dialogue at signup, before understanding the product. Conversion
suffers and consent stops being informed.

## Decision

1. **Two independent subsystems, two tables.** Login identities live in `auth_accounts`, `auth_sessions`
   and `user_credentials`. Meta data access lives in `social_accounts` and `oauth_connections`
   (ADR-0002). Nothing joins them. A Facebook login row grants no data access, and a revoked Instagram
   connection does not sign anyone out.
2. **Login requests identity scopes only.** No insights or business-discovery scope is ever requested
   during sign-in. Connecting an account is a separate, later, explicitly initiated flow with its own
   consent screen and its own explanation of the Page requirement.
3. **The UI states the distinction rather than relying on users inferring it.** The login screen says
   that signing in does not connect an account, and a workspace with no connected accounts shows the
   connect prompt instead of an empty dashboard.
4. **Roles carry capabilities, not adjectives.** `OWNER`, `ADMIN`, `ANALYST` and `VIEWER` map to an
   explicit capability set in `src/lib/auth/permissions.ts`, which is the only place authorisation is
   decided. Route handlers and components ask `can(role, capability)`; they never compare role strings,
   because `role === 'ADMIN' || role === 'OWNER'` scattered across a codebase is how a permission gets
   missed.
5. **Three invariants are enforced in code, not by convention:**
   - A workspace always retains at least one `OWNER`. The last owner cannot be removed or demoted.
   - An `ADMIN` cannot promote anyone to `OWNER`, including themselves, and cannot remove or demote an
     `OWNER`. Otherwise `ADMIN` is `OWNER` with extra steps.
   - A `VIEWER` cannot export. CSV and PDF export is bulk data egress, so it is a distinct capability
     from viewing, not an extension of it.
6. **`accountScope` restricts data for every role, including owners.** FR-001 asks for account-level
   permissions; a scope that silently did not apply to the person who set it would be useless for the
   agency case where a contractor must see one client only. Management capabilities are unaffected -
   an owner still administers accounts they cannot read.
7. **Sensitive actions require recent authentication.** Disconnecting an account, deleting data,
   changing a role, and creating a share link require authentication within the last 15 minutes. A
   stolen 30-day session should not be able to destroy a workspace.
8. **Authentication failures are indistinguishable.** An unknown email and a wrong password return the
   same message and the same timing class, so the login form is not an account-enumeration oracle.
   Rate limiting is keyed on the email and the client address together, with escalating lockout.
9. **Password rules follow current guidance, not folklore.** Minimum 12 characters, maximum 128 to
   bound hashing cost, rejected if it contains the email local part or appears in a common-password
   list. No composition requirements: mandating a symbol produces `Password1!` and a sticky note.
10. **Auth events are audited.** Sign-in, sign-out, failed attempts, lockouts, role changes, invitations
    and password changes write to `audit_logs` (ADR-0005) in the same transaction as the change.

## Consequences

- Onboarding has two distinct steps that must not be merged in the UI: create an account, then connect
  a platform. Analytics screens must all tolerate a signed-in user with zero connected accounts, which
  is the normal state for a new user rather than an edge case.
- The demo dashboard required by SCR-001 becomes the natural content for that state: a workspace with
  no connected accounts shows fixture data behind a banner (ADR-0007 decision 5), which is both an
  honest empty state and the product's best sales pitch.
- Session storage is a database table rather than a stateless cookie, because immediate revocation is
  required when a member is removed. A JWT valid for another 29 days after removal is not acceptable
  for a product holding several clients' data in one workspace.
- The 15-minute re-authentication window will annoy users during bulk cleanup. That is the intended
  trade, and the window is configuration rather than a constant so it can be tuned with evidence.

## Confirming check

The capability matrix and its invariants are covered by `scripts/verify-auth.ts`. What those checks
cannot prove is that every route actually calls `can()`; that requires the routes to exist. Each new
route handler must be reviewed for an authorisation call, and an integration test asserting a 403 for
each role is the follow-up once the app runs.
