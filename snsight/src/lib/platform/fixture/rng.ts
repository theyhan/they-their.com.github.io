/**
 * Deterministic pseudo-random source for the fixture provider (ADR-0007 decision 2).
 *
 * `Math.random` would make fixture data irreproducible, which defeats the point: a failing
 * dashboard state must be reproducible from its seed alone.
 */

/** mulberry32. Small, fast, and adequate for generating plausible sample data. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(minInclusive: number, maxInclusive: number): number {
      return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
    },
    /** Log-normal-ish shape, because engagement counts are heavy-tailed rather than uniform. */
    skewedInt(minInclusive: number, maxInclusive: number, skew = 2): number {
      const r = Math.pow(next(), skew);
      return Math.round(minInclusive + r * (maxInclusive - minInclusive));
    },
    bool(probabilityTrue: number): boolean {
      return next() < probabilityTrue;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('cannot pick from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
  };
}

export interface Rng {
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  skewedInt(minInclusive: number, maxInclusive: number, skew?: number): number;
  bool(probabilityTrue: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** Stable numeric seed from a string, so a workspace id maps to the same data every run. */
export function seedFromString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
