// The genome contract (see docs/genome.md). Every gene is a float in one flat
// SoA buffer; agent i's genome occupies [i*GENE_COUNT .. i*GENE_COUNT+GENE_COUNT).
// The ONLY legal access pattern anywhere in the codebase is
//   genes[i * GENE_COUNT + GENE.X]
// — identical to what a WGSL compute shader binds. No wrapper objects (CLAUDE.md
// rule 3). Adding a gene = append an index, bump GENE_COUNT, add a GENE_RANGE row.

export const GENE = {
  // --- metabolic / body (the cost backbone) ---
  SIZE: 0,
  METABOLIC_RATE: 1,
  REPRO_THRESHOLD: 2,
  LIFESPAN: 3,
  FERTILITY: 4,
  MUTABILITY: 5,
  // --- steering / behavior (Tier A — read by the steering pass) ---
  KIN_COHESION: 6,
  SEPARATION: 7,
  RESOURCE_ATTRACT: 8,
  THREAT_AVOID: 9,
  WANDER: 10,
  AGGRESSION: 11,
  // --- social tag (group identity; drifts → speciation; maps to hue) ---
  SIG_A: 12,
  SIG_B: 13,
  SIG_C: 14,
  // --- morphology / body (Milestone 2 — bodies evolve, not just behavior) ---
  RESILIENCE: 15, // armor: less conflict/hazard damage, but heavier (more move drain)
  EFFICIENCY: 16, // digestion: more energy per resource, but slower
  // --- social (authored Tier B layer) ---
  TRADE: 17, // willingness to barter surplus nutrient with non-hostile complements (vs raid)
} as const;

/** Stride of the genome buffer. Pools and shaders read this constant. */
export const GENE_COUNT = 18;

// Per-gene [min, max], clamped after mutation:
//   Math.max(GENE_RANGE[g][0], Math.min(GENE_RANGE[g][1], v))
// These are the first real tuning surface (docs/genome.md). Units:
//   SIZE            — body scale (× on energy storage, conflict strength, move cost)
//   METABOLIC_RATE  — × on both speed/responsiveness and energy drain
//   REPRO_THRESHOLD — fraction of an agent's max energy required to breed
//   LIFESPAN        — seconds before senescence/death
//   FERTILITY       — offspring per reproduction event
//   MUTABILITY      — per-agent mutation scale applied to its own offspring
//   behavior genes  — [0,1] steering weights
//   SIG_A/B/C       — [0,1] point in tag-space (group identity → hue)
export const GENE_RANGE: Record<number, [number, number]> = {
  [GENE.SIZE]: [0.3, 3.0],
  [GENE.METABOLIC_RATE]: [0.25, 2.0],
  [GENE.REPRO_THRESHOLD]: [0.3, 0.95],
  [GENE.LIFESPAN]: [20, 300],
  [GENE.FERTILITY]: [1, 6],
  [GENE.MUTABILITY]: [0.0, 0.5],
  [GENE.KIN_COHESION]: [0.0, 1.0],
  [GENE.SEPARATION]: [0.0, 1.0],
  [GENE.RESOURCE_ATTRACT]: [0.0, 1.0],
  [GENE.THREAT_AVOID]: [0.0, 1.0],
  [GENE.WANDER]: [0.0, 1.0],
  [GENE.AGGRESSION]: [0.0, 1.0],
  [GENE.SIG_A]: [0.0, 1.0],
  [GENE.SIG_B]: [0.0, 1.0],
  [GENE.SIG_C]: [0.0, 1.0],
  [GENE.RESILIENCE]: [0.0, 1.0],
  [GENE.EFFICIENCY]: [0.0, 1.0],
  [GENE.TRADE]: [0.0, 1.0],
};
