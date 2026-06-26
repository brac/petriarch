// Metabolic cost tunables (energy drain / intake), per TICK. Every gene must carry
// a cost or tradeoff (docs/genome.md design law) — these are where SIZE and
// METABOLIC_RATE earn their downsides. Total drain per tick is roughly:
//   (baseDrain + SIZE*sizeDrain + speed*SIZE*moveCost) * METABOLIC_RATE  (+senescence)

export const COSTS = {
  /** baseline energy drain per tick, before any gene scaling. */
  baseDrain: 0.04,
  /** extra drain per tick per unit SIZE (big bodies are expensive). */
  sizeDrain: 0.05,
  /** drain per tick per (px/sec of speed × SIZE) — moving costs energy. */
  moveCost: 0.0009,
  /** extra drain per tick once past LIFESPAN's senescence onset (80%). */
  senescenceDrain: 0.25,
  /** max energy pulled from a resource cell per tick. */
  intakeRate: 1.1,
  /** energy drained per tick to an agent inside an active hazard zone. */
  hazardDrain: 1.5,
} as const;
