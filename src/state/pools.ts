// Agent storage as Structure-of-Arrays over typed arrays. This *is* the pool
// (CLAUDE.md rules 1-2): capacity is pre-allocated once at MAX_AGENTS, the active
// set is packed in [0, count), birth is O(1) at the end, and death is an O(1)
// swap-remove. Zero per-frame allocation — the whole performance story starts here.
// The spatial hash stores indices into these arrays. There is no Agent class.
//
// The genome is one flat Float32Array of length capacity*GENE_COUNT; agent i's
// genes occupy [i*GENE_COUNT .. i*GENE_COUNT+GENE_COUNT). Access is always
// genes[i*GENE_COUNT + GENE.X] (docs/genome.md — the WebGPU buffer contract).

import { GENE_COUNT } from "../data/genome";

export class Agents {
  readonly capacity: number;
  count = 0;

  // --- per-agent scalar fields (each its own typed array) ---
  readonly posX: Float32Array;
  readonly posY: Float32Array;
  readonly velX: Float32Array;
  readonly velY: Float32Array;
  readonly energy: Float32Array;
  readonly age: Float32Array;
  // Cached steering vector: written by steer.ts every THINK_INTERVAL, consumed by
  // integrate.ts every tick (cognition decoupled from action — CLAUDE.md rule 6).
  readonly steerX: Float32Array;
  readonly steerY: Float32Array;
  readonly lineageId: Int32Array;
  readonly alive: Uint8Array;

  // --- flat genome buffer (GENE_COUNT floats per agent) ---
  readonly genes: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.posX = new Float32Array(capacity);
    this.posY = new Float32Array(capacity);
    this.velX = new Float32Array(capacity);
    this.velY = new Float32Array(capacity);
    this.energy = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.steerX = new Float32Array(capacity);
    this.steerY = new Float32Array(capacity);
    this.lineageId = new Int32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.genes = new Float32Array(capacity * GENE_COUNT);
  }

  /**
   * Activate one agent at (x, y) with the given energy and lineage. Returns its
   * index, or -1 if at capacity. The caller writes the genome slice at
   * [i*GENE_COUNT ..] (e.g. reproduce.ts copies + mutates the parent's). Zero-alloc.
   */
  spawn(x: number, y: number, energy: number, lineageId: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.posX[i] = x;
    this.posY[i] = y;
    this.velX[i] = 0;
    this.velY[i] = 0;
    this.energy[i] = energy;
    this.age[i] = 0;
    this.steerX[i] = 0;
    this.steerY[i] = 0;
    this.lineageId[i] = lineageId;
    this.alive[i] = 1;
    return i;
  }

  /**
   * Remove agent i by swapping the last active agent into its slot. O(1), keeps the
   * active set packed. NOTE: this invalidates index i (now holds a different agent)
   * and the old last index — callers iterating must re-check i or collect dead
   * indices and apply kills in reverse.
   */
  kill(i: number): void {
    const last = --this.count;
    this.posX[i] = this.posX[last]!;
    this.posY[i] = this.posY[last]!;
    this.velX[i] = this.velX[last]!;
    this.velY[i] = this.velY[last]!;
    this.energy[i] = this.energy[last]!;
    this.age[i] = this.age[last]!;
    this.steerX[i] = this.steerX[last]!;
    this.steerY[i] = this.steerY[last]!;
    this.lineageId[i] = this.lineageId[last]!;
    this.alive[i] = this.alive[last]!;
    // Swap the whole genome slice down in one copy.
    this.genes.copyWithin(i * GENE_COUNT, last * GENE_COUNT, (last + 1) * GENE_COUNT);
  }
}
