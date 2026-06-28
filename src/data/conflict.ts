// Conflict tunables (Tier B). When a signature-dissimilar pair contests the same
// patch and at least one is aggressive, they fight: strength scaled by SIZE ×
// AGGRESSION with a seeded roll; the loser takes damage. This is what gives borders
// hard edges (docs/simulation-systems.md §Conflict).

export const CONFLICT = {
  /** agents within this distance (px) can contest. */
  range: 45,
  /** at least one combatant must have AGGRESSION above this to start a fight. */
  aggressionThreshold: 0.45,
  /** Conflict trigger gate: a fighter's cell resource must exceed this. Set LOW (0.5, down
   * from 2) so big+aggressive bodies can hunt foragers across the inhabited map, not only at
   * rich patches — predation is about prey, not food. The predation study (docs/BUGS.md)
   * found this is THE lever that fixes "small sizes dominate": it grows a coherent predator
   * niche (~32%) that coexists with a forager majority (~56%) without starving the world.
   * Don't pair it with a higher loserDamage — that turns aggression universal instead of a
   * SIZE-leveraged predator trait. */
  contestResourceMin: 0.5,
  /** energy the loser loses, scaled by the winner's SIZE. */
  loserDamage: 10,
  /** fraction of the loser's lost energy the winner robs — the spoils that give
   * SIZE+AGGRESSION a real payoff (a viable predator strategy). <1 so fights are
   * lossy and carrying capacity stays food-bound. */
  stealFrac: 0.8,
  /** ticks between an agent's eligible fights (keeps a frontier a grind, not a vaporize). */
  cooldownTicks: 18,
}; // mutable: the dev panel tunes these live
