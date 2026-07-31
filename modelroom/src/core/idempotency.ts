// Spec v1.1 D2, request half: duplicate HTTP submissions must not create duplicate
// work or duplicate charges.
//
// The provider half (a call whose outcome is unknown) lives in ledger.settle and
// sweeper.ts, because no amount of request deduplication helps once money has
// already left the building.

import type { IdempotencyRow } from "../domain/rows.ts";
import type { Clock } from "../ports/clock.ts";
import type { Tx } from "../ports/store.ts";
import { IdempotencyConflict } from "./errors.ts";
import { hashPayload } from "../infra/hash.ts";

export interface ClaimInput {
  scope: string;
  key: string;
  request: unknown;
  projectId?: string | null;
}

export type ClaimResult =
  | { status: "FRESH" }
  /** A completed prior attempt: return its stored response verbatim. */
  | { status: "REPLAY"; snapshot: unknown }
  /** A concurrent attempt is mid-flight. Caller must not start a second run. */
  | { status: "IN_FLIGHT" };

export function claimIdempotency(tx: Tx, input: ClaimInput, clock: Clock): ClaimResult {
  const requestHash = hashPayload(input.request);
  const existing = tx.getIdempotency(input.scope, input.key);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      // Same key, different body. Silently serving the old response would hide a
      // client bug; silently running the new body would break the key's contract.
      throw new IdempotencyConflict(input.scope, input.key);
    }
    return existing.status === "DONE"
      ? { status: "REPLAY", snapshot: existing.responseSnapshot }
      : { status: "IN_FLIGHT" };
  }

  const row: IdempotencyRow = {
    scope: input.scope,
    key: input.key,
    requestHash,
    projectId: input.projectId ?? null,
    responseSnapshot: null,
    status: "IN_PROGRESS",
    createdAt: clock.now(),
  };
  tx.putIdempotency(row);
  return { status: "FRESH" };
}

export function completeIdempotency(tx: Tx, scope: string, key: string, snapshot: unknown): void {
  const existing = tx.getIdempotency(scope, key);
  if (!existing) return;
  tx.putIdempotency({ ...existing, responseSnapshot: snapshot, status: "DONE" });
}

/**
 * Releases a claim so the operation can be legitimately retried.
 *
 * Only safe for failures that happened BEFORE the provider was contacted. Once a
 * provider call is in flight the run must be reconciled by the sweeper instead, which
 * is why the orchestrator only calls this on admission-time failures.
 */
export function abandonIdempotency(tx: Tx, scope: string, key: string): void {
  const existing = tx.getIdempotency(scope, key);
  if (!existing || existing.status === "DONE") return;
  tx.deleteIdempotency(scope, key);
}
