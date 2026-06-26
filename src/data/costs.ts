// Metabolic cost tunables (energy drain / intake), per TICK. Every gene must carry
// a cost or tradeoff (docs/genome.md design law) — these are where SIZE and
// METABOLIC_RATE earn their downsides. Total drain per tick is roughly:
//   (baseDrain + SIZE*sizeDrain + speed*SIZE*moveCost) * METABOLIC_RATE  (+senescence)

export const COSTS = {
  /** flat baseline drain per tick — NOT scaled by METABOLIC_RATE (metabolism.ts),
   * so evolution can't escape its energy cost and push carrying capacity past the
   * population cap. This is the main knob on food-bound carrying capacity. */
  baseDrain: 0.05,
  /** extra drain per tick per unit SIZE (big bodies are expensive). */
  sizeDrain: 0.05,
  /** drain per tick per (px/sec of speed × SIZE) — moving costs energy. */
  moveCost: 0.0009,
  /** extra drain per tick once past LIFESPAN's senescence onset (80%). */
  senescenceDrain: 0.25,
  /** max energy pulled from a resource cell per tick (before size scaling). */
  intakeRate: 1.1,
  /** intake scales as SIZE^intakeSizeExp — bigger mouths harvest a rich patch
   * faster, so big bodies can actually accumulate energy to breed (and to dominate
   * rich clumps). 0 = flat (old behavior), 1 = linear in size. */
  intakeSizeExp: 1.0,
  /** energy drained per tick to an agent inside an active hazard zone. */
  hazardDrain: 1.5,
} as const;
