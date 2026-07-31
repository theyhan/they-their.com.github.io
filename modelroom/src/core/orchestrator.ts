// Run lifecycle. The ordering here is the load-bearing part, not the code volume.
//
//   1. build + persist the ContextPackage        (D7 - replayable)
//   2. TX: admit (reserve worst case) + insert PENDING Run + task -> RUNNING
//   3. call the provider
//   4. persist providerRequestId on the first event, in its own TX
//   5. enforce the output cap worker-side
//   6. TX: settle + task -> REVIEW / FAILED
//
// Step 2 precedes step 3 so a charge can never exist without a row. Step 4 precedes
// any content handling because it is the only handle that makes reconciliation
// possible, and a socket can drop at any point after step 3.

import type { Micros } from "../domain/money.ts";
import type { RunRow } from "../domain/rows.ts";
import type { Provider, RunStatus } from "../domain/states.ts";
import type { ModelAdapter } from "../ports/adapter.ts";
import type { Clock } from "../ports/clock.ts";
import type { Store } from "../ports/store.ts";
import { BudgetExhausted, NotFound } from "./errors.ts";
import { admit, availableMicros, settle, type SettleOutcome } from "./ledger.ts";
import { claimIdempotency, completeIdempotency, abandonIdempotency } from "./idempotency.ts";
import { buildContextPackage, type BuildContextInput, type Summarizer } from "./contextPackage.ts";
import { transition } from "./taskMachine.ts";
import { estimateTokens } from "../infra/hash.ts";

export const RUN_SCOPE = "POST /tasks/:id/run";

export interface OrchestratorDeps {
  store: Store;
  clock: Clock;
  summarizer: Summarizer;
  adapters: Partial<Record<Provider, ModelAdapter>>;
}

export interface ExecuteRunInput {
  taskId: string;
  modelConfigId: string;
  idempotencyKey: string;
  attemptGroupId?: string;
  requestedMaxOutputTokens: number;
  systemInstruction: string;
  context: Omit<BuildContextInput, "taskId" | "round" | "targetModelConfigId" | "reservedOutputTokens" | "remainingBudgetMicros">;
}

export interface ExecuteRunResult {
  runId: string | null;
  status: RunStatus | "REFUSED";
  text: string;
  costMicros: Micros;
  replayed: boolean;
  /**
   * True when we do not know whether the provider did work. The run is deliberately
   * left PENDING for the sweeper; it must not be retried automatically.
   */
  indeterminate: boolean;
  outputCapHit: boolean;
  refusalReason: string | null;
}

