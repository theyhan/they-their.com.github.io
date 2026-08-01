# Architecture Decision Records

Each ADR resolves a conflict or gap found in the SNSight specification (v1.0 EN, 2026-08-01).
The spec remains the requirements source of truth; these records override it where they say so
explicitly, and `../spec-amendments.md` maps each affected spec section to its decision.

| ADR | Decision | Amends spec |
| --- | --- | --- |
| [0001](0001-competitor-data-path.md) | Competitor monitoring is Instagram-only in the MVP | 3.2, FR-006, FR-007, 12 |
| [0002](0002-meta-connection-strategy.md) | Two independent connections; Instagram uses Facebook Login | FR-002, 9.2, 13 Phase 1 |
| [0003](0003-metric-definition-registry.md) | Per-platform formulas in a versioned registry; no cross-platform sums | 6.1, 6.3, FR-005 |
| [0004](0004-normalized-performance-index.md) | Self-referential percentile cohort for the 0-100 index | 6.4 |
| [0005](0005-data-model-additions.md) | Seven tables added to the section 8 model | 8, 10.2, 11, FR-010, FR-012, FR-013 |
| [0006](0006-ai-insight-pipeline.md) | Precomputed AI runs, deterministic confidence, mandatory evidence | FR-011, 3.3, 9.1, 10.1 |
| [0007](0007-fixture-first-development.md) | Provider interface with a fixture backend so App Review does not block | 13, 15, SCR-001 |

## Status values

`Accepted` means the decision is binding on implementation. `Provisional` means it is binding
but rests on an API behaviour that has not yet been confirmed against a live Meta app; each
such ADR names the check that would confirm or overturn it.
