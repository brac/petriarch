// Resource field tunables (Tier B). Regrowth rate and spatial distribution are the
// single biggest lever on which strategies win (docs/genome.md): clumped favors
// territorial hoarders, scattered favors wanderers. The field regrows each cell
// toward a per-cell capacity that is shaped at init by `clumping`.

export const RESOURCES = {
  /** energy regrown per cell per tick. */
  regrowthRate: 0.06,
  /** max energy a cell can hold (and the bright end of the render scale). */
  cellCapacity: 20,
  /** 0 = uniform scatter, 1 = strong clumps. Shapes the capacity field at init. */
  clumping: 0.7,
  /** number of rich "veins" seeded when clumping > 0. */
  clumpCount: 14,
  /** fraction of cellCapacity a cell holds at world start. */
  startFrac: 0.6,

  // --- god: resource bloom ---
  /** radius (px) of a bloom drop. */
  bloomRadius: 140,
  /** capacity a bloom raises cells to (rich, regrows back fast). */
  bloomCapacity: 40,

  // --- god: hazard zone ---
  /** radius (px) of a hazard drop. */
  hazardRadius: 130,
  /** how many ticks a hazard stays lethal. */
  hazardTicks: 600,

  // --- god: smite ---
  /** radius (px) of a smite. */
  smiteRadius: 90,
} as const;
