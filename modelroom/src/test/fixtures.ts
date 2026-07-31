// Shared test world. Seeds the store directly because the Tx port intentionally
// exposes no insertProject/insertTask: those are API-layer concerns, not orchestrator
// ones, and widening the port just for tests would weaken it.

import type { ArtifactRow, ModelConfigRow, ProjectRow, RunRow, TaskRow } from "../domain/rows.ts";
import { usd, type Micros } from "../domain/money.ts";
import { ManualClock } from "../ports/clock.ts";
import { MemoryStore } from "../infra/memoryStore.ts";
import type { TaskStatus } from "../domain/states.ts";

export const GPT = "mc_gpt";
export const GEMINI = "mc_gemini";

export interface World {
  clock: ManualClock;
  store: MemoryStore;
  projectId: string;
  taskId: string;
}

export interface WorldOptions {
  budgetMicros?: Micros;
  taskStatus?: TaskStatus;
  capabilityTags?: string[];
}

export function makeWorld(options: WorldOptions = {}): World {
  const clock = new ManualClock();
  const store = new MemoryStore();

  const project: ProjectRow = {
    id: "prj_1",
    workspaceId: "ws_1",
    goal: "Build a landing page",
    mode: "REVIEW",
    status: "RUNNING",
    budgetLimitMicros: options.budgetMicros ?? usd(1),
    alertsFired: 0,
    maxDebateRounds: 1,
  };

  const task: TaskRow = {
    id: "tsk_1",
    projectId: project.id,
    title: "Write the hero section",
    type: "code",
    capabilityTags: options.capabilityTags ?? ["coding"],
    assigneeModelId: GPT,
    reviewerModelId: GEMINI,
    status: options.taskStatus ?? "ASSIGNED",
    priority: 0,
    round: 0,
    version: 0,
    decisionDeadlineAt: null,
    haltReason: null,
  };

  store.db.projects[project.id] = project;
  store.db.tasks[task.id] = task;
  store.db.modelConfigs[GPT] = gptConfig();
  store.db.modelConfigs[GEMINI] = geminiConfig();

  return { clock, store, projectId: project.id, taskId: task.id };
}

/** $3 / 1M input, $15 / 1M output. */
export function gptConfig(): ModelConfigRow {
  return {
    id: GPT,
    provider: "OPENAI",
    modelId: "gpt-primary",
    displayName: "GPT",
    enabled: true,
    inputPriceMicrosPerToken: 3n,
    outputPriceMicrosPerToken: 15n,
    contextLimitTokens: 128_000,
    maxOutputTokens: 8_000,
    capabilities: {
      planning: 0.85,
      copywriting: 0.9,
      coding: 0.9,
      debugging: 0.85,
      image_understanding: 0.35,
      final_synthesis: 0.9,
      fact_check: 0.75,
    },
    capabilityPriors: { coding: 0.7, copywriting: 0.7, final_synthesis: 0.7, planning: 0.7 },
  };
}

/** $1 / 1M input, $4 / 1M output. */
export function geminiConfig(): ModelConfigRow {
  return {
    id: GEMINI,
    provider: "GOOGLE",
    modelId: "gemini-primary",
    displayName: "Gemini",
    enabled: true,
    inputPriceMicrosPerToken: 1n,
    outputPriceMicrosPerToken: 4n,
    contextLimitTokens: 1_000_000,
    maxOutputTokens: 8_000,
    capabilities: {
      planning: 0.8,
      copywriting: 0.8,
      coding: 0.7,
      image_understanding: 0.95,
      visual_direction: 0.95,
      document_analysis: 0.9,
      fact_check: 0.8,
    },
    capabilityPriors: { image_understanding: 0.7, visual_direction: 0.7, coding: 0.5 },
  };
}

/** Inserts a run row directly, bypassing admission. For lease/settle unit tests. */
export function seedRun(world: World, overrides: Partial<RunRow> = {}): RunRow {
  const run: RunRow = {
    id: overrides.id ?? "run_seed",
    taskId: overrides.taskId ?? world.taskId,
    projectId: overrides.projectId ?? world.projectId,
    modelConfigId: overrides.modelConfigId ?? GPT,
    contextPackageId: null,
    status: overrides.status ?? "PENDING",
    idempotencyKey: overrides.idempotencyKey ?? `key_${overrides.id ?? "run_seed"}`,
    attemptGroupId: overrides.attemptGroupId ?? "grp_1",
    providerRequestId: overrides.providerRequestId ?? null,
    inputTokens: overrides.inputTokens ?? 0,
    outputTokens: overrides.outputTokens ?? 0,
    maxOutputTokens: overrides.maxOutputTokens ?? 2_000,
    costMicros: overrides.costMicros ?? 0n,
    errorCode: null,
    startedAt: overrides.startedAt ?? world.clock.now(),
    endedAt: null,
  };
  world.store.db.runs[run.id] = run;
  return run;
}

export function seedArtifact(world: World, id = "art_1", headVersion = 0): ArtifactRow {
  const artifact: ArtifactRow = {
    id,
    projectId: world.projectId,
    taskId: world.taskId,
    type: "CODE",
    name: "hero.tsx",
    headVersion,
    activeWriterRunId: null,
  };
  world.store.db.artifacts[id] = artifact;
  return artifact;
}

export function setStats(world: World, modelConfigId: string, tag: string, stats: { n: number; approvals: number; p50Ms?: number }): void {
  world.store.db.stats[`${modelConfigId}:${tag}`] = {
    n: stats.n,
    approvals: stats.approvals,
    p50Ms: stats.p50Ms ?? 0,
  };
}

export function auditTypes(world: World): string[] {
  return world.store.db.audit.map((a) => a.eventType);
}
