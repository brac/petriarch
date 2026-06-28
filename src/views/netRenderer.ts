// The cyber-net skin (a dumb view). Reads World and draws it; holds no gameplay
// logic and never mutates the sim — it can be destroyed and rebuilt from state on
// any frame. Owns the Pixi Application and the letterbox transform: the world is
// authored at a fixed WORLD_W × WORLD_H and scaled-to-fit, so gameplay math never
// depends on window size — only this final transform does.
//
// Layers (bottom→top): dark field → resource glow (one ParticleContainer of cell
// quads) → kin-cohesion edges (a lit mesh) → agent nodes (one batched
// ParticleContainer) → conflict sparks (pooled) → border. Node hue = signature,
// size = SIZE gene, brightness/alpha = energy; morphology rides saturation (RESILIENCE)
// and lightness (EFFICIENCY) — see nodeTint. Edges/sparks are gated/capped so the skin
// stays under render budget (docs/simulation-systems.md §Rendering).

import { Application, Container, Graphics, Particle, ParticleContainer } from "pixi.js";
import type { Texture } from "pixi.js";
import type { World } from "../state/world";
import {
  WORLD_W,
  WORLD_H,
  MAX_AGENTS,
  MAX_SPARKS,
  RESOURCE_GRID_W,
  RESOURCE_GRID_H,
  RES_CELL_W,
  RES_CELL_H,
} from "../data/capacity";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { RESOURCES } from "../data/resources";
import { STIGMERGY } from "../data/stigmergy";
import { PASSABILITY } from "../data/passability";

const OFFSCREEN = -10000;
const NODE_TEX_RADIUS = 16; // node texture radius (px); per-agent scale multiplies it
const NODE_SCALE = 0.5; // SIZE gene → sprite scale
const RES_MAX_ALPHA = 0.5; // a full resource cell's glow alpha
const RES_TINT = 0x2ec86a; // nutrient A — food green
const RES_B_TINT = 0xc8329b; // nutrient B — magenta (the second region's good)
const CLAIM_SAT = 0.7; // territory hue saturation (claim encodes lineage, not morphology)
const CLAIM_LUM = 0.5; // territory hue lightness
const CLAIM_EPS = 1e-3; // below this magnitude a cell is unclaimed (alpha 0)
const DANGER_TINT = 0xff3b30; // death-zone red
const SPARK_TINT = 0xffffff; // conflict flash — white-hot ring, not an organism hue
const SPARK_DECAY = 0.13; // alpha lost per render frame (~8-frame flash)
// Kin-edge cost guards.
const EDGE_TINT = 0x00ffcc;
const EDGE_ALPHA = 0.16;
const EDGE_MAX = 4000; // hard cap on edges drawn per frame
const EDGE_K = 3; // edges per agent

// Border display (a view toggle, press 'v' — no sim effect). Each frame we rasterize the
// RAW agent signatures into the food grid (the same 80×45 grid the resource field uses) —
// each cell's society = the mean signature of the agents standing in it — then draw the
// shared edge between any two adjacent cells whose societies differ by >= sigThreshold.
// Grid-aligned edges accumulate into ONE connected jagged arc along the frontier between
// two societies, instead of spikes radiating from individual agents. We use the raw agent
// signatures (not the diffused claim field) so the boundary stays crisp — diffusion would
// smear the signatures across the seam and the contour would dissolve. To "only show the
// borders" the mode also drops the kin mesh and ghosts the nodes. CPU-only; the renderer
// already reads agent positions each frame, so it works in CPU and GPU mode.
const BORDER_TINT = 0xffe600; // bright yellow — high contrast against every society hue
const BORDER_ALPHA = 0.85;
const BORDER_NODE_ALPHA = 0.16; // nodes ghosted in border mode so the contour reads clearly
const BORDER_CELL_MIN = 1; // min agents in a cell for it to have a society (else skip the cell)

export class NetRenderer {
  readonly app = new Application();
  private world = new Container(); // camera root (world space)
  private edgeLayer = new Graphics();
  private borderLayer = new Graphics();
  private borderMode = false;

  private nodeContainer!: ParticleContainer;
  private nodeParticles: Particle[] = [];
  private nodeHigh = 0;

  private resParticles: Particle[] = [];
  private resBParticles: Particle[] = [];
  private claimParticles: Particle[] = [];
  private dangerParticles: Particle[] = [];
  private passabilityParticles: Particle[] = [];

  private sparkContainer!: ParticleContainer;
  private sparkParticles: Particle[] = [];
  private sparkLife = new Float32Array(MAX_SPARKS);
  private sparkCursor = 0;

