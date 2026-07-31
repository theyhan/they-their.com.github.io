// Spec v1.1 D7.
//
// OpenAI Responses state and Gemini Interactions state are per-provider and cannot be
// handed to each other, so this package is the ONLY channel between the two models.
// That makes it the highest-value record in the system for debugging, and it is why it
// is persisted and hashed rather than assembled transiently in memory.

import type { Micros } from "../domain/money.ts";
import type { ArtifactRow, ContextPackagePayload, ContextPackageRow, SourceRefs } from "../domain/rows.ts";
import type { Clock } from "../ports/clock.ts";
import type { Tx } from "../ports/store.ts";
import { ContextTooLarge, NotFound } from "./errors.ts";
import { estimateTokens, estimateTokensOfValue, hashPayload } from "../infra/hash.ts";

/** Headroom for provider-side prompt scaffolding we do not control. */
export const SAFETY_MARGIN_TOKENS = 512;

/** Files larger than this are summarized rather than inlined. */
export const FILE_SUMMARY_THRESHOLD_TOKENS = 2_000;

export interface Summarizer {
  summarize(input: { fileId: string; name: string; content: string; maxTokens: number }): string;
}

export interface FileInput {
  id: string;
  name: string;
  content: string;
}

export interface BuildContextInput {
  taskId: string;
  round: number;
  targetModelConfigId: string;
  /** Tokens reserved for the response; subtracted from the context window. */
  reservedOutputTokens: number;
  projectGoal: string;
  completionCriteria: string[];
  reviewCriteria: string[];
  decisions: Array<{ id: string; selectedOption: string; rationale: string | null }>;
  counterpartDeliverable: { artifactVersionId: string; content: string } | null;
  files: FileInput[];
  remainingRounds: number;
  remainingBudgetMicros: Micros;
  reviewIds?: string[];
}

export interface BuildDeps {
  clock: Clock;
  summarizer: Summarizer;
}

/**
 * Deterministic given (task, round, source refs): the same inputs always produce the
 * same payload and therefore the same contentHash, which is what makes a historical
 * run replayable and verifiable.
 */
export function buildContextPackage(tx: Tx, input: BuildContextInput, deps: BuildDeps): ContextPackageRow {
  const task = tx.getTask(input.taskId);
  if (!task) throw new NotFound("Task", input.taskId);

  const config = tx.getModelConfig(input.targetModelConfigId);
  if (!config) throw new NotFound("ModelConfig", input.targetModelConfigId);

  const tokenBudget = config.contextLimitTokens - input.reservedOutputTokens - SAFETY_MARGIN_TOKENS;
  if (tokenBudget <= 0) {
    throw new ContextTooLarge(0, tokenBudget);
  }

  const files = input.files
    // Sorted so file ordering cannot vary between an original run and its replay.
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((file) => summarizeIfOversized(tx, task.projectId, file, deps, FILE_SUMMARY_THRESHOLD_TOKENS));

  let payload: ContextPackagePayload = {
    projectGoal: input.projectGoal,
    task: {
      id: task.id,
      title: task.title,
      completionCriteria: input.completionCriteria,
    },
    decisions: input.decisions,
    counterpartDeliverable: input.counterpartDeliverable?.content ?? null,
    files: files.map((f) => ({ id: f.id, name: f.name, content: f.content, summarized: f.summarized })),
    reviewCriteria: input.reviewCriteria,
    remainingRounds: input.remainingRounds,
    remainingBudgetMicros: input.remainingBudgetMicros.toString(),
  };

  // Still too big: shrink the largest file first and re-measure. Compressing the
  // biggest contributor is both the fastest way under budget and the least
  // destructive to the smaller files that often carry the review criteria.
  let guard = 0;
  while (estimateTokensOfValue(payload) > tokenBudget) {
    if (guard++ > files.length) {
      throw new ContextTooLarge(estimateTokensOfValue(payload), tokenBudget);
    }
    const largest = payload.files.reduce<{ index: number; tokens: number }>(
      (worst, file, index) => {
        const tokens = estimateTokens(file.content);
        return tokens > worst.tokens ? { index, tokens } : worst;
      },
      { index: -1, tokens: -1 },
    );
    if (largest.index < 0) {
      throw new ContextTooLarge(estimateTokensOfValue(payload), tokenBudget);
    }

    const target = payload.files[largest.index];
    if (!target) throw new ContextTooLarge(estimateTokensOfValue(payload), tokenBudget);

    const shrunk = deps.summarizer.summarize({
      fileId: target.id,
      name: target.name,
      content: target.content,
      maxTokens: Math.max(128, Math.floor(largest.tokens / 2)),
    });
    if (estimateTokens(shrunk) >= largest.tokens) {
      // The summarizer cannot make progress; failing is correct because silently
      // truncating would hand the reviewer a deliverable it cannot fairly judge.
      throw new ContextTooLarge(estimateTokensOfValue(payload), tokenBudget);
    }

    const nextFiles = payload.files.slice();
    nextFiles[largest.index] = { ...target, content: shrunk, summarized: true };
    payload = { ...payload, files: nextFiles };
    recordSummaryArtifact(tx, task.projectId, task.id, target.id, target.name, shrunk, deps);
  }

  const sourceRefs: SourceRefs = {
    artifactVersionIds: input.counterpartDeliverable ? [input.counterpartDeliverable.artifactVersionId] : [],
    decisionIds: input.decisions.map((d) => d.id),
    reviewIds: input.reviewIds ?? [],
    fileIds: files.map((f) => f.id),
  };

  const row: ContextPackageRow = {
    id: tx.nextId("ctx"),
    taskId: input.taskId,
    round: input.round,
    targetProvider: config.provider,
    payload,
    tokenEstimate: estimateTokensOfValue(payload),
    contentHash: hashPayload(payload),
    sourceRefs,
    createdAt: deps.clock.now(),
  };
  tx.insertContextPackage(row);
  return row;
}

