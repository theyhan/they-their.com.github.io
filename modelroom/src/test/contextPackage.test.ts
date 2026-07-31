import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildContextPackage, FILE_SUMMARY_THRESHOLD_TOKENS, type BuildContextInput } from "../core/contextPackage.ts";
import { ContextTooLarge } from "../core/errors.ts";
import { truncatingSummarizer } from "../infra/fakeAdapter.ts";
import { GEMINI, GPT, gptConfig, makeWorld, type World } from "./fixtures.ts";

function baseInput(world: World, overrides: Partial<BuildContextInput> = {}): BuildContextInput {
  return {
    taskId: world.taskId,
    round: 0,
    targetModelConfigId: GEMINI,
    reservedOutputTokens: 2_000,
    projectGoal: "Build a landing page",
    completionCriteria: ["renders on mobile", "hero headline under 12 words"],
    reviewCriteria: ["requirement_coverage", "sensitive_info_absent"],
    decisions: [{ id: "dec_1", selectedOption: "single-column hero", rationale: "faster to ship" }],
    counterpartDeliverable: { artifactVersionId: "ver_9", content: "export function Hero() {}" },
    files: [{ id: "file_1", name: "brand.md", content: "Tone: direct." }],
    remainingRounds: 1,
    remainingBudgetMicros: 500_000n,
    ...overrides,
  };
}

describe("D7 context package", () => {
  test("identical inputs produce an identical hash, so a run can be replayed and verified", () => {
    const world = makeWorld();
    const deps = { clock: world.clock, summarizer: truncatingSummarizer };

    const first = world.store.transaction((tx) => buildContextPackage(tx, baseInput(world), deps));
    const second = world.store.transaction((tx) => buildContextPackage(tx, baseInput(world), deps));

    assert.notEqual(first.id, second.id);
    assert.equal(first.contentHash, second.contentHash);
    assert.equal(first.tokenEstimate, second.tokenEstimate);
  });

  test("file ordering cannot change the hash", () => {
    const world = makeWorld();
    const deps = { clock: world.clock, summarizer: truncatingSummarizer };
    const files = [
      { id: "file_1", name: "a.md", content: "alpha" },
      { id: "file_2", name: "b.md", content: "beta" },
    ];

    const forward = world.store.transaction((tx) => buildContextPackage(tx, baseInput(world, { files }), deps));
    const reversed = world.store.transaction((tx) =>
      buildContextPackage(tx, baseInput(world, { files: [...files].reverse() }), deps),
    );

    assert.equal(forward.contentHash, reversed.contentHash);
  });

  test("the package records what it was built from", () => {
    const world = makeWorld();
    const pkg = world.store.transaction((tx) =>
      buildContextPackage(tx, baseInput(world), { clock: world.clock, summarizer: truncatingSummarizer }),
    );

    assert.deepEqual(pkg.sourceRefs.decisionIds, ["dec_1"]);
    assert.deepEqual(pkg.sourceRefs.artifactVersionIds, ["ver_9"]);
    assert.deepEqual(pkg.sourceRefs.fileIds, ["file_1"]);
    assert.equal(pkg.targetProvider, "GOOGLE");
    assert.equal(pkg.payload.counterpartDeliverable, "export function Hero() {}");
  });

  test("an oversized file is summarized and the summary becomes an inspectable artifact", () => {
    // Lossy summarization is the likeliest cause of "the reviewer missed something
    // obvious", so it must never happen invisibly.
    const world = makeWorld();
    const huge = "x".repeat(FILE_SUMMARY_THRESHOLD_TOKENS * 4 * 3);

    const pkg = world.store.transaction((tx) =>
      buildContextPackage(tx, baseInput(world, { files: [{ id: "file_big", name: "spec.md", content: huge }] }), {
        clock: world.clock,
        summarizer: truncatingSummarizer,
      }),
    );

    assert.equal(pkg.payload.files[0]?.summarized, true);
    assert.ok(pkg.payload.files[0]!.content.length < huge.length);

    const summaries = Object.values(world.store.db.artifacts).filter((a) => a.type === "SUMMARY");
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.name, "summary:spec.md");
    assert.ok(world.store.db.audit.some((a) => a.eventType === "FILE_SUMMARIZED"));
    assert.equal(world.store.db.artifactVersions.length, 1, "the summary content is versioned, not just referenced");
  });

  test("a file under the threshold is passed through untouched", () => {
    const world = makeWorld();
    const pkg = world.store.transaction((tx) =>
      buildContextPackage(tx, baseInput(world), { clock: world.clock, summarizer: truncatingSummarizer }),
    );

    assert.equal(pkg.payload.files[0]?.summarized, false);
    assert.equal(pkg.payload.files[0]?.content, "Tone: direct.");
    assert.equal(Object.values(world.store.db.artifacts).length, 0);
  });

  test("the context window is charged for the reserved output, not just the input", () => {
    const world = makeWorld();
    world.store.db.modelConfigs["mc_small"] = { ...gptConfig(), id: "mc_small", contextLimitTokens: 600 };

    assert.throws(
      () =>
        world.store.transaction((tx) =>
          buildContextPackage(tx, baseInput(world, { targetModelConfigId: "mc_small", reservedOutputTokens: 100 }), {
            clock: world.clock,
            summarizer: truncatingSummarizer,
          }),
        ),
      ContextTooLarge,
    );
  });

  test("a package that cannot be shrunk enough fails loudly instead of truncating silently", () => {
    const world = makeWorld();
    // 4000-token window, 1500 reserved for output, 512 margin -> ~1988 usable, against
    // a file far larger than that plus a summarizer that cannot compress below it.
    world.store.db.modelConfigs["mc_tight"] = { ...gptConfig(), id: "mc_tight", contextLimitTokens: 4_000 };
    const stubbornSummarizer = { summarize: (input: { content: string }) => input.content };

    assert.throws(
      () =>
        world.store.transaction((tx) =>
          buildContextPackage(
            tx,
            baseInput(world, {
              targetModelConfigId: "mc_tight",
              reservedOutputTokens: 1_500,
              files: [{ id: "file_big", name: "spec.md", content: "y".repeat(40_000) }],
            }),
            { clock: world.clock, summarizer: stubbornSummarizer },
          ),
        ),
      ContextTooLarge,
    );
  });

  test("the target provider is taken from the model config, so the same task can target either model", () => {
    const world = makeWorld();
    const deps = { clock: world.clock, summarizer: truncatingSummarizer };

    const forGemini = world.store.transaction((tx) => buildContextPackage(tx, baseInput(world), deps));
    const forGpt = world.store.transaction((tx) =>
      buildContextPackage(tx, baseInput(world, { targetModelConfigId: GPT }), deps),
    );

    assert.equal(forGemini.targetProvider, "GOOGLE");
    assert.equal(forGpt.targetProvider, "OPENAI");
    // Same content, different destination: provider state is not transferable, but the
    // package itself is provider-independent.
    assert.equal(forGemini.contentHash, forGpt.contentHash);
  });
});
