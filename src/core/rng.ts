// Seeded PRNG — mulberry32. The ONLY randomness source in the sim (CLAUDE.md rule
// 7). Every random call — mutation, spawn jitter, conflict rolls, wander — goes
// through one instance owned by World. No bare Math.random() anywhere: seeded runs
// are reproducible, which is how snapshot/restore and headless runs stay
// deterministic. (Ported verbatim from swarmr.)

export class Rng {
  private state: number;

  constructor(seed: number) {
    // coerce to uint32
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max). */
  int(min: number, max: number): number {
    return (min + this.next() * (max - min)) | 0;
  }

  /** Reseed in place (useful for deterministic test setups). */
  reseed(seed: number): void {
    this.state = seed >>> 0;
  }
}