interface PreparedFile {
  id: string;
  name: string;
  content: string;
  summarized: boolean;
}

function summarizeIfOversized(
  tx: Tx,
  projectId: string,
  file: FileInput,
  deps: BuildDeps,
  thresholdTokens: number,
): PreparedFile {
  const tokens = estimateTokens(file.content);
  if (tokens <= thresholdTokens) {
    return { id: file.id, name: file.name, content: file.content, summarized: false };
  }

  const summary = deps.summarizer.summarize({
    fileId: file.id,
    name: file.name,
    content: file.content,
    maxTokens: thresholdTokens,
  });
  recordSummaryArtifact(tx, projectId, null, file.id, file.name, summary, deps);
  return { id: file.id, name: file.name, content: summary, summarized: true };
}

/**
 * Summaries are stored as first-class SUMMARY artifacts.
 *
 * Lossy summarization is the most likely root cause of "the reviewer missed something
 * obvious". If it happens invisibly there is no way to diagnose that, so what the
 * reviewer actually saw has to be an inspectable record.
 */
function recordSummaryArtifact(
  tx: Tx,
  projectId: string,
  taskId: string | null,
  sourceFileId: string,
  name: string,
  content: string,
  deps: BuildDeps,
): void {
  const artifactId = tx.nextId("art");
  const artifact: ArtifactRow = {
    id: artifactId,
    projectId,
    taskId,
    type: "SUMMARY",
    name: `summary:${name}`,
    headVersion: 1,
    activeWriterRunId: null,
  };
  tx.insertArtifact(artifact);
  tx.insertArtifactVersion({
    id: tx.nextId("ver"),
    artifactId,
    version: 1,
    baseVersion: 0,
    uri: `inline:${content}`,
    sizeBytes: content.length,
    createdByRunId: null,
    epoch: 0,
    createdAt: deps.clock.now(),
  });
  tx.insertAudit({
    id: tx.nextId("aud"),
    projectId,
    taskId,
    runId: null,
    eventType: "FILE_SUMMARIZED",
    actorId: null,
    payload: { sourceFileId, summaryArtifactId: artifactId, summaryTokens: estimateTokens(content) },
    createdAt: deps.clock.now(),
  });
}
