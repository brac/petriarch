// Core simulation tunables that aren't per-gene: movement, energy, sensing,
// reproduction, mutation, initial conditions. The biggest levers on "do distinct
// strategies emerge and persist" live here and in resources.ts. All speeds are in
// px/second (the systems multiply by TICK_DT) so they read at human scale.

export const SIM = {
  // --- initial conditions ---
  initialPop: 700,
  // 16 founder signatures: the SPIKE speciation study (docs/BUGS.md) found this ~doubles
  // the count of persistent societies (6→10 tag-space clusters at 10k ticks) vs 8, and it
  // lasts. >16 backfires — 20+ founders over-consolidate back toward ~5 by 10k.
  founderTribes: 16,

  // --- energy ---
  /** max energy = SIZE * maxEnergyPerSize (bigger bodies store more). */
  maxEnergyPerSize: 70,
  /** founders / offspring start at this fraction of their max energy. */
  startEnergyFrac: 0.55,

  // --- movement (px/sec) ---
  /** base top speed, then scaled by METABOLIC_RATE (faster) and SIZE (slower). */
  baseMaxSpeed: 95,
  /** how strongly SIZE slows movement: maxSpeed /= (1-k) + k·SIZE. Lower k = milder
   * penalty, so big bodies can still forage in a patchy world (else they starve
   * between patches and SIZE has no viable niche). */
  sizeSpeedFactor: 0.3,
  /** how hard velocity chases the steering target (per second). */
  steerAccel: 6,
  /** velocity retained at a wall after reflecting. */
  wallBounce: 0.5,

  // --- sensing (px) --- senseRadius must sit within the 3×3 hash block, i.e.
  // <= HASH_CELL_SIZE (a neighbor up to ~1.5 cells away is covered).
  senseRadius: 60,
  separationRadius: 26,
  /** tag-space distance below which two agents count as the same group. */
  sigThreshold: 0.22,

  // --- reproduction ---
  /** fraction of REPRO threshold energy the parent invests in a litter. */
  reproInvestFrac: 0.7,
  /** offspring spawn jitter around the parent (px). */
  birthJitter: 14,

  // --- mutation (docs/genome.md §Mutation model) ---
  /** base per-gene mutation scale (× gene range span), modulated by MUTABILITY. This is the
   * between↔within-society dial (SPIKE study, docs/BUGS.md): lower = tighter/more monoethnic
   * tribes but fewer species; higher = more species but looser. 0.07 (down from 0.08) with
   * founderTribes 16 is the balanced "both" setting. */
  baseMutationScale: 0.07,
  /** floor so MUTABILITY can drift but never lock evolution to zero. */
  mutabilityFloor: 0.05,
}; // mutable: the dev panel tunes these live
