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
  /** number of rich "veins" seeded when clumping > 0. Scaled with world area (14 → 56 for
   * the 4× map) so vein density — and thus the food landscape's feel — stays constant. */
  clumpCount: 56,
  /** fraction of cellCapacity a cell holds at world start (low → no boom into cap). */
  startFrac: 0.35,

  // --- two-good worldgen (foundation for inter-region trade) --- nutrient A (`resources`)
  // and nutrient B (`resourceB`) clump in SEPARATE regions with a barren gap between, so two
  // societies form and must eventually trade across the dead zone (a desert: passable, no
  // food). Centers/spreads are fractions of world W/H; the gap is the band where neither
  // region reaches. `clumpCount` is split evenly between A (left) and B (right).
  regionACenterX: 0.24, // A-region anchor x (left)
  regionBCenterX: 0.76, // B-region anchor x (right)
  regionCenterY: 0.5, // both regions centered vertically
  regionSpreadX: 0.19, // clumps + ambient food scatter ±this·W around the anchor in x
  regionSpreadY: 0.42, // ±this·H in y (tall regions fill the vertical)

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
