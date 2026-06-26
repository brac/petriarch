// Resource field tunables (Tier B). Regrowth rate and spatial distribution are the
// single biggest lever on which strategies win (docs/genome.md): clumped favors
// territorial hoarders, scattered favors wanderers. The field regrows each cell
// toward a per-cell capacity that is shaped at init by `clumping`.

export const RESOURCES = {
  // Tuned so food scarcity — not the population cap — limits the population
  // (docs/TUNING.md §B.1). At full intensity this equilibrates ~2000-2400 agents
  // (cap 5000), with mild famine/regrowth oscillation, instead of pinning at cap.
  /** energy regrown per cell per tick. */
  regrowthRate: 0.045,
  /** max energy a cell can hold (and the bright end of the render scale). */
  cellCapacity: 14,
  /** 0 = uniform scatter, 1 = strong clumps. Shapes the capacity field at init. */
  clumping: 0.7,
  /** number of rich "veins" seeded when clumping > 0. */
  clumpCount: 14,
  /** fraction of cellCapacity a cell holds at world start (low → no boom into cap). */
  startFrac: 0.35,

  // --- god: resource bloom ---
  /** radius (px) of a bloom drop. */
  bloomRadius: 140,
  /** capacity a bloom raises cells to (rich vs the ~14 baseline; regrows back). */
  bloomCapacity: 30,

  // --- god: hazard zone ---
  /** radius (px) of a hazard drop. */
  hazardRadius: 130,
  /** how many ticks a hazard stays lethal. */
  hazardTicks: 600,

  // --- god: smite ---
  /** radius (px) of a smite. */
  smiteRadius: 90,
}; // mutable: the dev panel tunes these live
