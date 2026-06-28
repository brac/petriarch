// Snapshot / restore: serialize the full World to a compact binary blob and
// restore it in place (docs/tooling.md). Restore-in-place means the loop, renderer,
// and HUD keep their existing World reference — only its contents change — so no
// reference juggling.
//
// Determinism: restore is self-consistent — two worlds restored from the same
// snapshot evolve bit-identically (the PRNG stream position is captured). That's
// what the real use cases need: save/load gives a valid continuing sim, and
// fork-and-A/B compares two restores of the same state under different
// perturbations. (Per-think scratch — sense aggregates — is NOT serialized; it's
// recomputed each think and `spawn` zeroes it for reused slots, so it never carries
// stale history into a restored run.)

import type { World } from "../state/world";
import type { Agents } from "../state/pools";
import { GENE_COUNT } from "../data/genome";
import { MAX_AGENTS, RESOURCE_GRID_W, RESOURCE_GRID_H } from "../data/capacity";

const MAGIC = 0x50455452; // "PETR"
const VERSION = 5; // v2:+claim; v3:+danger; v4:+passability; v5:+nutrient B (resourceB, resourceCapB)
const GRID_LEN = RESOURCE_GRID_W * RESOURCE_GRID_H;

// Meta scalar slots (one Float64 each; holds uint32s and the sim clock exactly).
const M = {
  MAGIC: 0, VERSION: 1, RNG: 2, TICK: 3, TIME: 4, THINK: 5, COUNT: 6,
  BORN: 7, DIED: 8, ACTIVE: 9, THINKINT: 10, NBR: 11, LIN_COUNT: 12,
  LIN_NEXT: 13, HZ_X: 14, HZ_Y: 15, HZ_R: 16, HZ_LIFE: 17,
  CAP: 18, GC: 19, GRID: 20,
} as const;
const META_LEN = 21;

// The per-agent Float32 fields that ARE persistent state (not recomputed scratch),
// in a fixed order shared by serialize + restore.
const F32_COUNT = 9;
function f32Fields(a: Agents): Float32Array[] {
  return [a.posX, a.posY, a.velX, a.velY, a.energy, a.age, a.steerX, a.steerY, a.fightCd];
}

/** Serialize the active set + resource field to a transferable ArrayBuffer. */
export function serializeWorld(world: World): ArrayBuffer {
  const a = world.agents;
  const n = a.count;
  const gc = GENE_COUNT;

  // Layout (all 4-byte-aligned; the lone Uint8 array goes last):
  //   meta(f64×META_LEN) | F32_COUNT×f32[n] | lineageId i32[n] | genes f32[n*gc]
  //   | resources f32[GRID] | resourceCap f32[GRID] | resourceB f32[GRID] | resourceCapB f32[GRID]
  //   | claimMag f32[GRID] | claimSigA/B/C f32[GRID] | danger f32[GRID]
  //   | passability f32[GRID] | alive u8[n]
  const GRID_FIELDS = 10; // the 8 below + resourceB + resourceCapB
  const bytes =
    META_LEN * 8 + F32_COUNT * n * 4 + n * 4 + n * gc * 4 + GRID_LEN * 4 * GRID_FIELDS + n * 1;
  const buf = new ArrayBuffer(bytes);
  const u8 = new Uint8Array(buf);
  let off = 0;
  const put = (v: ArrayBufferView): void => {
    u8.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), off);
    off += v.byteLength;
  };

  const meta = new Float64Array(META_LEN);
  meta[M.MAGIC] = MAGIC;
  meta[M.VERSION] = VERSION;
  meta[M.RNG] = world.rng.getState();
  meta[M.TICK] = world.tick;
  meta[M.TIME] = world.time;
  meta[M.THINK] = world.thinkTimer;
  meta[M.COUNT] = n;
  meta[M.BORN] = a.bornTotal;
  meta[M.DIED] = a.diedTotal;
  meta[M.ACTIVE] = world.intensity.activeCount;
  meta[M.THINKINT] = world.intensity.thinkInterval;
  meta[M.NBR] = world.intensity.neighborBudget;
  meta[M.LIN_COUNT] = world.lineage.count;
  meta[M.LIN_NEXT] = world.lineage.nextId;
  meta[M.HZ_X] = world.hazard.x;
  meta[M.HZ_Y] = world.hazard.y;
  meta[M.HZ_R] = world.hazard.r;
  meta[M.HZ_LIFE] = world.hazard.life;
  meta[M.CAP] = a.capacity;
  meta[M.GC] = gc;
  meta[M.GRID] = GRID_LEN;
  put(meta);

  for (const f of f32Fields(a)) put(f.subarray(0, n));
  put(a.lineageId.subarray(0, n));
  put(a.genes.subarray(0, n * gc));
  put(world.resources);
  put(world.resourceCap);
  put(world.resourceB);
  put(world.resourceCapB);
  put(world.claimMag);
  put(world.claimSigA);
  put(world.claimSigB);
  put(world.claimSigC);
  put(world.danger);
  put(world.passability);
  put(a.alive.subarray(0, n));

  return buf;
}

