// Dev panel: live sliders for the high-value tunables (docs/TUNING.md §A), so you
// tune by dragging in the headful view instead of editing data files and
// refreshing. Each slider reads/writes a data-module field directly; the sim reads
// those fields every tick, so changes take effect immediately.
//
// Only LIVE-effective tunables are exposed here (params read each tick). Init-only
// params (resource cellCapacity/clumping, MAX_AGENTS) and seed-restart belong with
// snapshot/restore, since they need a world rebuild.

import type { World } from "../state/world";
import { serializeWorld, restoreWorld } from "../tools/snapshot";
import { SIM } from "../data/sim";
import { COSTS } from "../data/costs";
import { CONFLICT } from "../data/conflict";
import { RESOURCES } from "../data/resources";
import { GpuContext } from "../gpu/gpuContext";
import { verifyHash } from "../gpu/verify";
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
  { group: "Food", label: "regrowth", min: 0, max: 0.15, step: 0.001, get: () => RESOURCES.regrowthRate, set: (v) => { RESOURCES.regrowthRate = v; } },

  { group: "Metabolism", label: "baseDrain", min: 0, max: 0.2, step: 0.005, get: () => COSTS.baseDrain, set: (v) => { COSTS.baseDrain = v; } },
  { group: "Metabolism", label: "intakeRate", min: 0.2, max: 3, step: 0.05, get: () => COSTS.intakeRate, set: (v) => { COSTS.intakeRate = v; } },

  { group: "Movement", label: "maxSpeed", min: 20, max: 200, step: 1, get: () => SIM.baseMaxSpeed, set: (v) => { SIM.baseMaxSpeed = v; } },
  { group: "Movement", label: "sizeSpeedPen", min: 0, max: 0.8, step: 0.01, get: () => SIM.sizeSpeedFactor, set: (v) => { SIM.sizeSpeedFactor = v; } },

  { group: "Evolution", label: "mutationScale", min: 0, max: 0.3, step: 0.002, get: () => SIM.baseMutationScale, set: (v) => { SIM.baseMutationScale = v; } },
  { group: "Evolution", label: "reproInvest", min: 0.2, max: 0.95, step: 0.01, get: () => SIM.reproInvestFrac, set: (v) => { SIM.reproInvestFrac = v; } },

  { group: "Conflict", label: "loserDamage", min: 0, max: 30, step: 0.5, get: () => CONFLICT.loserDamage, set: (v) => { CONFLICT.loserDamage = v; } },
  { group: "Conflict", label: "stealFrac", min: 0, max: 1, step: 0.02, get: () => CONFLICT.stealFrac, set: (v) => { CONFLICT.stealFrac = v; } },
  { group: "Conflict", label: "aggressThresh", min: 0, max: 1, step: 0.02, get: () => CONFLICT.aggressionThreshold, set: (v) => { CONFLICT.aggressionThreshold = v; } },
];

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
}

export class DevPanel {
  constructor(host: HTMLElement, world: World) {
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

    const verify = document.createElement("button");
    verify.className = "dp-reset";
    verify.textContent = "verify GPU hash";
    verify.addEventListener("click", () => {
      verify.disabled = true;
      gpuStatus.textContent = "running…";
      void (async () => {
        try {
          if (!gpu && !gpuTried) {
            gpuTried = true;
            gpu = await GpuContext.create(HASH_CELL_SIZE, WORLD_W, WORLD_H, MAX_AGENTS);
          }
          if (!gpu) {
            gpuStatus.textContent = "WebGPU unavailable";
            return;
          }
          const r = await verifyHash(world, gpu);
          gpuStatus.textContent =
            `${r.ok ? "✓ MATCH" : "✗ MISMATCH"}  n=${r.count} gpuTotal=${r.gpuTotal} cells=${r.numCells}\n` +
            `cell diffs: ${r.cellMismatches} (non-adjacent: ${r.nonAdjacentMismatches})  cellStart diffs: ${r.cellStartMismatches}` +
            (r.notes.length ? "\n" + r.notes.join("\n") : "");
        } catch (err) {
          gpuStatus.textContent = "error: " + (err instanceof Error ? err.message : String(err));
        } finally {
          verify.disabled = false;
        }
      })();
    });
    body.appendChild(verify);
    body.appendChild(gpuStatus);
  }
}
