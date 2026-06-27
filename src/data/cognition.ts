// Cognition tunables (data-driven; read live by the steer pass on CPU and pushed
// to the steer kernel's param uniform on GPU — same single source of truth).
//
// The Ant rung adds two knobs on top of the existing gene-weighted steering sum:
//   A. level  — a global ceiling on the deliberate (gene-weighted) terms, scaled
//      against the always-on wander term. 1 = today's behavior exactly; 0 = pure
//      random walk (Worm). Lives on the live HUD slider.
//   B. mask   — a per-term bitmask. A cleared bit drops that term from the sum
//      (and, for FOOD, skips its resource-cell sample). Lives on the dev-panel
//      toggle bank.
//
// Weight source is Genes × level: each term's weight is its evolved gene times
// `level` (wander excepted). So `level=1, mask=all` is algebraically identical to
// the pre-Ant-rung blend — no regression. New terms (trail/claim/danger) get
// appended here when the stigmergy substrate lands.

export const COG = {
  FOOD: 1 << 0, // resource gradient (RESOURCE_ATTRACT)
  KIN: 1 << 1, // kin cohesion (KIN_COHESION)
  SEP: 1 << 2, // separation (SEPARATION)
  AVOID: 1 << 3, // threat avoidance (THREAT_AVOID)
  WANDER: 1 << 4, // seeded random wander (WANDER)
} as const;

export const COG_ALL = COG.FOOD | COG.KIN | COG.SEP | COG.AVOID | COG.WANDER;

/** Mutated live by HUD slider / dev-panel toggles / preset buttons. */
export const COGNITION = {
  level: 1.0, // [0,1] global ceiling on deliberate terms
  mask: COG_ALL, // enabled-term bitmask
};

export type CogPreset = { level: number; mask: number };

export const COG_PRESETS: Record<"worm" | "ant" | "full", CogPreset> = {
  worm: { level: 0.0, mask: COG.WANDER }, // random walk only
  ant: { level: 0.8, mask: COG.FOOD | COG.AVOID | COG.WANDER }, // climb food, flee threat
  full: { level: 1.0, mask: COG_ALL }, // every evolved term at full ceiling
};
