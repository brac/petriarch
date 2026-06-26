// The fixed sim timestep. Its own module so simulation systems depend on the tick
// constant, not on the Loop (which owns wall-clock/RAF). 60Hz: THINK_INTERVAL=8 →
// agents think ~7.5Hz, legible for tuning (CLAUDE.md rule 6).

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
