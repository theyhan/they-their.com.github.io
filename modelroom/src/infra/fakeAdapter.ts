// Scripted ModelAdapter. No network, no keys, fully deterministic.
//
// It exists to exercise the failure shapes that matter and that a real provider will
// not reproduce on demand: a socket dropping after the call was accepted, output that
// blows past the cap, and usage that exceeds the reservation.

import type { CostEstimate, FailureCode, ModelCapabilities, ModelEvent } from "../domain/events.ts";
import type { Provider } from "../domain/states.ts";
import type { ContinueTurnInput, ModelAdapter, ModelTurnInput } from "../ports/adapter.ts";
import { estimateTokens } from "./hash.ts";

export interface Script {
  /** Provider handle. `null` models a failure before the request was accepted. */
  providerRequestId?: string | null;
  chunks?: string[];
  usage?: { inputTokens: number; outputTokens: number } | null;
  fail?: { code: FailureCode; message: string; retryable: boolean } | null;
  /**
   * Throw a transport error after `accepted`. The outcome is genuinely unknown: the
   * provider may have completed and billed us. This is the case the D2 sweeper exists
   * for, and the case a naive retry double-charges.
   */
  dropAfterAccept?: boolean;
  /** Keep streaming past the cap so worker-side enforcement can be observed. */
  ignoreOutputCap?: boolean;
}

export class TransportError extends Error {
  constructor(message = "socket hang up") {
    super(message);
    this.name = "TransportError";
  }
}

export class FakeAdapter implements ModelAdapter {
  readonly provider: Provider;
  readonly cancelled: string[] = [];
  readonly turns: ModelTurnInput[] = [];
  private script: Script;
  private readonly caps: ModelCapabilities;

  constructor(provider: Provider, script: Script = {}, caps?: Partial<ModelCapabilities>) {
    this.provider = provider;
    this.script = script;
    this.caps = {
      contextLimitTokens: caps?.contextLimitTokens ?? 128_000,
      maxOutputTokens: caps?.maxOutputTokens ?? 8_000,
      supportsStreaming: caps?.supportsStreaming ?? true,
      supportsImageInput: caps?.supportsImageInput ?? false,
      supportsImageOutput: caps?.supportsImageOutput ?? false,
      tags: caps?.tags ?? {},
    };
  }

  setScript(script: Script): void {
    this.script = script;
  }

  async *createTurn(input: ModelTurnInput): AsyncIterable<ModelEvent> {
    this.turns.push(input);
    const script = this.script;

    const providerRequestId = script.providerRequestId === undefined ? `prov_${input.runId}` : script.providerRequestId;
    if (providerRequestId !== null) {
      yield { type: "accepted", providerRequestId };
    }

    if (script.dropAfterAccept) {
      throw new TransportError();
    }

    if (script.fail) {
      yield { type: "failed", code: script.fail.code, message: script.fail.message, retryable: script.fail.retryable };
      return;
    }

    let emittedTokens = 0;
    for (const chunk of script.chunks ?? []) {
      if (!script.ignoreOutputCap && emittedTokens >= input.maxOutputTokens) break;
      emittedTokens += estimateTokens(chunk);
      yield { type: "text_delta", text: chunk };
    }

    if (script.usage !== null) {
      yield {
        type: "usage",
        inputTokens: script.usage?.inputTokens ?? estimateTokens(JSON.stringify(input.context)),
        outputTokens: script.usage?.outputTokens ?? emittedTokens,
      };
    }

    yield { type: "completed" };
  }

  async *continueTurn(input: ContinueTurnInput): AsyncIterable<ModelEvent> {
    yield* this.createTurn(input);
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.push(runId);
  }

  async estimateCost(input: ModelTurnInput): Promise<CostEstimate> {
    const estimatedInputTokens = estimateTokens(JSON.stringify(input.context));
    return {
      estimatedInputTokens,
      maxOutputTokens: input.maxOutputTokens,
      worstCaseMicros: 0n,
    };
  }

  capabilities(): ModelCapabilities {
    return this.caps;
  }
}

/** Deterministic stand-in for a model-produced summary. */
export const truncatingSummarizer = {
  summarize(input: { fileId: string; name: string; content: string; maxTokens: number }): string {
    const maxChars = Math.max(16, input.maxTokens * 4);
    if (input.content.length <= maxChars) return input.content;
    return `${input.content.slice(0, maxChars - 16)}...[truncated]`;
  },
};
