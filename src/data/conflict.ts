// Conflict tunables (Tier B). When a signature-dissimilar pair contests the same
// patch and at least one is aggressive, they fight: strength scaled by SIZE ×
// AGGRESSION with a seeded roll; the loser takes damage. This is what gives borders
// hard edges (docs/simulation-systems.md §Conflict).

export const CONFLICT = {
  /** agents within this distance (px) can contest. */
  range: 45,
  /** at least one combatant must have AGGRESSION above this to start a fight. */
  aggressionThreshold: 0.45,
  /** only fight near food: cell resource must exceed this for a patch to be worth it. */
  contestResourceMin: 2,
  /** energy the loser loses, scaled by the winner's SIZE. */
  loserDamage: 10,
  /** fraction of the loser's lost energy the winner robs — the spoils that give
   * SIZE+AGGRESSION a real payoff (a viable predator strategy). <1 so fights are
   * lossy and carrying capacity stays food-bound. */
  stealFrac: 0.8,
  /** ticks between an agent's eligible fights (keeps a frontier a grind, not a vaporize). */
  cooldownTicks: 18,
} as const;
