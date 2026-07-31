// Spec v1.1 D2, reconciliation half.
//
// The scenario: we called the provider, it accepted and started billing, then the
// socket died before we persisted an outcome. The run is stuck PENDING/STREAMING and
// the money is in limbo. Doing nothing leaks budget; retrying blind double-charges.

import type { Clock } from "../ports/clock.ts";
import type { Store } from "../ports/store.ts";
import { settle } from "./ledger.ts";

/** How long a run may stay non-terminal before it is considered abandoned. */
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;
export const RECONCILE_GRACE_MS = 60 * 1000;

export interface ProviderRunOutcome {
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  inputTokens: number;
  outputTokens: number;
}

/**
 * Queries the provider for the true outcome of a call.
 * Implemented per provider: Responses exposes retrieval by response id, Interactions
 * exposes retrieval by interaction id. Returning undefined means "cannot determine".
 */
export interface ProviderLookup {
  lookup(providerRequestId: string): Promise<ProviderRunOutcome | undefined>;
}

export interface SweepResult {
  reconciled: string[];
  unknown: string[];
}

export async function reconcileStaleRuns(
  store: Store,
  clock: Clock,
  lookup: ProviderLookup,
  timeoutMs: number = RUN_TIMEOUT_MS + RECONCILE_GRACE_MS,
): Promise<SweepResult> {
  const cutoff = clock.now() - timeoutMs;
  const stale = store.transaction((tx) =>
    [...tx.runsByStatus("PENDING"), ...tx.runsByStatus("STREAMING")].filter((run) => run.startedAt <= cutoff),
  );

  const reconciled: string[] = [];
  const unknown: string[] = [];

  for (const run of stale) {
    let outcome: ProviderRunOutcome | undefined;

    if (run.providerRequestId) {
      try {
        outcome = await lookup.lookup(run.providerRequestId);
      } catch {
        outcome = undefined;
      }
    }

    if (outcome) {
      store.transaction((tx) => {
        settle(
          tx,
          {
            runId: run.id,
            outcome: outcome.status,
            inputTokens: outcome.inputTokens,
            outputTokens: outcome.outputTokens,
            errorCode: outcome.status === "COMPLETED" ? null : "RECONCILED",
          },
          clock,
        );
        tx.insertAudit({
          id: tx.nextId("aud"),
          projectId: run.projectId,
          taskId: run.taskId,
          runId: run.id,
          eventType: "RUN_RECONCILED",
          actorId: null,
          payload: { providerRequestId: run.providerRequestId, outcome: outcome.status },
          createdAt: clock.now(),
        });
      });
      reconciled.push(run.id);
      continue;
    }

    // Cannot determine. Settle the full hold pessimistically and surface it: the
    // provider may have billed us, and this must become a visible user decision
    // rather than an automatic reassignment that risks paying twice.
    store.transaction((tx) => {
      settle(
        tx,
        { runId: run.id, outcome: "UNKNOWN", inputTokens: run.inputTokens, outputTokens: run.outputTokens, errorCode: "UNRECONCILABLE" },
        clock,
      );
      tx.insertAudit({
        id: tx.nextId("aud"),
        projectId: run.projectId,
        taskId: run.taskId,
        runId: run.id,
        eventType: "RUN_UNRECONCILABLE",
        actorId: null,
        payload: {
          providerRequestId: run.providerRequestId,
          note: "hold settled pessimistically; requires user decision before retry",
        },
        createdAt: clock.now(),
      });
    });
    unknown.push(run.id);
  }

  return { reconciled, unknown };
}
