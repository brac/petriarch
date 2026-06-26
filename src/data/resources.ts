// Resource field tunables (regrowth, distribution). STUB — populated in Milestone
// 1 when resources.ts (Tier B) is written. Regrowth rate and spatial distribution
// are the single biggest lever on which strategies win (docs/genome.md): clumped
// favors territorial hoarders, scattered favors wanderers.

export const RESOURCES = {
  /** Energy regrown per cell per tick. */
  regrowthRate: 0,
  /** Max energy a cell can hold. */
  cellCapacity: 0,
  /** 0 = scattered, 1 = clumped (distribution shaping for the dev panel). */
  clumping: 0,
} as const;