export class Orchestrator {
  private readonly deps: OrchestratorDeps;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  async executeRun(input: ExecuteRunInput): Promise<ExecuteRunResult> {
    const { store, clock } = this.deps;

    // ---- Phase 0: request-level dedupe -------------------------------------
    const claim = store.transaction((tx) =>
      claimIdempotency(tx, { scope: RUN_SCOPE, key: input.idempotencyKey, request: input }, clock),
    );
    if (claim.status === "REPLAY") {
      return deserialize(claim.snapshot);
    }
    if (claim.status === "IN_FLIGHT") {
      return refused(null, "REQUEST_IN_FLIGHT");
    }

    // ---- Phase 1: context package + reservation + PENDING run --------------
    // BudgetExhausted is caught INSIDE the transaction and returned rather than
    // thrown, because admit() writes the project halt and that write must survive.
    // Letting the error escape would roll back the very record that stops the
    // project from being run again.
    const admission = store.transaction((tx) => {
      const task = tx.getTask(input.taskId);
      if (!task) throw new NotFound("Task", input.taskId);

      const contextPackage = buildContextPackage(
        tx,
        {
          ...input.context,
          taskId: input.taskId,
          round: task.round,
          targetModelConfigId: input.modelConfigId,
          reservedOutputTokens: input.requestedMaxOutputTokens,
          remainingBudgetMicros: availableMicros(tx, task.projectId),
        },
        { clock, summarizer: this.deps.summarizer },
      );

      const runId = tx.nextId("run");
      try {
        const cap = admit(
          tx,
          {
            runId,
            projectId: task.projectId,
            modelConfigId: input.modelConfigId,
            estimatedInputTokens: contextPackage.tokenEstimate,
            requestedMaxOutputTokens: input.requestedMaxOutputTokens,
          },
          clock,
        );

        const run: RunRow = {
          id: runId,
          taskId: task.id,
          projectId: task.projectId,
          modelConfigId: input.modelConfigId,
          contextPackageId: contextPackage.id,
          status: "PENDING",
          idempotencyKey: input.idempotencyKey,
          attemptGroupId: input.attemptGroupId ?? runId,
          providerRequestId: null,
          inputTokens: 0,
          outputTokens: 0,
          maxOutputTokens: cap.maxOutputTokens,
          costMicros: 0n,
          errorCode: null,
          startedAt: clock.now(),
          endedAt: null,
        };
        tx.insertRun(run);

        transition(
          tx,
          {
            taskId: task.id,
            from: ["ASSIGNED", "REVISION"],
            to: "RUNNING",
            cause: "RUN_ADMITTED",
            payload: { runId, maxOutputTokens: cap.maxOutputTokens, holdMicros: cap.holdMicros.toString() },
          },
          clock,
        );

        return { ok: true as const, run, contextPackageId: contextPackage.id };
      } catch (error) {
        if (!(error instanceof BudgetExhausted)) throw error;
        transition(
          tx,
          {
            taskId: task.id,
            from: ["ASSIGNED", "REVISION", "RUNNING"],
            to: "HALTED",
            cause: "BUDGET_EXHAUSTED",
            haltReason: "BUDGET_EXHAUSTED",
          },
          clock,
        );
        // Safe to release the key: no provider call was made, so a legitimate retry
        // after the budget is raised must be allowed to proceed.
        abandonIdempotency(tx, RUN_SCOPE, input.idempotencyKey);
        return { ok: false as const, reason: "BUDGET_EXHAUSTED" };
      }
    });

    if (!admission.ok) {
      return refused(null, admission.reason);
    }

    const run = admission.run;
    const config = store.transaction((tx) => tx.getModelConfig(run.modelConfigId));
    if (!config) throw new NotFound("ModelConfig", run.modelConfigId);

    const adapter = this.deps.adapters[config.provider];
    if (!adapter) throw new NotFound("ModelAdapter", config.provider);

    const contextPackage = store.transaction((tx) => tx.getContextPackage(run.contextPackageId ?? ""));
    if (!contextPackage) throw new NotFound("ContextPackage", run.contextPackageId ?? "<null>");

    // ---- Phase 2: stream ---------------------------------------------------
    let text = "";
    let outputTokens = 0;
    let reportedUsage: { inputTokens: number; outputTokens: number } | null = null;
    let failure: { code: string; message: string } | null = null;
    let completed = false;
    let outputCapHit = false;
    let transportError: unknown = null;

    try {
      const stream = adapter.createTurn({
        runId: run.id,
        modelId: config.modelId,
        context: contextPackage.payload,
        systemInstruction: input.systemInstruction,
        maxOutputTokens: run.maxOutputTokens,
      });

      for await (const event of stream) {
        if (event.type === "accepted") {
          // Own transaction, before any content processing (D2 step 4).
          const providerRequestId = event.providerRequestId;
          store.transaction((tx) => {
            tx.updateRun(run.id, { providerRequestId, status: "STREAMING" });
          });
        }
        if (event.type === "text_delta") {
          text += event.text;
          outputTokens = estimateTokens(text);
          if (outputTokens > run.maxOutputTokens) {
            // Defence in depth: max_output_tokens was already sent to the provider,
            // but the ledger must not depend on the provider honouring it.
            outputCapHit = true;
            await adapter.cancel(run.id);
            break;
          }
        } else if (event.type === "usage") {
          reportedUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        } else if (event.type === "failed") {
          failure = { code: event.code, message: event.message };
        } else if (event.type === "completed") {
          completed = true;
        }
      }
    } catch (error) {
      transportError = error;
    }

    // ---- Phase 3: settle ---------------------------------------------------
    if (transportError !== null) {
      // Outcome unknown. Do NOT settle and do NOT retry: the provider may have
      // completed the work and billed for it. The run stays PENDING/STREAMING and the
      // sweeper reconciles it against the provider using providerRequestId.
      store.transaction((tx) => {
        const current = tx.getRun(run.id);
        tx.insertAudit({
          id: tx.nextId("aud"),
          projectId: run.projectId,
          taskId: run.taskId,
          runId: run.id,
          eventType: "RUN_INDETERMINATE",
          actorId: null,
          payload: {
            reason: "TRANSPORT_ERROR",
            providerRequestId: current?.providerRequestId ?? null,
            message: transportError instanceof Error ? transportError.message : String(transportError),
          },
          createdAt: clock.now(),
        });
      });
      return {
        runId: run.id,
        status: "PENDING",
        text,
        costMicros: 0n,
        replayed: false,
        indeterminate: true,
        outputCapHit,
        refusalReason: null,
      };
    }

    const outcome: SettleOutcome = failure ? "FAILED" : outputCapHit ? "CANCELLED" : completed ? "COMPLETED" : "FAILED";
    // No usage event: fall back to the estimate only if the provider actually
    // produced something. An explicit `failed` event with no output (a rejected
    // rate-limited call, say) means no tokens were processed, and charging the input
    // estimate for it would bill the user for work that never happened. This is
    // distinct from a dropped socket, which is genuinely unknown and handled above.
    const usage =
      reportedUsage ??
      (text.length > 0
        ? { inputTokens: contextPackage.tokenEstimate, outputTokens }
        : { inputTokens: 0, outputTokens: 0 });

    const result = store.transaction((tx) => {
      const settled = settle(
        tx,
        {
          runId: run.id,
          outcome,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          errorCode: failure?.code ?? (outputCapHit ? "OUTPUT_CAP_EXCEEDED" : null),
        },
        clock,
      );

      if (outcome === "COMPLETED") {
        transition(tx, { taskId: run.taskId, from: ["RUNNING"], to: "REVIEW", cause: "RUN_COMPLETED" }, clock);
      } else {
        transition(
          tx,
          {
            taskId: run.taskId,
            from: ["RUNNING"],
            to: "FAILED",
            cause: failure ? `RUN_FAILED:${failure.code}` : "RUN_CANCELLED",
            payload: { outputCapHit },
          },
          clock,
        );
      }

      const snapshot: ExecuteRunResult = {
        runId: run.id,
        status: outcome === "COMPLETED" ? "COMPLETED" : outcome,
        text,
        costMicros: settled.settledMicros,
        replayed: false,
        indeterminate: false,
        outputCapHit,
        refusalReason: null,
      };
      completeIdempotency(tx, RUN_SCOPE, input.idempotencyKey, serializable(snapshot));
      return snapshot;
    });

    return result;
  }

}

function refused(runId: string | null, reason: string): ExecuteRunResult {
  return {
    runId,
    status: "REFUSED",
    text: "",
    costMicros: 0n,
    replayed: false,
    indeterminate: false,
    outputCapHit: false,
    refusalReason: reason,
  };
}

/** bigint is not JSON-serializable, and the snapshot round-trips through storage. */
function serializable(result: ExecuteRunResult): Record<string, unknown> {
  return { ...result, costMicros: result.costMicros.toString() };
}

function deserialize(snapshot: unknown): ExecuteRunResult {
  const raw = snapshot as Record<string, unknown>;
  return {
    runId: (raw["runId"] as string | null) ?? null,
    status: raw["status"] as RunStatus | "REFUSED",
    text: (raw["text"] as string) ?? "",
    costMicros: BigInt((raw["costMicros"] as string) ?? "0"),
    replayed: true,
    indeterminate: Boolean(raw["indeterminate"]),
    outputCapHit: Boolean(raw["outputCapHit"]),
    refusalReason: (raw["refusalReason"] as string | null) ?? null,
  };
}
