/**
 * Seeded pseudo-random number generator.
 *
 * Every stochastic part of the race model draws from one of these so a result is
 * exactly reproducible from its seed, and so a baseline run and a with-skill run
 * can share *common random numbers* (paired simulation): identical start delay,
 * identical per-section speed variance, identical spurt planning rolls. Without
 * that pairing the random noise would swamp the skill's contribution.
 *
 * Implementation is splitmix64-seeded xorshift128+, written from the published
 * algorithm descriptions. Nothing here is derived from the reference simulator.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, boundExclusive). */
  int(boundExclusive: number): number;
  /** A fresh independent stream, deterministically derived from this one. */
  fork(): Rng;
}

/** splitmix64 step, used to expand a single seed into well-distributed state. */
function splitmix64(state: bigint): [bigint, bigint] {
  const z = (state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  let out = z;
  out = ((out ^ (out >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  out = ((out ^ (out >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
  out = out ^ (out >> 31n);
  return [z, out];
}

const MASK = 0xffffffffffffffffn;

export class Xorshift128Plus implements Rng {
  private s0: bigint;
  private s1: bigint;

  constructor(seed: number | bigint) {
    let state = typeof seed === 'bigint' ? seed : BigInt(Math.floor(seed) >>> 0);
    const [n1, a] = splitmix64(state);
    state = n1;
    const [, b] = splitmix64(state);
    this.s0 = a === 0n && b === 0n ? 1n : a;
    this.s1 = b === 0n ? 0x9e3779b97f4a7c15n : b;
  }

  private step(): bigint {
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x = (x ^ ((x << 23n) & MASK)) & MASK;
    x = x ^ (x >> 17n);
    x = x ^ y;
    x = x ^ (y >> 26n);
    this.s1 = x;
    return (this.s0 + this.s1) & MASK;
  }

  next(): number {
    // Take the top 53 bits so the result is a uniformly spaced double in [0, 1).
    const bits = this.step() >> 11n;
    return Number(bits) / 9007199254740992;
  }

  int(boundExclusive: number): number {
    if (boundExclusive <= 0) return 0;
    return Math.floor(this.next() * boundExclusive);
  }

  fork(): Rng {
    return new Xorshift128Plus(this.step());
  }
}

export const createRng = (seed: number | bigint): Rng => new Xorshift128Plus(seed);

/**
 * Deterministically mixes a base seed with a label, so independent streams (start
 * delay, section variance, spurt planning, skill procs) never correlate while
 * still being reproducible.
 */
export function seedFor(baseSeed: number, label: string): number {
  let h = 0x811c9dc5 ^ (baseSeed >>> 0);
  for (let i = 0; i < label.length; i += 1) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Sample mean, sample standard deviation and a normal-approximation 95 % CI. */
export function summarize(values: number[]): {
  n: number;
  mean: number;
  stdDev: number;
  ci95: [number, number];
  min: number;
  max: number;
} {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, stdDev: 0, ci95: [0, 0], min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const halfWidth = n > 1 ? (1.96 * stdDev) / Math.sqrt(n) : 0;
  return {
    n,
    mean,
    stdDev,
    ci95: [mean - halfWidth, mean + halfWidth],
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
