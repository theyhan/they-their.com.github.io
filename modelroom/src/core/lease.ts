// Spec v1.1 D4: artifact write leases with epoch fencing.
//
// §14 says "only one active writer" but says nothing about expiry, which deadlocks
// the artifact forever when a worker dies mid-run. TTL alone is not enough either: a
// worker partitioned away from the database will eventually come back and try to
// commit under a lease that has since been handed to someone else. The epoch is a
// fencing token carried on every version write, so those late writes are rejected
// instead of corrupting the artifact.

import type { ArtifactVersionRow, LeaseRow } from "../domain/rows.ts";
import type { Clock } from "../ports/clock.ts";
import type { Tx } from "../ports/store.ts";
import { ArtifactConflict, LeaseHeld, LeaseLost, NotFound } from "./errors.ts";

export const LEASE_TTL_MS = 120_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;

export interface LeaseHandle {
  artifactId: string;
  epoch: number;
  expiresAt: number;
}

/**
 * Conditional acquire. Succeeds if the artifact is unleased, the lease has expired,
 * or the caller already holds it. Reclaiming an expired lease bumps the epoch, which
 * is what invalidates the previous holder's pending writes.
 */
export function acquireLease(
  tx: Tx,
  artifactId: string,
  runId: string,
  clock: Clock,
  ttlMs: number = LEASE_TTL_MS,
): LeaseHandle {
  const artifact = tx.getArtifact(artifactId);
  if (!artifact) throw new NotFound("Artifact", artifactId);

  const now = clock.now();
  const existing = tx.getLease(artifactId);

  if (existing && existing.expiresAt > now && existing.holderRunId !== runId) {
    throw new LeaseHeld(artifactId, existing.holderRunId);
  }

  const renewing = existing?.holderRunId === runId && existing.expiresAt > now;
  const epoch = renewing ? existing.epoch : (existing?.epoch ?? 0) + 1;

  const lease: LeaseRow = {
    artifactId,
    holderRunId: runId,
    epoch,
    acquiredAt: renewing ? existing.acquiredAt : now,
    heartbeatAt: now,
    expiresAt: now + ttlMs,
  };
  tx.putLease(lease);
  tx.updateArtifact(artifactId, { activeWriterRunId: runId });

  if (existing && !renewing && existing.expiresAt <= now) {
    tx.insertAudit({
      id: tx.nextId("aud"),
      projectId: artifact.projectId,
      taskId: artifact.taskId,
      runId,
      eventType: "LEASE_RECLAIMED",
      actorId: null,
      payload: {
        artifactId,
        previousHolderRunId: existing.holderRunId,
        previousEpoch: existing.epoch,
        newEpoch: epoch,
        expiredAtMs: existing.expiresAt,
      },
      createdAt: now,
    });
  }

  return { artifactId, epoch, expiresAt: lease.expiresAt };
}

/**
 * Extends the lease. Throws LeaseLost if it was reclaimed, which is the signal for
 * the worker to cancel its own run rather than keep generating output it can no
 * longer commit.
 */
export function heartbeatLease(
  tx: Tx,
  handle: LeaseHandle,
  runId: string,
  clock: Clock,
  ttlMs: number = LEASE_TTL_MS,
): LeaseHandle {
  const lease = tx.getLease(handle.artifactId);
  if (!lease || lease.holderRunId !== runId || lease.epoch !== handle.epoch) {
    throw new LeaseLost(handle.artifactId, handle.epoch, lease?.epoch ?? -1);
  }

  const now = clock.now();
  const updated: LeaseRow = { ...lease, heartbeatAt: now, expiresAt: now + ttlMs };
  tx.putLease(updated);
  return { artifactId: handle.artifactId, epoch: lease.epoch, expiresAt: updated.expiresAt };
}

export function releaseLease(tx: Tx, artifactId: string, clock: Clock, reason: string): void {
  const lease = tx.getLease(artifactId);
  if (!lease) return;

  const artifact = tx.getArtifact(artifactId);
  tx.deleteLease(artifactId);
  tx.updateArtifact(artifactId, { activeWriterRunId: null });

  if (artifact) {
    tx.insertAudit({
      id: tx.nextId("aud"),
      projectId: artifact.projectId,
      taskId: artifact.taskId,
      runId: lease.holderRunId,
      eventType: "LEASE_RELEASED",
      actorId: null,
      payload: { artifactId, reason, epoch: lease.epoch },
      createdAt: clock.now(),
    });
  }
}

export interface SaveVersionInput {
  artifactId: string;
  baseVersion: number;
  uri: string;
  sizeBytes: number;
  runId: string;
  epoch: number;
}

/**
 * The only way to write artifact content.
 *
 * Order matters: the fencing check comes BEFORE the base-version check. A worker
 * whose lease was reclaimed must be told it lost the lease, not handed a conflict it
 * would try to resolve while holding nothing.
 */
export function saveArtifactVersion(tx: Tx, input: SaveVersionInput, clock: Clock): ArtifactVersionRow {
  const artifact = tx.getArtifact(input.artifactId);
  if (!artifact) throw new NotFound("Artifact", input.artifactId);

  const lease = tx.getLease(input.artifactId);
  if (!lease || lease.holderRunId !== input.runId || lease.epoch !== input.epoch) {
    throw new LeaseLost(input.artifactId, input.epoch, lease?.epoch ?? -1);
  }

  if (input.baseVersion !== artifact.headVersion) {
    throw new ArtifactConflict(input.artifactId, input.baseVersion, artifact.headVersion);
  }

  const version: ArtifactVersionRow = {
    id: tx.nextId("ver"),
    artifactId: input.artifactId,
    version: artifact.headVersion + 1,
    baseVersion: input.baseVersion,
    uri: input.uri,
    sizeBytes: input.sizeBytes,
    createdByRunId: input.runId,
    epoch: input.epoch,
    createdAt: clock.now(),
  };

  tx.insertArtifactVersion(version);
  tx.updateArtifact(input.artifactId, { headVersion: version.version });
  return version;
}

/**
 * D4: reviewers never acquire a lease. They propose a patch and the assignee applies
 * it, which enforces "the assigned model performs the final merge" at the data layer
 * instead of hoping a prompt instruction is obeyed.
 */
export function proposePatch(
  tx: Tx,
  input: { artifactId: string; baseVersion: number; diff: string; rationale?: string | null; proposedByRunId: string },
  clock: Clock,
): void {
  const artifact = tx.getArtifact(input.artifactId);
  if (!artifact) throw new NotFound("Artifact", input.artifactId);

  tx.insertArtifactPatch({
    id: tx.nextId("pat"),
    artifactId: input.artifactId,
    baseVersion: input.baseVersion,
    diff: input.diff,
    rationale: input.rationale ?? null,
    proposedByRunId: input.proposedByRunId,
    // Recorded as STALE rather than rejected: the reviewer's reasoning is still
    // useful evidence for the §8.4 log even when the base moved underneath it.
    status: input.baseVersion === artifact.headVersion ? "PROPOSED" : "STALE",
    createdAt: clock.now(),
  });
}