  // Reused scratch for edge neighbor queries (zero alloc per frame).
  private edgeNbr: number[] = [];

  // Border-contour scratch: per-food-cell agent-signature accumulation (zero alloc/frame).
  private bSigA = new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H);
  private bSigB = new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H);
  private bSigC = new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H);
  private bCnt = new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H);

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x05070a,
      antialias: true,
      resizeTo: parent,
      preference: "webgl",
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    parent.appendChild(this.app.canvas);

    const field = new Graphics().rect(0, 0, WORLD_W, WORLD_H).fill(0x0b0d12);
    const border = new Graphics()
      .rect(0, 0, WORLD_W, WORLD_H)
      .stroke({ width: 2, color: 0x00ffcc, alpha: 0.35 });

    // --- cell-grid layers: claim/territory (ground tint) + resource glow, both
    // one cell-sized quad per grid cell with dynamic color ---
    const cellTex = this.app.renderer.generateTexture(
      new Graphics().rect(0, 0, RES_CELL_W, RES_CELL_H).fill(0xffffff),
    );
    const passabilityLayer = this.buildCellLayer(cellTex, PASSABILITY.oceanTint);
    this.passabilityParticles = passabilityLayer.particles;
    const claimLayer = this.buildCellLayer(cellTex, 0xffffff);
    this.claimParticles = claimLayer.particles;
    const resLayer = this.buildCellLayer(cellTex, RES_TINT);
    this.resParticles = resLayer.particles;
    const resBLayer = this.buildCellLayer(cellTex, RES_B_TINT);
    this.resBParticles = resBLayer.particles;
    const dangerLayer = this.buildCellLayer(cellTex, DANGER_TINT);
    this.dangerParticles = dangerLayer.particles;

    // --- node texture + pool ---
    const nodeTex = this.app.renderer.generateTexture(
      new Graphics().circle(0, 0, NODE_TEX_RADIUS).fill(0xffffff),
    );
    const nodePool = this.buildPool(nodeTex, MAX_AGENTS, { position: true, color: true, vertex: true });
    this.nodeContainer = nodePool.container;
    this.nodeParticles = nodePool.particles;

    // --- spark pool --- a hollow ring so a contest reads as an expanding
    // shockwave (an *event*), unmistakable against the filled organism discs.
    const sparkTex = this.app.renderer.generateTexture(
      new Graphics().circle(0, 0, 13).stroke({ width: 3, color: 0xffffff }),
    );
    const sparkPool = this.buildPool(sparkTex, MAX_SPARKS, { position: true, color: true });
    this.sparkContainer = sparkPool.container;
    this.sparkParticles = sparkPool.particles;

    // Layer order. Ocean (passability) is the base terrain just above the dark field;
    // claim/territory sits over it as a ground tint, under the resource glow and agents.
    this.world.addChild(
      field,
      passabilityLayer.container,
      claimLayer.container,
      resLayer.container,
      resBLayer.container,
      dangerLayer.container,
      this.edgeLayer,
      this.nodeContainer,
      this.borderLayer,
      this.sparkContainer,
      border,
    );
    this.app.stage.addChild(this.world);

    this.app.ticker.stop(); // our fixed-timestep Loop owns timing
    this.layout();
    window.addEventListener("resize", this.layout);
  }

  /** Read state and draw one frame. No decisions here. */
  render(world: World, _alpha: number): void {
    this.drawPassability(world);
    this.drawClaim(world);
    this.drawResources(world);
    this.drawResourceB(world);
    this.drawDanger(world);
    this.drawNodes(world);
    this.drawEdges(world);
    this.drawBorders(world);
    this.drawSparks(world);
    this.app.renderer.render(this.app.stage);
  }

  /** View toggle: isolate the borders between societies. Returns the new state. */
  toggleBorders(): boolean {
    this.borderMode = !this.borderMode;
    return this.borderMode;
  }

  /** Convert a DOM/client point to world coordinates (for god-tool placement). */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const s = this.world.scale.x;
    return {
      x: (clientX - rect.left - this.world.x) / s,
      y: (clientY - rect.top - this.world.y) / s,
    };
  }

  // --- draw passes ---

  // Ocean / barriers: a flat blue tint on impassable cells (the painted passability
  // field). Static, but cheap to redraw each frame alongside the other cell layers.
  private drawPassability(world: World): void {
    const pass = world.passability;
    const parts = this.passabilityParticles;
    const block = PASSABILITY.blockThreshold;
    const a = PASSABILITY.oceanAlpha;
    for (let c = 0; c < parts.length; c++) {
      parts[c]!.alpha = pass[c]! >= block ? a : 0;
    }
  }

  // Territory turf: each cell's mean accumulated signature → that tribe's hue; alpha
  // from claim magnitude. Borders read as a blended hue where two tribes' claims mix.
  private drawClaim(world: World): void {
    const mag = world.claimMag;
    const sa = world.claimSigA;
    const sb = world.claimSigB;
    const sc = world.claimSigC;
    const parts = this.claimParticles;
    const invFull = 1 / STIGMERGY.claimRenderMagFull;
    for (let c = 0; c < parts.length; c++) {
      const m = mag[c]!;
      const p = parts[c]!;
      if (m <= CLAIM_EPS) {
        p.alpha = 0;
        continue;
      }
      const inv = 1 / m;
      p.tint = hslToRgb(sigHue(sa[c]! * inv, sb[c]! * inv, sc[c]! * inv), CLAIM_SAT, CLAIM_LUM);
      let a = m * invFull;
      if (a > 1) a = 1;
      p.alpha = a * STIGMERGY.claimRenderAlpha;
    }
  }

  private drawResources(world: World): void {
    const res = world.resources;
    const parts = this.resParticles;
    const inv = 1 / RESOURCES.cellCapacity;
    for (let c = 0; c < parts.length; c++) {
      let v = res[c]! * inv;
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
      parts[c]!.alpha = v * RES_MAX_ALPHA;
    }
  }

  // Nutrient B glow (magenta) — same scale as nutrient A; reveals the second region.
  private drawResourceB(world: World): void {
    const res = world.resourceB;
    const parts = this.resBParticles;
    const inv = 1 / RESOURCES.cellCapacity;
    for (let c = 0; c < parts.length; c++) {
      let v = res[c]! * inv;
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
      parts[c]!.alpha = v * RES_MAX_ALPHA;
    }
  }

  // Death-zone heatmap: red glow where danger has accumulated (deposited on death).
  private drawDanger(world: World): void {
    const dg = world.danger;
    const parts = this.dangerParticles;
    const inv = 1 / STIGMERGY.dangerRenderMagFull;
    for (let c = 0; c < parts.length; c++) {
      let v = dg[c]! * inv;
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
      parts[c]!.alpha = v * STIGMERGY.dangerRenderAlpha;
    }
  }

  private drawNodes(world: World): void {
    const a = world.agents;
    const { posX, posY, energy, energyB, genes, count } = a;
    const parts = this.nodeParticles;
    // In border mode the nodes are ghosted so the magenta seams dominate the frame.
    const aScale = this.borderMode ? BORDER_NODE_ALPHA : 1;
    for (let i = 0; i < count; i++) {
      const p = parts[i]!;
      p.x = posX[i]!;
      p.y = posY[i]!;
      const size = genes[i * GENE_COUNT + GENE.SIZE]!;
      const sc = size * NODE_SCALE;
      p.scaleX = sc;
      p.scaleY = sc;
      p.tint = nodeTint(genes, i);
      // Brightness from TOTAL nutrition (both stores, each caps at maxE → divide by 2·maxE).
      const maxE = size * SIM.maxEnergyPerSize;
      p.alpha = (0.3 + 0.7 * clamp01((energy[i]! + energyB[i]!) / (2 * maxE))) * aScale;
    }
    for (let i = count; i < this.nodeHigh; i++) {
      parts[i]!.x = OFFSCREEN;
      parts[i]!.y = OFFSCREEN;
    }
    this.nodeHigh = count;
  }

  // Kin mesh: faint lines to a few same-signature neighbors. Always drawn (render
  // is cheap), capped at EDGE_MAX with EDGE_K per agent — independent of the
  // intensity perf knob. Uses the sim's spatial hash (already built this tick).
  private drawEdges(world: World): void {
    const g = this.edgeLayer;
    g.clear();
    if (this.borderMode) return; // border view hides the kin mesh

    const a = world.agents;
    const { posX, posY, genes, count } = a;
    const hash = world.hash;
    const nbr = this.edgeNbr;
    const senseR2 = SIM.senseRadius * SIM.senseRadius;
    const sigT = SIM.sigThreshold;
    let edges = 0;

    for (let i = 0; i < count && edges < EDGE_MAX; i++) {
      const xi = posX[i]!;
      const yi = posY[i]!;
      const bi = i * GENE_COUNT;
      const sa = genes[bi + GENE.SIG_A]!;
      const sb = genes[bi + GENE.SIG_B]!;
      const sc = genes[bi + GENE.SIG_C]!;
      hash.queryNeighbors(xi, yi, nbr);
      const m = nbr.length;
      let drawn = 0;
      for (let k = 0; k < m && drawn < EDGE_K; k++) {
        const j = nbr[k]!;
        if (j <= i) continue; // each pair once
        const dx = posX[j]! - xi;
        const dy = posY[j]! - yi;
        if (dx * dx + dy * dy > senseR2) continue;
        const bj = j * GENE_COUNT;
        const dsa = genes[bj + GENE.SIG_A]! - sa;
        const dsb = genes[bj + GENE.SIG_B]! - sb;
        const dsc = genes[bj + GENE.SIG_C]! - sc;
        if (Math.sqrt(dsa * dsa + dsb * dsb + dsc * dsc) >= sigT) continue;
        g.moveTo(xi, yi).lineTo(posX[j]!, posY[j]!);
        drawn++;
        if (++edges >= EDGE_MAX) break;
      }
    }
    if (edges > 0) g.stroke({ width: 1, color: EDGE_TINT, alpha: EDGE_ALPHA });
  }

  // Border contour (only in border mode): rasterize agent signatures into the food grid,
  // then draw the shared edge between adjacent cells whose mean society signature differs
  // by >= sigThreshold. Grid-aligned segments accumulate into one jagged arc tracing the
  // frontier between two societies. O(agents + grid cells), zero alloc (reused scratch).
  private drawBorders(world: World): void {
    const g = this.borderLayer;
    g.clear();
    if (!this.borderMode) return;

    const a = world.agents;
    const { posX, posY, genes, count } = a;
    const gw = RESOURCE_GRID_W;
    const gh = RESOURCE_GRID_H;
    const sa = this.bSigA, sb = this.bSigB, sc = this.bSigC, cnt = this.bCnt;
    sa.fill(0);
    sb.fill(0);
    sc.fill(0);
    cnt.fill(0);

    // Rasterize: accumulate each agent's signature into its food-grid cell.
    for (let i = 0; i < count; i++) {
      let cx = (posX[i]! / RES_CELL_W) | 0;
      if (cx < 0) cx = 0;
      else if (cx >= gw) cx = gw - 1;
      let cy = (posY[i]! / RES_CELL_H) | 0;
      if (cy < 0) cy = 0;
      else if (cy >= gh) cy = gh - 1;
      const c = cy * gw + cx;
      const bi = i * GENE_COUNT;
      sa[c]! += genes[bi + GENE.SIG_A]!;
      sb[c]! += genes[bi + GENE.SIG_B]!;
      sc[c]! += genes[bi + GENE.SIG_C]!;
      cnt[c]!++;
    }

    const sigT2 = SIM.sigThreshold * SIM.sigThreshold;
    const minCnt = BORDER_CELL_MIN;
    let segs = 0;
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        const c = cy * gw + cx;
        const nc = cnt[c]!;
        if (nc < minCnt) continue; // empty cell → no society
        const inv = 1 / nc;
        const ax = sa[c]! * inv, ay = sb[c]! * inv, az = sc[c]! * inv;

        // right neighbor → shared vertical edge at the cells' boundary
        if (cx + 1 < gw) {
          const r = c + 1;
          const nr = cnt[r]!;
          if (nr >= minCnt) {
            const ir = 1 / nr;
            const da = sa[r]! * ir - ax, db = sb[r]! * ir - ay, dc = sc[r]! * ir - az;
            if (da * da + db * db + dc * dc >= sigT2) {
              const x = (cx + 1) * RES_CELL_W;
              g.moveTo(x, cy * RES_CELL_H).lineTo(x, (cy + 1) * RES_CELL_H);
              segs++;
            }
          }
        }
        // bottom neighbor → shared horizontal edge
        if (cy + 1 < gh) {
          const d = c + gw;
          const nd = cnt[d]!;
          if (nd >= minCnt) {
            const id = 1 / nd;
            const da = sa[d]! * id - ax, db = sb[d]! * id - ay, dc = sc[d]! * id - az;
            if (da * da + db * db + dc * dc >= sigT2) {
              const y = (cy + 1) * RES_CELL_H;
              g.moveTo(cx * RES_CELL_W, y).lineTo((cx + 1) * RES_CELL_W, y);
              segs++;
            }
          }
        }
      }
    }
    if (segs > 0) g.stroke({ width: 2, color: BORDER_TINT, alpha: BORDER_ALPHA });
  }

  private drawSparks(world: World): void {
    const sp = world.sparks;
    const parts = this.sparkParticles;
    const life = this.sparkLife;

    // Ingest new conflict events into the rolling pool.
    for (let s = 0; s < sp.count; s++) {
      const slot = this.sparkCursor;
      const p = parts[slot]!;
      p.x = sp.x[s]!;
      p.y = sp.y[s]!;
      p.tint = SPARK_TINT;
      life[slot] = 1;
      this.sparkCursor = (this.sparkCursor + 1) % parts.length;
    }
    sp.count = 0; // consumed

    // Decay all live sparks.
    for (let k = 0; k < parts.length; k++) {
      const l = life[k]!;
      if (l <= 0) continue;
      const nl = l - SPARK_DECAY;
      const p = parts[k]!;
      if (nl <= 0) {
        life[k] = 0;
        p.x = OFFSCREEN;
        p.y = OFFSCREEN;
        p.alpha = 0;
      } else {
        life[k] = nl;
        p.alpha = nl;
        const s = 0.3 + (1 - nl) * 2.7; // expand outward (shockwave) as it fades
        p.scaleX = s;
        p.scaleY = s;
      }
    }
  }

  // --- builders ---

  // One cell-sized quad per grid cell (color dynamic: per-frame tint + alpha). Shared
  // by the resource glow and the claim/territory overlay.
  private buildCellLayer(tex: Texture, tint: number): { container: ParticleContainer; particles: Particle[] } {
    const particles: Particle[] = [];
    for (let cy = 0; cy < RESOURCE_GRID_H; cy++) {
      for (let cx = 0; cx < RESOURCE_GRID_W; cx++) {
        particles.push(
          new Particle({
            texture: tex,
            tint,
            anchorX: 0,
            anchorY: 0,
            x: cx * RES_CELL_W,
            y: cy * RES_CELL_H,
            alpha: 0,
          }),
        );
      }
    }
    const container = new ParticleContainer({
      dynamicProperties: { position: false, color: true, vertex: false },
      texture: tex,
      particles,
    });
    container.blendMode = "add";
    container.update();
    return { container, particles };
  }

  private buildPool(
    tex: Texture,
    capacity: number,
    dynamic: { position?: boolean; color?: boolean; vertex?: boolean },
  ): { container: ParticleContainer; particles: Particle[] } {
    const particles: Particle[] = [];
    for (let i = 0; i < capacity; i++) {
      particles.push(
        new Particle({
          texture: tex,
          tint: 0x00ffcc,
          anchorX: 0.5,
          anchorY: 0.5,
          x: OFFSCREEN,
          y: OFFSCREEN,
        }),
      );
    }
    const container = new ParticleContainer({ dynamicProperties: dynamic, texture: tex, particles });
    container.blendMode = "add";
    container.update();
    return { container, particles };
  }

  private layout = (): void => {
    const { width: sw, height: sh } = this.app.renderer.screen;
    const scale = Math.min(sw / WORLD_W, sh / WORLD_H);
    this.world.scale.set(scale);
    this.world.position.set((sw - WORLD_W * scale) / 2, (sh - WORLD_H * scale) / 2);
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Signature → hue → packed RGB. SIG_A drives hue, SIG_B/C nudge it so all three tag
// dimensions show as colour drift (docs/genome.md). Morphology rides the two free
// perceptual channels so it reads WITHOUT disturbing hue=lineage: RESILIENCE
// desaturates (armor looks metallic/muted), EFFICIENCY lightens (efficient bodies look
// glossier/brighter). So a tank reads as a muted node, an efficient forager as a bright
// one — body type at a glance, on top of lineage hue, size (SIZE) and energy (alpha).
// Signature (sigA/B/C) → hue in [0,1). The one mapping shared by agent nodes and the
// claim/territory turf, so a tribe's turf glows in its own node colour.
function sigHue(sigA: number, sigB: number, sigC: number): number {
  const h = sigA + 0.15 * (sigB - sigC);
  return ((h % 1) + 1) % 1;
}

function nodeTint(genes: Float32Array, i: number): number {
  const bi = i * GENE_COUNT;
  const h = sigHue(genes[bi + GENE.SIG_A]!, genes[bi + GENE.SIG_B]!, genes[bi + GENE.SIG_C]!);
  const s = 0.85 - 0.55 * genes[bi + GENE.RESILIENCE]!; // armor → metallic/desaturated
  const l = 0.55 + 0.2 * genes[bi + GENE.EFFICIENCY]!; // efficient → glossier/brighter
  return hslToRgb(h, s, l);
}

function hslToRgb(h: number, s: number, l: number): number {
  if (s === 0) {
    const v = Math.round(l * 255);
    return (v << 16) | (v << 8) | v;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
