// Stigmergy field tunables (data-driven; read live by the Tier-B stigmergy pass).
//
// Stigmergy = agents writing the environment. Each channel is a grid-resolution
// field (same 80×45 grid as resources) that every tick: agents DEPOSIT into their
// cell, the field DIFFUSES (blends with 4-neighbors) and DECAYS (fades). The field
// evolves on the CPU exactly like the resource field — see src/sim/tierB/stigmergy.ts.
//
// First channel: `claim` (territory). Species-tagged by continuous signature
// accumulation — each cell holds a presence magnitude plus the presence-weighted
// signature vector, so mean signature = sigSum/mag maps to the depositing tribe's
// own hue. Render-only for now (nothing steers on it yet); claim never touches the
// GPU. `danger` and `trail` channels land later.

export const STIGMERGY = {
  // claim (territory) — slow decay so territory persists; modest diffusion so a
  // cluster claims a region, not just the cells it stands in.
  claimDeposit: 0.05, // per-agent per-tick magnitude added to its cell
  claimDiffuse: 0.1, // 4-neighbor blend fraction [0,1]
  claimDecay: 0.985, // per-tick multiplier (<1 → fades; persists ~46-tick half-life)
  claimRenderAlpha: 0.45, // overlay alpha at full magnitude
  claimRenderMagFull: 2.0, // magnitude that maps to full overlay alpha

  // danger — deposited on COMBAT damage (conflict.ts), scaled by the blow; natural
  // deaths leave none. Persists + spreads so a coherent gradient reaches well beyond
  // the frontier. Read by steer as a DESCEND gradient (flee).
  dangerPerDamage: 1.2, // danger stamped per unit of combat damage dealt
  dangerDiffuse: 0.12, // 4-neighbor blend fraction [0,1] (keep frontier zones tight + steep)
  dangerDecay: 0.99, // per-tick multiplier (~69-tick half-life; zones linger)
  // Steer reads danger MAGNITUDE-SENSITIVELY (not unit-normalized like other terms):
  // pull = min(|gradient| * gain, maxPull), so agents at a frontier flee hard and
  // those far from any fighting ignore the faint tails. maxPull > 1 lets danger
  // dominate the blend where the killing happens.
  dangerGain: 1.0, // gradient magnitude → pull slope
  dangerMaxPull: 2.5, // pull ceiling (vs other terms' unit magnitude)
  dangerRenderAlpha: 0.5, // overlay alpha at full magnitude
  dangerRenderMagFull: 14.0, // magnitude that maps to full overlay alpha
};
