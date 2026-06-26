// Metabolic cost tunables (energy drain / intake). STUB — populated in Milestone 1
// when metabolism.ts is written. Kept as a real module so systems import a stable
// path. Every gene must carry a cost or tradeoff (docs/genome.md design law).

export const COSTS = {
  /** Base energy drain per tick before gene scaling. */
  baseMetabolism: 0,
  /** Energy gained per tick standing on a resource site. */
  resourceIntake: 0,
  /** Move cost coefficient (scaled by SIZE / METABOLIC_RATE). */
  moveCost: 0,
} as const;
