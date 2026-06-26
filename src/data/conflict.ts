// Conflict tunables (signature-distance threshold, contest damage). STUB —
// populated in Milestone 1 when conflict.ts (Tier B) is written. Conflict ships in
// Milestone 1: without it, borders are mush (docs/simulation-systems.md §Conflict).

export const CONFLICT = {
  /** Tag-space distance below which two agents count as "same group". */
  signatureThreshold: 0,
  /** AGGRESSION above which an agent will contest rather than cede. */
  aggressionThreshold: 0,
  /** Damage dealt to the loser, scaled by SIZE. */
  contestDamage: 0,
} as const;
