// Dev panel: live sliders for the high-value tunables (docs/TUNING.md §A), so you
// tune by dragging in the headful view instead of editing data files and
// refreshing. Each slider reads/writes a data-module field directly; the sim reads
// those fields every tick, so changes take effect immediately.
//
// Only LIVE-effective tunables are exposed here (params read each tick). Init-only
// params (resource cellCapacity/clumping, MAX_AGENTS) and seed-restart belong with
// snapshot/restore, since they need a world rebuild.

import type { World } from "../state/world";
import type { Hud } from "./hud";
import { serializeWorld, restoreWorld } from "../tools/snapshot";
import { clearBarriers } from "../sim/tierB/god";
import { SIM } from "../data/sim";
import { COSTS } from "../data/costs";
import { CONFLICT } from "../data/conflict";
import { RESOURCES } from "../data/resources";
import { STIGMERGY } from "../data/stigmergy";
import { TRAIL } from "../data/trail";
import { BRIDGE } from "../data/bridge";
import { COG, COGNITION, COG_PRESETS } from "../data/cognition";
import { GpuContext } from "../gpu/gpuContext";
import { verifyHash, verifySense, verifySteer, verifyIntegrate, verifyMetabolism, verifyChain } from "../gpu/verify";
import { HASH_CELL_SIZE, WORLD_W, WORLD_H, MAX_AGENTS } from "../data/capacity";

interface Tunable {
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number): void;
}

