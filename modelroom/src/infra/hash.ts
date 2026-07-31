import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted at every depth, bigint rendered as a
 * decimal string. Required for D7 -- a context package hash is only useful for
 * verifying a replay if two structurally identical payloads always serialize
 * identically, which JSON.stringify does not guarantee across key insertion orders.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashPayload(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Coarse token estimate at ~4 characters per token.
 *
 * Deliberately provider-agnostic and deliberately approximate. It exists so the D1
 * reservation and the D7 size budget have a number to work with before any network
 * call. Real adapters must replace it with the provider's own token counting, and
 * because it feeds a *worst-case* reservation, an underestimate is absorbed by the
 * settle step rather than overspending.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateTokensOfValue(value: unknown): number {
  return estimateTokens(canonicalJson(value));
}
