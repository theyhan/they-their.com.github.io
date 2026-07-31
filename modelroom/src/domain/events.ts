// Spec v1.0 §10: provider events normalized into exactly these application events.
// Business logic must never see a provider-shaped object.

import type { Micros } from "./money.ts";

export interface TextDeltaEvent {
  type: "text_delta";
  text: string;
}

export interface ToolRequestEvent {
  type: "tool_request";
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  callId: string;
  result: unknown;
}

export interface ArtifactEvent {
  type: "artifact";
  name: string;
  mimeType: string;
  /** Inline content, or a storage URI once uploaded. */
  content: string;
}

export interface UsageEvent {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
}

export interface CompletedEvent {
  type: "completed";
  /** Normalized structured result per §13, when the model produced one. */
  result?: unknown;
}

export interface FailedEvent {
  type: "failed";
  code: FailureCode;
  message: string;
  retryable: boolean;
}

/** §16 error taxonomy, normalized across providers. */
export const FailureCode = {
  RATE_LIMIT: "RATE_LIMIT",
  TIMEOUT: "TIMEOUT",
  INVALID_STRUCTURED_OUTPUT: "INVALID_STRUCTURED_OUTPUT",
  SAFETY_REFUSAL: "SAFETY_REFUSAL",
  CONTEXT_LENGTH: "CONTEXT_LENGTH",
  AUTH: "AUTH",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  CANCELLED: "CANCELLED",
  OUTPUT_CAP_EXCEEDED: "OUTPUT_CAP_EXCEEDED",
} as const;
export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];

/**
 * Emitted as soon as the provider hands back a handle. Not in §10, but D2 depends
 * on persisting this before any content processing: without it, a dropped socket
 * leaves a run we may have been billed for and cannot reconcile.
 */
export interface AcceptedEvent {
  type: "accepted";
  providerRequestId: string;
}

export type ModelEvent =
  | AcceptedEvent
  | TextDeltaEvent
  | ToolRequestEvent
  | ToolResultEvent
  | ArtifactEvent
  | UsageEvent
  | CompletedEvent
  | FailedEvent;

export interface CostEstimate {
  estimatedInputTokens: number;
  maxOutputTokens: number;
  worstCaseMicros: Micros;
}

export interface ModelCapabilities {
  contextLimitTokens: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  supportsImageInput: boolean;
  supportsImageOutput: boolean;
  /** capability tag -> competence in [0,1]; feeds the D5 assignment score. */
  tags: Record<string, number>;
}
