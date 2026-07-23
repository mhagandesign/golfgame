/** Deterministic seeded RNG (mulberry32) so sim outcomes are testable. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Approximately normal (sum of 4 uniforms, recentred). */
  gaussian(mean = 0, stdev = 1): number {
    const s = this.next() + this.next() + this.next() + this.next();
    return mean + (s - 2) * Math.SQRT2 * 0.5 * stdev * 2;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
}
