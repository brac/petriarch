// Caravan-trail stigmergy field tunables (Tier B; data-driven, read live). The HEADFUL PAYOFF of the
// trade arc (docs/P4C_PLAN.md §P4d): render the route. Committed CARRIERS (carryState ≠ 0 — OUTBOUND or
// RETURN, the agents physically hauling a good across the barren gap) deposit into this grid field as
// they move; it diffuses + decays like the other stigmergy channels. Because carriers funnel along the
// scent gradient through the narrow gap, their deposits CONCENTRATE into lanes — a well-travelled
// corridor builds a bright standing line, a one-off path fades — so the trade ROUTE emerges and glows.
//
// Render-only: nothing in the sim reads `trail` (like `claim`), it never touches the GPU, it's pure
// Tier B + a renderer heatmap. Gold to match the commerce language (amity haze + trade-pulses are
// gold) — the whole commerce network lights up gold: gold districts linked by gold caravan lines.

export const TRAIL = {
  /** per-CARRIER per-tick magnitude added to its cell (only carryState ≠ 0 deposit). A bit above
   *  claimDeposit since far fewer agents write this channel (only the committed carriers). */
  deposit: 0.08,
  /** 4-neighbor blend fraction [0,1] — LOW so a lane stays a crisp line, not a smeared blob. */
  diffuse: 0.04,
  /** per-tick multiplier (<1 → fades). Slowish (~86-tick half-life) so a route stays lit BETWEEN the
   *  carriers passing through it (traffic per cell is intermittent) and reads as a continuous line —
   *  but still <1, so a route that stops being travelled cools and disappears. */
  decay: 0.992,
  /** render: cell-overlay alpha at full magnitude. Brighter than amity (0.5) so the lit lanes pop. */
  renderAlpha: 0.6,
  /** render: trail magnitude that maps to full overlay alpha. Calibrated to the field MASS via a
   *  headless probe of a well-developed run (tools/trailprobe.ts) — set so a travelled lane saturates
   *  while faint one-off paths stay dim. */
  renderMagFull: 3.0,
}; // mutable: the dev panel / study harness tunes these live