const TUNABLES: Tunable[] = [
  { group: "Food", label: "regrowth", min: 0, max: 0.6, step: 0.002, get: () => RESOURCES.regrowthRate, set: (v) => { RESOURCES.regrowthRate = v; } },

  { group: "Metabolism", label: "baseDrain", min: 0, max: 0.2, step: 0.005, get: () => COSTS.baseDrain, set: (v) => { COSTS.baseDrain = v; } },
  { group: "Metabolism", label: "intakeRate", min: 0.2, max: 3, step: 0.05, get: () => COSTS.intakeRate, set: (v) => { COSTS.intakeRate = v; } },

  { group: "Movement", label: "maxSpeed", min: 20, max: 200, step: 1, get: () => SIM.baseMaxSpeed, set: (v) => { SIM.baseMaxSpeed = v; } },
  { group: "Movement", label: "sizeSpeedPen", min: 0, max: 0.8, step: 0.01, get: () => SIM.sizeSpeedFactor, set: (v) => { SIM.sizeSpeedFactor = v; } },

  { group: "Evolution", label: "mutationScale", min: 0, max: 0.3, step: 0.002, get: () => SIM.baseMutationScale, set: (v) => { SIM.baseMutationScale = v; } },
  { group: "Evolution", label: "reproInvest", min: 0.2, max: 0.95, step: 0.01, get: () => SIM.reproInvestFrac, set: (v) => { SIM.reproInvestFrac = v; } },

  { group: "Conflict", label: "loserDamage", min: 0, max: 30, step: 0.5, get: () => CONFLICT.loserDamage, set: (v) => { CONFLICT.loserDamage = v; } },
  { group: "Conflict", label: "stealFrac", min: 0, max: 1, step: 0.02, get: () => CONFLICT.stealFrac, set: (v) => { CONFLICT.stealFrac = v; } },
  { group: "Conflict", label: "aggressThresh", min: 0, max: 1, step: 0.02, get: () => CONFLICT.aggressionThreshold, set: (v) => { CONFLICT.aggressionThreshold = v; } },

  // Territory (claim) field. Lower decay / diffuse → crisper, more localized basins.
  { group: "Territory", label: "deposit", min: 0, max: 0.3, step: 0.005, get: () => STIGMERGY.claimDeposit, set: (v) => { STIGMERGY.claimDeposit = v; } },
  { group: "Territory", label: "diffuse", min: 0, max: 0.4, step: 0.01, get: () => STIGMERGY.claimDiffuse, set: (v) => { STIGMERGY.claimDiffuse = v; } },
  { group: "Territory", label: "decay", min: 0.9, max: 1, step: 0.001, get: () => STIGMERGY.claimDecay, set: (v) => { STIGMERGY.claimDecay = v; } },
  { group: "Territory", label: "renderAlpha", min: 0, max: 1, step: 0.02, get: () => STIGMERGY.claimRenderAlpha, set: (v) => { STIGMERGY.claimRenderAlpha = v; } },
  { group: "Territory", label: "renderMagFull", min: 0.5, max: 12, step: 0.5, get: () => STIGMERGY.claimRenderMagFull, set: (v) => { STIGMERGY.claimRenderMagFull = v; } },

  // Danger (death-zone) field. Deposited on death; steer descends it (flee), gated by THREAT_AVOID.
  { group: "Danger", label: "perDamage", min: 0, max: 3, step: 0.05, get: () => STIGMERGY.dangerPerDamage, set: (v) => { STIGMERGY.dangerPerDamage = v; } },
  { group: "Danger", label: "diffuse", min: 0, max: 0.4, step: 0.01, get: () => STIGMERGY.dangerDiffuse, set: (v) => { STIGMERGY.dangerDiffuse = v; } },
  { group: "Danger", label: "decay", min: 0.85, max: 1, step: 0.001, get: () => STIGMERGY.dangerDecay, set: (v) => { STIGMERGY.dangerDecay = v; } },
  { group: "Danger", label: "fleeGain", min: 0, max: 3, step: 0.05, get: () => STIGMERGY.dangerGain, set: (v) => { STIGMERGY.dangerGain = v; } },
  { group: "Danger", label: "fleeMaxPull", min: 0, max: 6, step: 0.1, get: () => STIGMERGY.dangerMaxPull, set: (v) => { STIGMERGY.dangerMaxPull = v; } },
  { group: "Danger", label: "renderAlpha", min: 0, max: 1, step: 0.02, get: () => STIGMERGY.dangerRenderAlpha, set: (v) => { STIGMERGY.dangerRenderAlpha = v; } },
  { group: "Danger", label: "renderMagFull", min: 0.5, max: 20, step: 0.5, get: () => STIGMERGY.dangerRenderMagFull, set: (v) => { STIGMERGY.dangerRenderMagFull = v; } },

  // Caravan-trail (route) field — committed carriers light up the dead-zone crossing (P4d). Higher
  // renderMagFull → only the hottest lanes glow; lower decay → routes persist longer between carriers.
  { group: "Trail", label: "deposit", min: 0, max: 0.3, step: 0.005, get: () => TRAIL.deposit, set: (v) => { TRAIL.deposit = v; } },
  { group: "Trail", label: "diffuse", min: 0, max: 0.4, step: 0.01, get: () => TRAIL.diffuse, set: (v) => { TRAIL.diffuse = v; } },
  { group: "Trail", label: "decay", min: 0.9, max: 1, step: 0.001, get: () => TRAIL.decay, set: (v) => { TRAIL.decay = v; } },
  { group: "Trail", label: "renderAlpha", min: 0, max: 1, step: 0.02, get: () => TRAIL.renderAlpha, set: (v) => { TRAIL.renderAlpha = v; } },
  { group: "Trail", label: "renderMagFull", min: 0.5, max: 12, step: 0.5, get: () => TRAIL.renderMagFull, set: (v) => { TRAIL.renderMagFull = v; } },

  // Bridge / road — hot trail HARDENS into a fast passability lane (survivable crossing). Lower
  // setThreshold → roads form sooner / wider; lower roadCost → faster road (1/cost speed-up).
  { group: "Bridge", label: "setThreshold", min: 0.5, max: 12, step: 0.5, get: () => BRIDGE.setThreshold, set: (v) => { BRIDGE.setThreshold = v; } },
  { group: "Bridge", label: "roadCost", min: 0.1, max: 1, step: 0.05, get: () => BRIDGE.roadCost, set: (v) => { BRIDGE.roadCost = v; } },
  { group: "Bridge", label: "roadSpacing", min: 0, max: 12, step: 1, get: () => BRIDGE.roadSpacing, set: (v) => { BRIDGE.roadSpacing = v; } },
  { group: "Bridge", label: "roadWidth", min: 1, max: 5, step: 1, get: () => BRIDGE.roadWidth, set: (v) => { BRIDGE.roadWidth = v; } },
  { group: "Bridge", label: "roadPull", min: 0, max: 2, step: 0.1, get: () => BRIDGE.attractPull, set: (v) => { BRIDGE.attractPull = v; } },
  { group: "Bridge", label: "renderAlpha", min: 0, max: 1, step: 0.02, get: () => BRIDGE.renderAlpha, set: (v) => { BRIDGE.renderAlpha = v; } },
];

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
}

