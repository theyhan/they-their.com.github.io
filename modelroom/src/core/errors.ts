// Typed errors. Every one maps to a §16 required response, so callers can branch
// on class rather than parsing messages.

import type { Micros } from "../domain/money.ts";
import type { TaskStatus } from "../domain/states.ts";

export class ModelRoomError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** D1: no run may start without a reservation. Never retried automatically. */
export class BudgetExhausted extends ModelRoomError {
  readonly availableMicros: Micros;
  readonly requiredMicros: Micros;
  constructor(availableMicros: Micros, requiredMicros: Micros) {
    super(
      "BUDGET_EXHAUSTED",
      `Insufficient budget: ${availableMicros} micros available, ${requiredMicros} required for the minimum viable run`,
    );
    this.availableMicros = availableMicros;
    this.requiredMicros = requiredMicros;
  }
}

/** D2: same key, different body. */
export class IdempotencyConflict extends ModelRoomError {
  constructor(scope: string, key: string) {
    super("IDEMPOTENCY_CONFLICT", `Idempotency key ${scope}/${key} was already used with a different request body`);
  }
}

/** D3: lost the optimistic-concurrency race. Caller reloads and retries. */
export class ConcurrentTransition extends ModelRoomError {
  constructor(taskId: string) {
    super("CONCURRENT_TRANSITION", `Task ${taskId} was modified concurrently`);
  }
}

export class IllegalTransition extends ModelRoomError {
  constructor(taskId: string, from: TaskStatus, to: TaskStatus) {
    super("ILLEGAL_TRANSITION", `Task ${taskId}: ${from} -> ${to} is not a declared transition`);
  }
}

/** D4: another run holds an unexpired lease. */
export class LeaseHeld extends ModelRoomError {
  readonly holderRunId: string;
  constructor(artifactId: string, holderRunId: string) {
    super("LEASE_HELD", `Artifact ${artifactId} is locked by run ${holderRunId}`);
    this.holderRunId = holderRunId;
  }
}

/**
 * D4: the lease was reclaimed while this worker was partitioned away. The write is
 * rejected by the fencing token rather than being allowed to corrupt state.
 */
export class LeaseLost extends ModelRoomError {
  constructor(artifactId: string, expectedEpoch: number, actualEpoch: number) {
    super("LEASE_LOST", `Artifact ${artifactId} lease epoch ${expectedEpoch} is stale (current ${actualEpoch})`);
  }
}

/** §14: base version moved. No auto-merge. */
export class ArtifactConflict extends ModelRoomError {
  readonly baseVersion: number;
  readonly headVersion: number;
  constructor(artifactId: string, baseVersion: number, headVersion: number) {
    super("ARTIFACT_CONFLICT", `Artifact ${artifactId}: base version ${baseVersion} is behind head ${headVersion}`);
    this.baseVersion = baseVersion;
    this.headVersion = headVersion;
  }
}

/** D7: the package cannot be shrunk enough to fit the target model. */
export class ContextTooLarge extends ModelRoomError {
  constructor(tokenEstimate: number, budget: number) {
    super("CONTEXT_TOO_LARGE", `Context package needs ${tokenEstimate} tokens but only ${budget} are available`);
  }
}

export class NotFound extends ModelRoomError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} ${id} not found`);
  }
}

export class InvariantViolation extends ModelRoomError {
  constructor(message: string) {
    super("INVARIANT_VIOLATION", message);
  }
}
