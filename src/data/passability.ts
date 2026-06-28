// Passability field tunables (data-driven). The passability field is ONE grid-
// resolution movement-cost texture (same 80×45 grid as resources): each cell holds a
// movement cost the integrator reads every tick. Default 1 (normal ground); a painted
// ocean/wall is a huge sentinel cost (impassable); roads/swamp (a later tier) are
// continuous costs < 1 (faster) or > 1 (slower). Cost-based, not binary, from the start
// — see docs/PETRIARCH_FEATURE_passability.md.
//
// Tier note: the field itself is static admin/construction data (Tier B writers — the
// paint tool, later the construction tier). The only HOT read is in integrate (Tier A,
// CPU + GPU), where it scales/blocks the step. claim/danger diffuse over it freely (no
// passability branch) — their range is governed by decay, not the barrier; only `trail`
// (not yet built) will respect MAX-cost as a diffusion barrier.

export const PASSABILITY = {
  /** Normal ground. Every cell starts here; integrate treats cost==1 as a no-op. */
  defaultCost: 1,
  /** What the admin paint tool writes for ocean / hard border (treated as impassable). */
  oceanCost: 1e9,
  /** Integrate blocks a step whose target cell cost is >= this (ocean/wall sentinel). */
  blockThreshold: 1e6,
  /** Paint brush radius (world units) for the admin ocean-paint tool. */
  brushRadius: 70,

  // --- render (netRenderer ocean overlay) ---
  oceanTint: 0x1d4ed8, // deep cyber-blue water
  oceanAlpha: 0.55, // overlay alpha for an impassable cell
};