export class DevPanel {
  constructor(host: HTMLElement, world: World, hud?: Hud) {
    const defaults = TUNABLES.map((t) => t.get());

    const header = document.createElement("div");
    header.className = "dp-header";
    header.textContent = "⚙ DEV ▾";
    const body = document.createElement("div");
    body.className = "dp-body";
    header.addEventListener("click", () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      header.textContent = hidden ? "⚙ DEV ▾" : "⚙ DEV ▸";
    });
    host.appendChild(header);
    host.appendChild(body);

    const rows: { t: Tunable; input: HTMLInputElement; val: HTMLElement }[] = [];
    let lastGroup = "";
    for (const t of TUNABLES) {
      if (t.group !== lastGroup) {
        const g = document.createElement("div");
        g.className = "dp-group";
        g.textContent = t.group;
        body.appendChild(g);
        lastGroup = t.group;
      }
      const row = document.createElement("label");
      row.className = "dp-row";
      const name = document.createElement("span");
      name.className = "dp-name";
      name.textContent = t.label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(t.min);
      input.max = String(t.max);
      input.step = String(t.step);
      input.value = String(t.get());
      const val = document.createElement("span");
      val.className = "dp-val";
      val.textContent = fmt(t.get());
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        t.set(v);
        val.textContent = fmt(v);
      });
      row.appendChild(name);
      row.appendChild(input);
      row.appendChild(val);
      body.appendChild(row);
      rows.push({ t, input, val });
    }

    const reset = document.createElement("button");
    reset.className = "dp-reset";
    reset.textContent = "reset defaults";
    reset.addEventListener("click", () => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const d = defaults[i]!;
        r.t.set(d);
        r.input.value = String(d);
        r.val.textContent = fmt(d);
      }
    });
    body.appendChild(reset);

    // --- cognition (Ant rung): the per-term toggle bank + presets. The `level`
    // ceiling lives on the first-class HUD slider; here we gate which terms are in
    // the steering sum and offer Worm/Ant/Full presets. ---
    const cogGroup = document.createElement("div");
    cogGroup.className = "dp-group";
    cogGroup.textContent = "Cognition";
    body.appendChild(cogGroup);

    const cogBits: { label: string; bit: number; box: HTMLInputElement }[] = [];
    const cogTerms: { label: string; bit: number }[] = [
      { label: "food", bit: COG.FOOD },
      { label: "kin", bit: COG.KIN },
      { label: "sep", bit: COG.SEP },
      { label: "avoid", bit: COG.AVOID },
      { label: "danger", bit: COG.DANGER },
      { label: "wander", bit: COG.WANDER },
    ];
    for (const term of cogTerms) {
      const row = document.createElement("label");
      row.className = "dp-row";
      const name = document.createElement("span");
      name.className = "dp-name";
      name.textContent = term.label;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = (COGNITION.mask & term.bit) !== 0;
      box.addEventListener("input", () => {
        if (box.checked) COGNITION.mask |= term.bit;
        else COGNITION.mask &= ~term.bit;
      });
      row.appendChild(name);
      row.appendChild(box);
      body.appendChild(row);
      cogBits.push({ label: term.label, bit: term.bit, box });
    }

    // Reflect a preset's mask into the checkboxes + its level into the HUD slider.
    const applyCogPreset = (p: { level: number; mask: number }): void => {
      COGNITION.mask = p.mask;
      for (const b of cogBits) b.box.checked = (p.mask & b.bit) !== 0;
      if (hud) hud.setCognitionLevel(p.level);
      else COGNITION.level = p.level;
    };

    const presetRow = document.createElement("div");
    presetRow.className = "dp-row";
    for (const [name, preset] of Object.entries(COG_PRESETS)) {
      const btn = document.createElement("button");
      btn.className = "dp-reset";
      btn.textContent = name;
      btn.addEventListener("click", () => applyCogPreset(preset));
      presetRow.appendChild(btn);
    }
    body.appendChild(presetRow);

    // --- terrain (passability) ---
    const terrGroup = document.createElement("div");
    terrGroup.className = "dp-group";
    terrGroup.textContent = "Terrain";
    body.appendChild(terrGroup);

    const terrHint = document.createElement("div");
    terrHint.className = "dp-val";
    terrHint.style.whiteSpace = "pre-wrap";
    terrHint.textContent = "press B → ocean-paint\nleft-drag paints · shift-drag erases";
    body.appendChild(terrHint);

    const clearTerr = document.createElement("button");
    clearTerr.className = "dp-reset";
    clearTerr.textContent = "clear barriers";
    clearTerr.addEventListener("click", () => clearBarriers(world));
    body.appendChild(clearTerr);

    // --- snapshot / restore ---
    const snapGroup = document.createElement("div");
    snapGroup.className = "dp-group";
    snapGroup.textContent = "Snapshot";
    body.appendChild(snapGroup);

    const save = document.createElement("button");
    save.className = "dp-reset";
    save.textContent = "save snapshot";
    save.addEventListener("click", () => {
      const blob = new Blob([serializeWorld(world)], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `petriarch-t${world.tick}.petri`;
      link.click();
      URL.revokeObjectURL(url);
    });
    body.appendChild(save);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".petri";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      void f.arrayBuffer().then((buf) => {
        try {
          restoreWorld(world, buf);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("snapshot load failed:", err);
        }
        fileInput.value = "";
      });
    });
    const load = document.createElement("button");
    load.className = "dp-reset";
    load.textContent = "load snapshot";
    load.addEventListener("click", () => fileInput.click());
    body.appendChild(load);
    body.appendChild(fileInput);

    // --- GPU (WebGPU migration bring-up) ---
    const gpuGroup = document.createElement("div");
    gpuGroup.className = "dp-group";
    gpuGroup.textContent = "GPU";
    body.appendChild(gpuGroup);

    const gpuStatus = document.createElement("div");
    gpuStatus.className = "dp-val";
    gpuStatus.style.whiteSpace = "pre-wrap";
    gpuStatus.textContent = "(not initialized)";

    let gpu: GpuContext | null = null;
    let gpuTried = false;

    // Lazily acquire the device once, run `job` against it, render its text status.
    const runGpu = (btn: HTMLButtonElement, job: (g: GpuContext) => Promise<string>): void => {
      btn.disabled = true;
      gpuStatus.textContent = "running…";
      void (async () => {
        try {
          if (!gpu && !gpuTried) {
            gpuTried = true;
            gpu = await GpuContext.create(HASH_CELL_SIZE, WORLD_W, WORLD_H, MAX_AGENTS);
          }
          gpuStatus.textContent = gpu ? await job(gpu) : "WebGPU unavailable";
        } catch (err) {
          gpuStatus.textContent = "error: " + (err instanceof Error ? err.message : String(err));
        } finally {
          btn.disabled = false;
        }
      })();
    };

    const verifyH = document.createElement("button");
    verifyH.className = "dp-reset";
    verifyH.textContent = "verify GPU hash";
    verifyH.addEventListener("click", () =>
      runGpu(verifyH, async (g) => {
        const r = await verifyHash(world, g);
        return (
          `${r.ok ? "✓ MATCH" : "✗ MISMATCH"}  n=${r.count} gpuTotal=${r.gpuTotal} cells=${r.numCells}\n` +
          `cell diffs: ${r.cellMismatches} (non-adjacent: ${r.nonAdjacentMismatches})` +
          (r.notes.length ? "\n" + r.notes.join("\n") : "")
        );
      }),
    );
    body.appendChild(verifyH);

    const verifyS = document.createElement("button");
    verifyS.className = "dp-reset";
    verifyS.textContent = "verify GPU sense (max intensity)";
    verifyS.addEventListener("click", () =>
      runGpu(verifyS, async (g) => {
        const r = await verifySense(world, g);
        return (
          `${r.ok ? "✓ MATCH" : "✗ MISMATCH"}  n=${r.count} compared=${r.compared} capped=${r.capped}\n` +
          `count diffs: ${r.countMismatches}  agg diffs: ${r.aggMismatches}  worstRel: ${r.worstRel.toExponential(2)}` +
          (r.notes.length ? "\n" + r.notes.join("\n") : "")
        );
      }),
    );
    body.appendChild(verifyS);

    const verifyT = document.createElement("button");
    verifyT.className = "dp-reset";
    verifyT.textContent = "verify GPU steer (max intensity)";
    verifyT.addEventListener("click", () =>
      runGpu(verifyT, async (g) => {
        const r = await verifySteer(world, g);
        return (
          `${r.ok ? "✓ MATCH" : "✗ MISMATCH"}  n=${r.count} compared=${r.compared} capped=${r.capped}\n` +
          `steer diffs: ${r.mismatches}  worstAbs: ${r.worstAbs.toExponential(2)}` +
          (r.notes.length ? "\n" + r.notes.join("\n") : "")
        );
      }),
    );
    body.appendChild(verifyT);

    const verifyI = document.createElement("button");
    verifyI.className = "dp-reset";
    verifyI.textContent = "verify GPU integrate";
    verifyI.addEventListener("click", () =>
      runGpu(verifyI, async (g) => {
        const r = await verifyIntegrate(world, g);
        return (
          `${r.ok ? "✓ MATCH" : "✗ MISMATCH"}  n=${r.count}\n` +
          `integrate diffs: ${r.mismatches}  worstAbs: ${r.worstAbs.toExponential(2)}` +
          (r.notes.length ? "\n" + r.notes.join("\n") : "")
        );
      }),
    );
    body.appendChild(verifyI);

    const verifyM = document.createElement("button");
    verifyM.className = "dp-reset";
    verifyM.textContent = "verify GPU metabolism";
    verifyM.addEventListener("click", () =>
      runGpu(verifyM, async (g) => {
        const r = await verifyMetabolism(world, g);
        return (
          `${r.ok ? "✓ MATCH" : "✗ MISMATCH"}  n=${r.count}\n` +
          `age diffs: ${r.ageMismatches}  energy diffs (single-cell): ${r.energyMismatchesUncontended}\n` +
          `contended energy diffs: ${r.energyMismatchesContended} (allowed)  worstE(single): ${r.worstUncontendedEnergy.toExponential(2)}` +
          (r.notes.length ? "\n" + r.notes.join("\n") : "")
        );
      }),
    );
    body.appendChild(verifyM);

    const verifyC = document.createElement("button");
    verifyC.className = "dp-reset";
    verifyC.textContent = "verify GPU chain (resident, max intensity)";
    verifyC.addEventListener("click", () =>
      runGpu(verifyC, async (g) => {
        const r = await verifyChain(world, g);
        return (
          `${r.ok ? "✓ MATCH" : "✗ MISMATCH"}  n=${r.count} capped=${r.capped}\n` +
          `posVel diffs: ${r.posVelMismatches} (worst ${r.worstPosVel.toExponential(2)})  age diffs: ${r.ageMismatches}\n` +
          `energy diffs (single-cell): ${r.energyMismatches}  contended: ${r.energyContended} (allowed)` +
          (r.notes.length ? "\n" + r.notes.join("\n") : "")
        );
      }),
    );
    body.appendChild(verifyC);
    body.appendChild(gpuStatus);
  }
}
