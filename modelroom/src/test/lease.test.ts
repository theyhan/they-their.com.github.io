import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  acquireLease,
  heartbeatLease,
  LEASE_TTL_MS,
  proposePatch,
  saveArtifactVersion,
} from "../core/lease.ts";
import { ArtifactConflict, LeaseHeld, LeaseLost } from "../core/errors.ts";
import { auditTypes, makeWorld, seedArtifact, seedRun } from "./fixtures.ts";

describe("D4 artifact leases and fencing", () => {
  test("a second writer is refused while the lease is live", () => {
    const world = makeWorld();
    seedArtifact(world, "art_1");
    seedRun(world, { id: "run_a" });
    seedRun(world, { id: "run_b" });

    world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));

    assert.throws(
      () => world.store.transaction((tx) => acquireLease(tx, "art_1", "run_b", world.clock)),
      LeaseHeld,
    );
  });

  test("an expired lease is reclaimable, so a dead worker cannot deadlock the artifact", () => {
    const world = makeWorld();
    seedArtifact(world, "art_1");
    seedRun(world, { id: "run_a" });
    seedRun(world, { id: "run_b" });

    const first = world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));
    assert.equal(first.epoch, 1);

    world.clock.advance(LEASE_TTL_MS + 1);
    const second = world.store.transaction((tx) => acquireLease(tx, "art_1", "run_b", world.clock));

    assert.equal(second.epoch, 2, "reclaiming must bump the fencing token");
    assert.ok(auditTypes(world).includes("LEASE_RECLAIMED"));
  });

  test("the old holder's write is rejected by the fencing token after reclaim", () => {
    // The dangerous case: run_a was only partitioned from the database, not dead. It
    // comes back and tries to commit work produced under a lease it no longer holds.
    const world = makeWorld();
    seedArtifact(world, "art_1");
    seedRun(world, { id: "run_a" });
    seedRun(world, { id: "run_b" });

    const stale = world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));
    world.clock.advance(LEASE_TTL_MS + 1);
    world.store.transaction((tx) => acquireLease(tx, "art_1", "run_b", world.clock));

    assert.throws(
      () =>
        world.store.transaction((tx) =>
          saveArtifactVersion(
            tx,
            { artifactId: "art_1", baseVersion: 0, uri: "s3://stale", sizeBytes: 10, runId: "run_a", epoch: stale.epoch },
            world.clock,
          ),
        ),
      LeaseLost,
    );
    assert.equal(world.store.db.artifactVersions.length, 0);
    assert.equal(world.store.db.artifacts["art_1"]?.headVersion, 0);
  });

  test("the current holder can write, advancing the head version", () => {
    const world = makeWorld();
    seedArtifact(world, "art_1");
    seedRun(world, { id: "run_a" });

    const handle = world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));
    const version = world.store.transaction((tx) =>
      saveArtifactVersion(
        tx,
        { artifactId: "art_1", baseVersion: 0, uri: "s3://v1", sizeBytes: 42, runId: "run_a", epoch: handle.epoch },
        world.clock,
      ),
    );

    assert.equal(version.version, 1);
    assert.equal(version.epoch, handle.epoch);
    assert.equal(world.store.db.artifacts["art_1"]?.headVersion, 1);
  });

  test("a moved base version is a conflict, never an auto-merge", () => {
    const world = makeWorld();
    seedArtifact(world, "art_1", 3);
    seedRun(world, { id: "run_a" });

    const handle = world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));

    assert.throws(
      () =>
        world.store.transaction((tx) =>
          saveArtifactVersion(
            tx,
            { artifactId: "art_1", baseVersion: 1, uri: "s3://old", sizeBytes: 10, runId: "run_a", epoch: handle.epoch },
            world.clock,
          ),
        ),
      ArtifactConflict,
    );
  });

  test("losing the lease is reported before any conflict, so the worker stops instead of merging", () => {
    const world = makeWorld();
    seedArtifact(world, "art_1", 3);
    seedRun(world, { id: "run_a" });
    seedRun(world, { id: "run_b" });

    const stale = world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));
    world.clock.advance(LEASE_TTL_MS + 1);
    world.store.transaction((tx) => acquireLease(tx, "art_1", "run_b", world.clock));

    // Both problems apply: stale epoch AND stale base version. LeaseLost must win,
    // because a worker holding nothing has no business resolving a conflict.
    assert.throws(
      () =>
        world.store.transaction((tx) =>
          saveArtifactVersion(
            tx,
            { artifactId: "art_1", baseVersion: 1, uri: "s3://x", sizeBytes: 10, runId: "run_a", epoch: stale.epoch },
            world.clock,
          ),
        ),
      LeaseLost,
    );
  });

  test("heartbeat extends the lease, and fails once it has been reclaimed", () => {
    const world = makeWorld();
    seedArtifact(world, "art_1");
    seedRun(world, { id: "run_a" });
    seedRun(world, { id: "run_b" });

    let handle = world.store.transaction((tx) => acquireLease(tx, "art_1", "run_a", world.clock));
    world.clock.advance(LEASE_TTL_MS / 2);
    handle = world.store.transaction((tx) => heartbeatLease(tx, handle, "run_a", world.clock));
    assert.equal(handle.expiresAt, world.clock.now() + LEASE_TTL_MS);

    world.clock.advance(LEASE_TTL_MS + 1);
    world.store.transaction((tx) => acquireLease(tx, "art_1", "run_b", world.clock));

    assert.throws(
      () => world.store.transaction((tx) => heartbeatLease(tx, handle, "run_a", world.clock)),
      LeaseLost,
    );
  });

  test("a reviewer proposes a patch instead of taking the lease", () => {
    const world = makeWorld();
    seedArtifact(world, "art_1", 2);
    seedRun(world, { id: "run_reviewer" });

    world.store.transaction((tx) =>
      proposePatch(
        tx,
        { artifactId: "art_1", baseVersion: 2, diff: "- old\n+ new", rationale: "hero copy is vague", proposedByRunId: "run_reviewer" },
        world.clock,
      ),
    );

    assert.equal(world.store.db.artifactPatches[0]?.status, "PROPOSED");
    assert.equal(world.store.db.leases["art_1"], undefined, "reviewers never acquire the write lease");
  });

  test("a patch whose base has moved is kept as STALE rather than discarded", () => {
    const world = makeWorld();
    seedArtifact(world, "art_1", 5);
    seedRun(world, { id: "run_reviewer" });

    world.store.transaction((tx) =>
      proposePatch(
        tx,
        { artifactId: "art_1", baseVersion: 2, diff: "- old\n+ new", proposedByRunId: "run_reviewer" },
        world.clock,
      ),
    );

    // The reasoning is still evidence for the activity log even though it no longer
    // applies cleanly.
    assert.equal(world.store.db.artifactPatches[0]?.status, "STALE");
  });
});