/**
 * Restore a snapshot into an existing world (in place). Throws on a bad blob or a
 * capacity/gene-count mismatch (snapshots are tied to a build's constants).
 */
export function restoreWorld(world: World, buf: ArrayBuffer): void {
  const meta = new Float64Array(buf, 0, META_LEN);
  if (meta[M.MAGIC] !== MAGIC) throw new Error("snapshot: bad magic (not a Petriarch snapshot)");
  if (meta[M.VERSION] !== VERSION) throw new Error(`snapshot: version ${meta[M.VERSION]} != ${VERSION}`);
  if (meta[M.CAP] !== MAX_AGENTS) throw new Error("snapshot: MAX_AGENTS mismatch");
  if (meta[M.GC] !== GENE_COUNT) throw new Error("snapshot: GENE_COUNT mismatch");
  if (meta[M.GRID] !== GRID_LEN) throw new Error("snapshot: resource-grid mismatch");

  const a = world.agents;
  const n = meta[M.COUNT]!;
  const gc = GENE_COUNT;
  let off = META_LEN * 8;
  const readF32 = (len: number): Float32Array => {
    const v = new Float32Array(buf, off, len);
    off += len * 4;
    return v;
  };

  for (const f of f32Fields(a)) f.set(readF32(n));
  a.lineageId.set(new Int32Array(buf, off, n));
  off += n * 4;
  a.genes.set(readF32(n * gc));
  world.resources.set(readF32(GRID_LEN));
  world.resourceCap.set(readF32(GRID_LEN));
  world.resourceB.set(readF32(GRID_LEN));
  world.resourceCapB.set(readF32(GRID_LEN));
  world.claimMag.set(readF32(GRID_LEN));
  world.claimSigA.set(readF32(GRID_LEN));
  world.claimSigB.set(readF32(GRID_LEN));
  world.claimSigC.set(readF32(GRID_LEN));
  world.danger.set(readF32(GRID_LEN));
  world.passability.set(readF32(GRID_LEN));
  a.alive.set(new Uint8Array(buf, off, n));
  off += n;

  a.count = n;
  a.bornTotal = meta[M.BORN]!;
  a.diedTotal = meta[M.DIED]!;
  world.tick = meta[M.TICK]!;
  world.time = meta[M.TIME]!;
  world.thinkTimer = meta[M.THINK]!;
  world.rng.setState(meta[M.RNG]!);
  world.intensity.activeCount = meta[M.ACTIVE]!;
  world.intensity.thinkInterval = meta[M.THINKINT]!;
  world.intensity.neighborBudget = meta[M.NBR]!;
  world.lineage.count = meta[M.LIN_COUNT]!;
  world.lineage.nextId = meta[M.LIN_NEXT]!;
  world.hazard.x = meta[M.HZ_X]!;
  world.hazard.y = meta[M.HZ_Y]!;
  world.hazard.r = meta[M.HZ_R]!;
  world.hazard.life = meta[M.HZ_LIFE]!;
  // Transient visual sparks aren't serialized; clear them so a load starts clean.
  world.sparks.count = 0;

  // Rebuild the spatial hash so the next tick senses the restored positions.
  world.hash.build(a.posX, a.posY, a.count);
}
