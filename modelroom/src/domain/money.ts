// All money is micro-USD in bigint. 1 USD = 1_000_000 micros.
// Rationale (spec v1.1 preamble): float arithmetic on per-token prices accumulates
// error across thousands of runs, and a budget guard that is off by a fraction of a
// cent is a budget guard that eventually lets a run through.

export type Micros = bigint;

export const MICROS_PER_USD = 1_000_000n;

/** Convert a human dollar amount to micros. Rounds to the nearest micro. */
export function usd(amount: number): Micros {
  return BigInt(Math.round(amount * 1_000_000));
}

/** Price helper: dollars per million tokens -> micros per token. */
export function perMillionTokens(dollarsPerMillion: number): Micros {
  return BigInt(Math.round(dollarsPerMillion));
}

export function maxMicros(a: Micros, b: Micros): Micros {
  return a > b ? a : b;
}

export function formatUsd(m: Micros): string {
  const negative = m < 0n;
  const abs = negative ? -m : m;
  const whole = abs / MICROS_PER_USD;
  const frac = (abs % MICROS_PER_USD).toString().padStart(6, "0");
  return `${negative ? "-" : ""}$${whole.toString()}.${frac.slice(0, 2)}`;
}

/**
 * Cost of a completed call. Kept in one place so the ledger and the pre-run
 * estimate can never disagree about the formula.
 */
export function computeCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerToken: Micros,
  outputPricePerToken: Micros,
): Micros {
  return BigInt(inputTokens) * inputPricePerToken + BigInt(outputTokens) * outputPricePerToken;
}
