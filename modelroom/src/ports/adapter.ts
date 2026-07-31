// Spec v1.0 §10. The only place provider SDKs are allowed to exist.
//
// D10 note: the OpenAI implementation targets the Responses API and the Google one
// targets the Interactions API. The Assistants API is sunset on 2026-08-26 and must
// not be used as a template.

import type { CostEstimate, ModelCapabilities, ModelEvent } from "../domain/events.ts";
import type { Provider } from "../domain/states.ts";
import type { ContextPackagePayload } from "../domain/rows.ts";

export interface ModelTurnInput {
  runId: string;
  modelId: string;
  /** Rendered from the persisted ContextPackage (D7), never from raw history. */
  context: ContextPackagePayload;
  systemInstruction: string;
  /** Hard cap derived from remaining budget at admission time (D1). */
  maxOutputTokens: number;
  /**
   * Opaque provider-side conversation handle. Never translated between providers:
   * OpenAI response/conversation ids and Gemini interaction ids are not
   * interchangeable, which is precisely why the ContextPackage exists.
   */
  providerThreadRef?: string | undefined;
  responseSchema?: Record<string, unknown> | undefined;
}

export interface ContinueTurnInput extends ModelTurnInput {
  toolResults: Array<{ callId: string; result: unknown }>;
}

export interface ModelAdapter {
  readonly provider: Provider;
  createTurn(input: ModelTurnInput): AsyncIterable<ModelEvent>;
  continueTurn(input: ContinueTurnInput): AsyncIterable<ModelEvent>;
  cancel(runId: string): Promise<void>;
  estimateCost(input: ModelTurnInput): Promise<CostEstimate>;
  capabilities(): ModelCapabilities;
}
