// Time as a dependency. Lease expiry (D4) and decision deadlines (D3) are the two
// places where "it worked on my machine at 3pm" is a real failure mode, so tests
// drive time explicitly rather than sleeping.

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export class ManualClock implements Clock {
  private current: number;

  constructor(start = 1_767_225_600_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(ms: number): void {
    this.current = ms;
  }
}
