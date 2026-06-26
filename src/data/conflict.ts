// Conflict tunables (Tier B). When a signature-dissimilar pair contests the same
// patch and at least one is aggressive, they fight: strength scaled by SIZE ×
// AGGRESSION with a seeded roll; the loser takes damage. This is what gives borders
// hard edges (docs/simulation-systems.md §Conflict).

export const CONFLICT = {
  /** agents within this distance (px) can contest. */
  range: 30,
  /** at least one combatant must have AGGRESSION above this to start a fight. */
  aggressionThreshold: 0.45,
  /** only fight near food: cell resource must exceed this for a patch to be worth it. */
  contestResourceMin: 4,
  /** energy the loser loses, scaled by the winner's SIZE. */
  loserDamage: 6,
  /** ticks between an agent's eligible fights (keeps a frontier a grind, not a vaporize). */
  cooldownTicks: 18,
} as const;
