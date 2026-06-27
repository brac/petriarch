// The simulation's WebGPU compute context — owns the device, the storage buffers
// that mirror the SoA pools, and the full Tier A compute pipeline (hash counting-sort,
// sense, steer, integrate, metabolism). Built once at capacity (zero per-frame
// allocation, same discipline as the CPU pools).
//
// Two ways to drive it: the *Build/read* method pairs upload explicit inputs + read
// one pass back (used by the per-pass verifies), and the RESIDENT chain
// (uploadState → runTierA → downloadState) keeps agent state in GPU buffers across all
// passes with no readback between them — the loop's hot path.
//
// Grid config mirrors core/spatialHash.ts exactly (gridW = ceil(worldW/cellSize))
// so a GPU build is directly comparable to the CPU reference.

import { acquireGpuDevice, type GpuDevice } from "./device";
import { HASH_WGSL } from "./shaders/hash.wgsl";
import { SENSE_WGSL } from "./shaders/sense.wgsl";
import { STEER_WGSL } from "./shaders/steer.wgsl";
import { INTEGRATE_WGSL } from "./shaders/integrate.wgsl";
import { METABOLISM_WGSL } from "./shaders/metabolism.wgsl";
import { GENE_COUNT } from "../data/genome";
import { RESOURCE_GRID_W, RESOURCE_GRID_H, RES_CELL_W, RES_CELL_H, WORLD_W, WORLD_H } from "../data/capacity";
import { SIM } from "../data/sim";
import { COSTS } from "../data/costs";
import { MORPH } from "../data/morphology";
import { COGNITION } from "../data/cognition";
import { STIGMERGY } from "../data/stigmergy";
import { TICK_DT } from "../core/time";

/** Hazard zone params for the metabolism pass (from World.hazard). */
export interface HazardParams {
  active: boolean;
  x: number;
  y: number;
  r2: number;
}

const WG = 64; // workgroup size for the per-agent/per-cell kernels (must match WGSL)
/** Interleaved sense output stride: [kinX,kinY,kinCount,sepX,sepY,avoidX,avoidY]. */
export const SENSE_STRIDE = 7;
/** Steer output stride: [steerX, steerY]. */
export const STEER_STRIDE = 2;
const RES_CELLS = RESOURCE_GRID_W * RESOURCE_GRID_H;

/** Full agent state read back from the GPU after a resident Tier A run. */
export interface GpuState {
  posX: Float32Array;
  posY: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  energy: Float32Array;
  age: Float32Array;
}

export interface GpuGridResult {
  /** Exclusive prefix sums, length numCells+1 (a fresh copy off the GPU). */
  cellStart: Uint32Array;
  /** Agent indices grouped by cell, length capacity (order within a cell is GPU-defined). */
  items: Uint32Array;
}

/** Per-agent sense parameters mirroring the CPU pass's SIM constants + budget. */
export interface SenseParams {
  budget: number;
  senseR2: number;
  sepR2: number;
  sigT: number;
}

export class GpuContext {
  readonly device: GPUDevice;
  readonly queue: GPUQueue;

  readonly cellSize: number;
  readonly gridW: number;
  readonly gridH: number;
  readonly numCells: number;
  readonly capacity: number;

  // --- storage / uniform buffers (allocated once at capacity) ---
  private readonly paramsBuf: GPUBuffer;
  private readonly posXBuf: GPUBuffer;
  private readonly posYBuf: GPUBuffer;
  private readonly countsBuf: GPUBuffer;
  private readonly cellStartBuf: GPUBuffer;
  private readonly itemsBuf: GPUBuffer;
  private readonly cursorBuf: GPUBuffer;
  // staging buffers for reading the grid back to the CPU (verify / Tier B).
  private readonly cellStartRead: GPUBuffer;
  private readonly itemsRead: GPUBuffer;

  private readonly bindGroup: GPUBindGroup;
  private readonly pipeClear: GPUComputePipeline;
  private readonly pipeCount: GPUComputePipeline;
  private readonly pipeScan: GPUComputePipeline;
  private readonly pipeScatter: GPUComputePipeline;

  // --- sense pass (reads the resident grid + genes; writes interleaved aggregates) ---
  private readonly genesBuf: GPUBuffer;
  private readonly senseParamsBuf: GPUBuffer;
  private readonly senseOutBuf: GPUBuffer;
  private readonly senseOutRead: GPUBuffer;
  private readonly senseBindGroup: GPUBindGroup;
  private readonly pipeSense: GPUComputePipeline;
  private readonly senseParamsHost = new ArrayBuffer(32);
  private readonly senseParamsU32 = new Uint32Array(this.senseParamsHost);
  private readonly senseParamsF32 = new Float32Array(this.senseParamsHost);

  // --- steer pass (reads senseOut + genes + resource + danger fields; writes steer) ---
  private readonly resourcesBuf: GPUBuffer;
  private readonly dangerBuf: GPUBuffer;
  private readonly steerParamsBuf: GPUBuffer;
  private readonly steerOutBuf: GPUBuffer;
  private readonly steerOutRead: GPUBuffer;
  private readonly steerBindGroup: GPUBindGroup;
  private readonly pipeSteer: GPUComputePipeline;
  private readonly steerParamsHost = new ArrayBuffer(48);
  private readonly steerParamsU32 = new Uint32Array(this.steerParamsHost);
  private readonly steerParamsF32 = new Float32Array(this.steerParamsHost);

  // --- velocity buffers (persistent agent state; integrate reads, writes them) ---
  private readonly velXBuf: GPUBuffer;
  private readonly velYBuf: GPUBuffer;

  // --- integrate pass (per-agent physics; reads steer, reads+writes pos/vel in place) ---
  private readonly intParamsBuf: GPUBuffer;
  private readonly intBindGroup: GPUBindGroup;
  private readonly pipeIntegrate: GPUComputePipeline;
  private readonly intParamsHost = new ArrayBuffer(48);
  private readonly intParamsU32 = new Uint32Array(this.intParamsHost);
  private readonly intParamsF32 = new Float32Array(this.intParamsHost);

  // --- staging buffers for reading agent state back (resident chain + verifies) ---
  private readonly posXRead: GPUBuffer;
  private readonly posYRead: GPUBuffer;
  private readonly velXRead: GPUBuffer;
  private readonly velYRead: GPUBuffer;
  private readonly resourcesRead: GPUBuffer;
  // One combined staging buffer: [posX|posY|velX|velY|energy|age|resources], each slice
  // capacity-aligned. The loop's hot-path readback copies all of it back in ONE
  // mapAsync (one CPU↔GPU sync point per tick instead of seven).
  private readonly combinedRead: GPUBuffer;

  // --- energy / age buffers (persistent state; metabolism reads + writes them) ---
  private readonly energyBuf: GPUBuffer;
  private readonly ageBuf: GPUBuffer;

  // --- metabolism pass (drain + age per-agent, atomic CAS-clamp resource intake) ---
  private readonly metabParamsBuf: GPUBuffer;
  private readonly energyRead: GPUBuffer;
  private readonly ageRead: GPUBuffer;
  private readonly metabBindGroup: GPUBindGroup;
  private readonly pipeMetab: GPUComputePipeline;
  private readonly metabParamsHost = new ArrayBuffer(96);
  private readonly metabParamsU32 = new Uint32Array(this.metabParamsHost);
  private readonly metabParamsF32 = new Float32Array(this.metabParamsHost);

  // Reused host-side scratch for the 32-byte Params upload (zero per-call alloc).
  private readonly paramsHost = new ArrayBuffer(32);
  private readonly paramsU32 = new Uint32Array(this.paramsHost);
  private readonly paramsF32 = new Float32Array(this.paramsHost);

  private constructor(gpu: GpuDevice, cellSize: number, worldW: number, worldH: number, capacity: number) {
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.cellSize = cellSize;
    this.gridW = Math.ceil(worldW / cellSize);
    this.gridH = Math.ceil(worldH / cellSize);
    this.numCells = this.gridW * this.gridH;
    this.capacity = capacity;

    const dev = this.device;
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const u32 = Uint32Array.BYTES_PER_ELEMENT;
    const STORAGE = GPUBufferUsage.STORAGE;
    const buf = (size: number, usage: number): GPUBuffer => dev.createBuffer({ size, usage });

    this.paramsBuf = buf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.posXBuf = buf(capacity * f32, STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.posYBuf = buf(capacity * f32, STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.countsBuf = buf(this.numCells * u32, STORAGE);
    this.cellStartBuf = buf((this.numCells + 1) * u32, STORAGE | GPUBufferUsage.COPY_SRC);
    this.itemsBuf = buf(capacity * u32, STORAGE | GPUBufferUsage.COPY_SRC);
    this.cursorBuf = buf(this.numCells * u32, STORAGE);
    this.cellStartRead = buf((this.numCells + 1) * u32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.itemsRead = buf(capacity * u32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    const module = dev.createShaderModule({ code: HASH_WGSL });
    const layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const pipelineLayout = dev.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipe = (entryPoint: string): GPUComputePipeline =>
      dev.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
    this.pipeClear = pipe("clearCells");
    this.pipeCount = pipe("count");
    this.pipeScan = pipe("scan");
    this.pipeScatter = pipe("scatter");

    this.bindGroup = dev.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.posXBuf } },
        { binding: 2, resource: { buffer: this.posYBuf } },
        { binding: 3, resource: { buffer: this.countsBuf } },
        { binding: 4, resource: { buffer: this.cellStartBuf } },
        { binding: 5, resource: { buffer: this.itemsBuf } },
        { binding: 6, resource: { buffer: this.cursorBuf } },
      ],
    });

    // --- sense pass: reuses posX/posY + the resident grid, adds genes + outputs ---
    this.genesBuf = buf(capacity * GENE_COUNT * f32, STORAGE | GPUBufferUsage.COPY_DST);
    this.senseParamsBuf = buf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.senseOutBuf = buf(capacity * SENSE_STRIDE * f32, STORAGE | GPUBufferUsage.COPY_SRC);
    this.senseOutRead = buf(capacity * SENSE_STRIDE * f32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    const senseModule = dev.createShaderModule({ code: SENSE_WGSL });
    const senseLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.pipeSense = dev.createComputePipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [senseLayout] }),
      compute: { module: senseModule, entryPoint: "senseMain" },
    });
    this.senseBindGroup = dev.createBindGroup({
      layout: senseLayout,
      entries: [
        { binding: 0, resource: { buffer: this.senseParamsBuf } },
        { binding: 1, resource: { buffer: this.posXBuf } },
        { binding: 2, resource: { buffer: this.posYBuf } },
        { binding: 3, resource: { buffer: this.genesBuf } },
        { binding: 4, resource: { buffer: this.cellStartBuf } },
        { binding: 5, resource: { buffer: this.itemsBuf } },
        { binding: 6, resource: { buffer: this.senseOutBuf } },
      ],
    });

    // --- steer pass: consumes senseOut + genes (resident) + resource + danger fields ---
    this.resourcesBuf = buf(RES_CELLS * f32, STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.dangerBuf = buf(RES_CELLS * f32, STORAGE | GPUBufferUsage.COPY_DST); // read-only in steer
    this.steerParamsBuf = buf(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    // COPY_DST too: integrate's verify uploads an explicit steer vector here.
    this.steerOutBuf = buf(capacity * STEER_STRIDE * f32, STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    this.steerOutRead = buf(capacity * STEER_STRIDE * f32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    const steerModule = dev.createShaderModule({ code: STEER_WGSL });
    const steerLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeSteer = dev.createComputePipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [steerLayout] }),
      compute: { module: steerModule, entryPoint: "steerMain" },
    });
    this.steerBindGroup = dev.createBindGroup({
      layout: steerLayout,
      entries: [
        { binding: 0, resource: { buffer: this.steerParamsBuf } },
        { binding: 1, resource: { buffer: this.posXBuf } },
        { binding: 2, resource: { buffer: this.posYBuf } },
        { binding: 3, resource: { buffer: this.genesBuf } },
        { binding: 4, resource: { buffer: this.senseOutBuf } },
        { binding: 5, resource: { buffer: this.resourcesBuf } },
        { binding: 6, resource: { buffer: this.steerOutBuf } },
        { binding: 7, resource: { buffer: this.dangerBuf } },
      ],
    });

    // --- integrate pass: consumes steerOut, reads+writes pos/vel in place ---
    this.velXBuf = buf(capacity * f32, STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.velYBuf = buf(capacity * f32, STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.intParamsBuf = buf(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const readBuf = (n: number): GPUBuffer => buf(n, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.posXRead = readBuf(capacity * f32);
    this.posYRead = readBuf(capacity * f32);
    this.velXRead = readBuf(capacity * f32);
    this.velYRead = readBuf(capacity * f32);
    this.resourcesRead = readBuf(RES_CELLS * f32);
    this.combinedRead = readBuf((6 * capacity + RES_CELLS) * f32);

    const intModule = dev.createShaderModule({ code: INTEGRATE_WGSL });
    const intLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeIntegrate = dev.createComputePipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [intLayout] }),
      compute: { module: intModule, entryPoint: "integrateMain" },
    });
    this.intBindGroup = dev.createBindGroup({
      layout: intLayout,
      entries: [
        { binding: 0, resource: { buffer: this.intParamsBuf } },
        { binding: 1, resource: { buffer: this.posXBuf } },
        { binding: 2, resource: { buffer: this.posYBuf } },
        { binding: 3, resource: { buffer: this.velXBuf } },
        { binding: 4, resource: { buffer: this.velYBuf } },
        { binding: 5, resource: { buffer: this.steerOutBuf } },
        { binding: 6, resource: { buffer: this.genesBuf } },
      ],
    });

    // --- metabolism pass: per-agent drain/age + atomic resource intake (8 storage) ---
    this.energyBuf = buf(capacity * f32, STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.ageBuf = buf(capacity * f32, STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.metabParamsBuf = buf(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.energyRead = buf(capacity * f32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.ageRead = buf(capacity * f32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    const metabModule = dev.createShaderModule({ code: METABOLISM_WGSL });
    const metabLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.pipeMetab = dev.createComputePipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [metabLayout] }),
      compute: { module: metabModule, entryPoint: "metabolismMain" },
    });
    this.metabBindGroup = dev.createBindGroup({
      layout: metabLayout,
      entries: [
        { binding: 0, resource: { buffer: this.metabParamsBuf } },
        { binding: 1, resource: { buffer: this.posXBuf } },
        { binding: 2, resource: { buffer: this.posYBuf } },
        { binding: 3, resource: { buffer: this.velXBuf } },
        { binding: 4, resource: { buffer: this.velYBuf } },
        { binding: 5, resource: { buffer: this.genesBuf } },
        { binding: 6, resource: { buffer: this.energyBuf } },
        { binding: 7, resource: { buffer: this.ageBuf } },
        { binding: 8, resource: { buffer: this.resourcesBuf } },
      ],
    });
  }

  /** Acquire a device and build the context, or null if WebGPU is unavailable. */
  static async create(cellSize: number, worldW: number, worldH: number, capacity: number): Promise<GpuContext | null> {
    const gpu = await acquireGpuDevice();
    if (!gpu) return null;
    return new GpuContext(gpu, cellSize, worldW, worldH, capacity);
  }

  // --- param-uniform setters (shared by the *Build methods and the resident chain) ---
  private writeHashParams(count: number): void {
    this.paramsU32[0] = count;
    this.paramsU32[1] = this.gridW;
    this.paramsU32[2] = this.gridH;
    this.paramsU32[3] = this.numCells;
    this.paramsF32[4] = this.cellSize;
    this.paramsF32[5] = this.gridW * this.cellSize; // worldW (informational in-shader)
    this.paramsF32[6] = this.gridH * this.cellSize; // worldH
    this.paramsU32[7] = 0;
    this.queue.writeBuffer(this.paramsBuf, 0, this.paramsHost);
  }

  private writeSenseParams(count: number, p: SenseParams): void {
    this.senseParamsU32[0] = count;
    this.senseParamsU32[1] = this.gridW;
    this.senseParamsU32[2] = this.gridH;
    this.senseParamsU32[3] = p.budget;
    this.senseParamsF32[4] = this.cellSize;
    this.senseParamsF32[5] = p.senseR2;
    this.senseParamsF32[6] = p.sepR2;
    this.senseParamsF32[7] = p.sigT;
    this.queue.writeBuffer(this.senseParamsBuf, 0, this.senseParamsHost);
  }

  private writeSteerParams(count: number, seed: number): void {
    this.steerParamsU32[0] = count;
    this.steerParamsU32[1] = RESOURCE_GRID_W;
    this.steerParamsU32[2] = RESOURCE_GRID_H;
    this.steerParamsU32[3] = seed >>> 0;
    this.steerParamsF32[4] = RES_CELL_W;
    this.steerParamsF32[5] = RES_CELL_H;
    // Cognition knobs (Ant rung), read live from the data module — same as
    // writeIntParams reads SIM/MORPH. CPU steer.ts reads the same COGNITION.
    this.steerParamsF32[6] = COGNITION.level;
    this.steerParamsU32[7] = COGNITION.mask >>> 0;
    this.steerParamsF32[8] = STIGMERGY.dangerGain;
    this.steerParamsF32[9] = STIGMERGY.dangerMaxPull;
    this.queue.writeBuffer(this.steerParamsBuf, 0, this.steerParamsHost);
  }

  private writeIntParams(count: number): void {
    this.intParamsU32[0] = count;
    this.intParamsF32[1] = SIM.steerAccel;
    this.intParamsF32[2] = SIM.wallBounce;
    this.intParamsF32[3] = WORLD_W;
    this.intParamsF32[4] = WORLD_H;
    this.intParamsF32[5] = SIM.sizeSpeedFactor;
    this.intParamsF32[6] = SIM.baseMaxSpeed;
    this.intParamsF32[7] = TICK_DT;
    this.intParamsF32[8] = MORPH.effSpeedPenalty;
    this.queue.writeBuffer(this.intParamsBuf, 0, this.intParamsHost);
  }

  private writeMetabParams(count: number, hz: HazardParams): void {
    this.metabParamsU32[0] = count;
    this.metabParamsU32[1] = RESOURCE_GRID_W;
    this.metabParamsU32[2] = RESOURCE_GRID_H;
    this.metabParamsU32[3] = hz.active ? 1 : 0;
    this.metabParamsF32[4] = TICK_DT;
    this.metabParamsF32[5] = COSTS.baseDrain;
    this.metabParamsF32[6] = COSTS.sizeDrain;
    this.metabParamsF32[7] = COSTS.moveCost;
    this.metabParamsF32[8] = COSTS.senescenceDrain;
    this.metabParamsF32[9] = COSTS.hazardDrain;
    this.metabParamsF32[10] = COSTS.intakeRate;
    this.metabParamsF32[11] = COSTS.intakeSizeExp;
    this.metabParamsF32[12] = SIM.maxEnergyPerSize;
    this.metabParamsF32[13] = RES_CELL_W;
    this.metabParamsF32[14] = RES_CELL_H;
    this.metabParamsF32[15] = hz.x;
    this.metabParamsF32[16] = hz.y;
    this.metabParamsF32[17] = hz.r2;
    this.metabParamsF32[18] = MORPH.resMovePenalty;
    this.metabParamsF32[19] = MORPH.resHazardReduction;
    this.metabParamsF32[20] = MORPH.effIntakeBonus;
    this.queue.writeBuffer(this.metabParamsBuf, 0, this.metabParamsHost);
  }

  private passWith(enc: GPUCommandEncoder, bindGroup: GPUBindGroup, pipeline: GPUComputePipeline, wg: number): void {
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(wg);
    pass.end();
  }

  /** Upload positions and run clear → count → scan → scatter for the active set. */
  buildHash(posX: Float32Array, posY: Float32Array, count: number): void {
    this.writeHashParams(count);

    if (count > 0) {
      // Cast narrows Float32Array<ArrayBufferLike> → <ArrayBuffer> for the WebGPU
      // upload type; the pool arrays are never SharedArrayBuffer-backed.
      this.queue.writeBuffer(this.posXBuf, 0, posX as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.posYBuf, 0, posY as Float32Array<ArrayBuffer>, 0, count);
    }

    const cellWG = Math.ceil(this.numCells / WG);
    const agentWG = Math.ceil(count / WG);

    // Each kernel has a read/write hazard on the next (counts, cellStart, cursor).
    // WebGPU only guarantees memory synchronization BETWEEN compute passes, not
    // between dispatches inside one pass — so each dependent step gets its own pass.
    const enc = this.device.createCommandEncoder();
    this.dispatch(enc, this.pipeClear, cellWG); // zero counts + cursor
    if (agentWG > 0) this.dispatch(enc, this.pipeCount, agentWG); // tally per cell
    this.dispatch(enc, this.pipeScan, 1); // prefix sum → cellStart
    if (agentWG > 0) this.dispatch(enc, this.pipeScatter, agentWG); // place indices
    this.queue.submit([enc.finish()]);
  }

  private dispatch(enc: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
  }

  /** Copy the grid buffers back to the CPU (await). Returns fresh typed arrays. */
  async readGrid(): Promise<GpuGridResult> {
    const u32 = Uint32Array.BYTES_PER_ELEMENT;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.cellStartBuf, 0, this.cellStartRead, 0, (this.numCells + 1) * u32);
    enc.copyBufferToBuffer(this.itemsBuf, 0, this.itemsRead, 0, this.capacity * u32);
    this.queue.submit([enc.finish()]);

    await this.cellStartRead.mapAsync(GPUMapMode.READ);
    await this.itemsRead.mapAsync(GPUMapMode.READ);
    const cellStart = new Uint32Array(this.cellStartRead.getMappedRange()).slice();
    const items = new Uint32Array(this.itemsRead.getMappedRange()).slice();
    this.cellStartRead.unmap();
    this.itemsRead.unmap();
    return { cellStart, items };
  }

  /**
   * Run the sense pass. Positions and the grid must already be resident (call
   * buildHash first on the same snapshot); this uploads genes + sense params and
   * dispatches over the active set. Output is read with readSense().
   */
  senseBuild(genes: Float32Array, count: number, p: SenseParams): void {
    this.writeSenseParams(count, p);

    if (count > 0) {
      this.queue.writeBuffer(this.genesBuf, 0, genes as Float32Array<ArrayBuffer>, 0, count * GENE_COUNT);
    }

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.senseBindGroup);
    pass.setPipeline(this.pipeSense);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(count / WG)));
    pass.end();
    this.queue.submit([enc.finish()]);
  }

  /** Read the interleaved sense output back (length capacity*SENSE_STRIDE copy). */
  async readSense(): Promise<Float32Array> {
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.senseOutBuf, 0, this.senseOutRead, 0, this.capacity * SENSE_STRIDE * f32);
    this.queue.submit([enc.finish()]);
    await this.senseOutRead.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(this.senseOutRead.getMappedRange()).slice();
    this.senseOutRead.unmap();
    return out;
  }

  /**
   * Run the steer pass. Requires the grid + sense to have run on the same snapshot
   * (positions, genes, senseOut resident). Uploads the resource field + params and
   * dispatches; output read with readSteer(). `seed` drives the per-agent wander RNG
   * (the GPU's own determinism domain — pass the sim tick).
   */
  steerBuild(resources: Float32Array, danger: Float32Array, count: number, seed: number): void {
    this.writeSteerParams(count, seed);
    this.queue.writeBuffer(this.resourcesBuf, 0, resources as Float32Array<ArrayBuffer>, 0, RES_CELLS);
    this.queue.writeBuffer(this.dangerBuf, 0, danger as Float32Array<ArrayBuffer>, 0, RES_CELLS);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.steerBindGroup);
    pass.setPipeline(this.pipeSteer);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(count / WG)));
    pass.end();
    this.queue.submit([enc.finish()]);
  }

  /** Read the interleaved steer output back (length capacity*STEER_STRIDE copy). */
  async readSteer(): Promise<Float32Array> {
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.steerOutBuf, 0, this.steerOutRead, 0, this.capacity * STEER_STRIDE * f32);
    this.queue.submit([enc.finish()]);
    await this.steerOutRead.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(this.steerOutRead.getMappedRange()).slice();
    this.steerOutRead.unmap();
    return out;
  }

  /**
   * Run the integrate pass on an explicit input set (used by the verify so it is
   * isolated from the steer pass). Uploads positions, velocities, the steer vector
   * (interleaved stride 2), and genes; reads params live from SIM/capacity so it
   * matches the CPU pass. Output read with readIntegrate() (stride 4).
   */
  integrateBuild(
    posX: Float32Array,
    posY: Float32Array,
    velX: Float32Array,
    velY: Float32Array,
    steerInterleaved: Float32Array,
    genes: Float32Array,
    count: number,
  ): void {
    this.writeIntParams(count);

    if (count > 0) {
      this.queue.writeBuffer(this.posXBuf, 0, posX as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.posYBuf, 0, posY as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.velXBuf, 0, velX as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.velYBuf, 0, velY as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.steerOutBuf, 0, steerInterleaved as Float32Array<ArrayBuffer>, 0, count * STEER_STRIDE);
      this.queue.writeBuffer(this.genesBuf, 0, genes as Float32Array<ArrayBuffer>, 0, count * GENE_COUNT);
    }

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.intBindGroup);
    pass.setPipeline(this.pipeIntegrate);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(count / WG)));
    pass.end();
    this.queue.submit([enc.finish()]);
  }

  /** Read the (in-place) integrate result: new posX/posY/velX/velY arrays. */
  async readIntegrate(): Promise<{ posX: Float32Array; posY: Float32Array; velX: Float32Array; velY: Float32Array }> {
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const n = this.capacity * f32;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.posXBuf, 0, this.posXRead, 0, n);
    enc.copyBufferToBuffer(this.posYBuf, 0, this.posYRead, 0, n);
    enc.copyBufferToBuffer(this.velXBuf, 0, this.velXRead, 0, n);
    enc.copyBufferToBuffer(this.velYBuf, 0, this.velYRead, 0, n);
    this.queue.submit([enc.finish()]);
    await this.posXRead.mapAsync(GPUMapMode.READ);
    await this.posYRead.mapAsync(GPUMapMode.READ);
    await this.velXRead.mapAsync(GPUMapMode.READ);
    await this.velYRead.mapAsync(GPUMapMode.READ);
    const posX = new Float32Array(this.posXRead.getMappedRange()).slice();
    const posY = new Float32Array(this.posYRead.getMappedRange()).slice();
    const velX = new Float32Array(this.velXRead.getMappedRange()).slice();
    const velY = new Float32Array(this.velYRead.getMappedRange()).slice();
    this.posXRead.unmap();
    this.posYRead.unmap();
    this.velXRead.unmap();
    this.velYRead.unmap();
    return { posX, posY, velX, velY };
  }

  /**
   * Run the metabolism pass on an explicit input set. Uploads positions, velocities,
   * genes, energy, age, and the resource field (f32 bit patterns the kernel treats as
   * atomic<u32>); reads costs live from COSTS/SIM. The resource buffer is depleted in
   * place by the atomic intake, so it is re-uploaded each call. Read with
   * readMetabolism().
   */
  metabolismBuild(
    posX: Float32Array,
    posY: Float32Array,
    velX: Float32Array,
    velY: Float32Array,
    genes: Float32Array,
    energy: Float32Array,
    age: Float32Array,
    resources: Float32Array,
    count: number,
    hz: HazardParams,
  ): void {
    this.writeMetabParams(count, hz);

    if (count > 0) {
      this.queue.writeBuffer(this.posXBuf, 0, posX as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.posYBuf, 0, posY as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.velXBuf, 0, velX as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.velYBuf, 0, velY as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.genesBuf, 0, genes as Float32Array<ArrayBuffer>, 0, count * GENE_COUNT);
      this.queue.writeBuffer(this.energyBuf, 0, energy as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.ageBuf, 0, age as Float32Array<ArrayBuffer>, 0, count);
    }
    // The whole resource field (atomic f32 bits), re-uploaded since intake depletes it.
    this.queue.writeBuffer(this.resourcesBuf, 0, resources as Float32Array<ArrayBuffer>, 0, RES_CELLS);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.metabBindGroup);
    pass.setPipeline(this.pipeMetab);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(count / WG)));
    pass.end();
    this.queue.submit([enc.finish()]);
  }

  /** Read the metabolism outputs back: fresh energy + age arrays (length capacity). */
  async readMetabolism(): Promise<{ energy: Float32Array; age: Float32Array }> {
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.energyBuf, 0, this.energyRead, 0, this.capacity * f32);
    enc.copyBufferToBuffer(this.ageBuf, 0, this.ageRead, 0, this.capacity * f32);
    this.queue.submit([enc.finish()]);
    await this.energyRead.mapAsync(GPUMapMode.READ);
    await this.ageRead.mapAsync(GPUMapMode.READ);
    const energy = new Float32Array(this.energyRead.getMappedRange()).slice();
    const age = new Float32Array(this.ageRead.getMappedRange()).slice();
    this.energyRead.unmap();
    this.ageRead.unmap();
    return { energy, age };
  }

  // ============================ resident Tier A chain ============================
  // Upload state once, run the whole chain GPU-resident (no readback between passes —
  // the buffer contract's payoff), read state back once. This is the loop's hot path.

  /** Upload the full active-set agent state into the resident buffers. */
  uploadState(
    posX: Float32Array,
    posY: Float32Array,
    velX: Float32Array,
    velY: Float32Array,
    energy: Float32Array,
    age: Float32Array,
    genes: Float32Array,
    count: number,
  ): void {
    if (count <= 0) return;
    const c = (a: Float32Array): Float32Array<ArrayBuffer> => a as Float32Array<ArrayBuffer>;
    this.queue.writeBuffer(this.posXBuf, 0, c(posX), 0, count);
    this.queue.writeBuffer(this.posYBuf, 0, c(posY), 0, count);
    this.queue.writeBuffer(this.velXBuf, 0, c(velX), 0, count);
    this.queue.writeBuffer(this.velYBuf, 0, c(velY), 0, count);
    this.queue.writeBuffer(this.energyBuf, 0, c(energy), 0, count);
    this.queue.writeBuffer(this.ageBuf, 0, c(age), 0, count);
    this.queue.writeBuffer(this.genesBuf, 0, c(genes), 0, count * GENE_COUNT);
  }

  /** Upload the resource field (f32 bits; metabolism's atomic intake depletes it). */
  uploadResources(resources: Float32Array): void {
    this.queue.writeBuffer(this.resourcesBuf, 0, resources as Float32Array<ArrayBuffer>, 0, RES_CELLS);
  }

  /** Upload the danger field (read-only; steer descends its gradient). */
  uploadDanger(danger: Float32Array): void {
    this.queue.writeBuffer(this.dangerBuf, 0, danger as Float32Array<ArrayBuffer>, 0, RES_CELLS);
  }

  /**
   * Run the resident Tier A chain in ONE submission. On think ticks: hash → sense →
   * steer; every tick: integrate (in place) → metabolism. Each pass is its own compute
   * pass so the automatic inter-pass barrier orders the read/write hazards. State must
   * already be uploaded (uploadState/uploadResources); read back with downloadState.
   */
  runTierA(count: number, think: boolean, seed: number, senseP: SenseParams, hz: HazardParams): void {
    if (think) {
      this.writeHashParams(count);
      this.writeSenseParams(count, senseP);
      this.writeSteerParams(count, seed);
    }
    this.writeIntParams(count);
    this.writeMetabParams(count, hz);

    const agentWG = Math.max(1, Math.ceil(count / WG));
    const cellWG = Math.ceil(this.numCells / WG);
    const enc = this.device.createCommandEncoder();

    if (think) {
      // spatial hash (clear → count → scan → scatter), each its own pass
      this.passWith(enc, this.bindGroup, this.pipeClear, cellWG);
      if (count > 0) this.passWith(enc, this.bindGroup, this.pipeCount, agentWG);
      this.passWith(enc, this.bindGroup, this.pipeScan, 1);
      if (count > 0) this.passWith(enc, this.bindGroup, this.pipeScatter, agentWG);
      // sense → steer
      this.passWith(enc, this.senseBindGroup, this.pipeSense, agentWG);
      this.passWith(enc, this.steerBindGroup, this.pipeSteer, agentWG);
    }
    // integrate (writes pos/vel in place) → metabolism (reads the moved positions)
    this.passWith(enc, this.intBindGroup, this.pipeIntegrate, agentWG);
    this.passWith(enc, this.metabBindGroup, this.pipeMetab, agentWG);

    this.queue.submit([enc.finish()]);
  }

  /** Read the full agent state back after a resident run (positions, vel, energy, age). */
  async downloadState(): Promise<GpuState> {
    const n = this.capacity * Float32Array.BYTES_PER_ELEMENT;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.posXBuf, 0, this.posXRead, 0, n);
    enc.copyBufferToBuffer(this.posYBuf, 0, this.posYRead, 0, n);
    enc.copyBufferToBuffer(this.velXBuf, 0, this.velXRead, 0, n);
    enc.copyBufferToBuffer(this.velYBuf, 0, this.velYRead, 0, n);
    enc.copyBufferToBuffer(this.energyBuf, 0, this.energyRead, 0, n);
    enc.copyBufferToBuffer(this.ageBuf, 0, this.ageRead, 0, n);
    this.queue.submit([enc.finish()]);
    const reads = [this.posXRead, this.posYRead, this.velXRead, this.velYRead, this.energyRead, this.ageRead];
    for (const r of reads) await r.mapAsync(GPUMapMode.READ);
    const out: GpuState = {
      posX: new Float32Array(this.posXRead.getMappedRange()).slice(),
      posY: new Float32Array(this.posYRead.getMappedRange()).slice(),
      velX: new Float32Array(this.velXRead.getMappedRange()).slice(),
      velY: new Float32Array(this.velYRead.getMappedRange()).slice(),
      energy: new Float32Array(this.energyRead.getMappedRange()).slice(),
      age: new Float32Array(this.ageRead.getMappedRange()).slice(),
    };
    for (const r of reads) r.unmap();
    return out;
  }

  /** Read the resource field back (depleted by metabolism's intake). */
  async downloadResources(): Promise<Float32Array> {
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.resourcesBuf, 0, this.resourcesRead, 0, RES_CELLS * Float32Array.BYTES_PER_ELEMENT);
    this.queue.submit([enc.finish()]);
    await this.resourcesRead.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(this.resourcesRead.getMappedRange()).slice();
    this.resourcesRead.unmap();
    return out;
  }

  /**
   * Loop hot-path readback: copy pos/vel/energy/age (+ resources) back into the
   * provided destination arrays in ONE mapAsync, zero allocation. The destinations are
   * the World's pools (reused), so nothing is allocated per tick. One CPU↔GPU sync.
   */
  async downloadAll(
    posX: Float32Array,
    posY: Float32Array,
    velX: Float32Array,
    velY: Float32Array,
    energy: Float32Array,
    age: Float32Array,
    resources: Float32Array,
    count: number,
  ): Promise<void> {
    await this.submitReadback(count);
    this.finishReadback(posX, posY, velX, velY, energy, age, resources, count);
  }

  // --- pipelined readback (submit now, await + apply LATER) ------------------------
  // Splitting downloadAll lets the loop submit a tick's readback and await it a frame
  // later, by which time a discrete GPU has finished it → the await doesn't stall.

  /** Encode + submit the combined readback copy; return the (un-awaited) map promise. */
  submitReadback(count: number): Promise<undefined> {
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const cap = this.capacity;
    const enc = this.device.createCommandEncoder();
    const n = count * f32;
    if (count > 0) {
      enc.copyBufferToBuffer(this.posXBuf, 0, this.combinedRead, 0 * cap * f32, n);
      enc.copyBufferToBuffer(this.posYBuf, 0, this.combinedRead, 1 * cap * f32, n);
      enc.copyBufferToBuffer(this.velXBuf, 0, this.combinedRead, 2 * cap * f32, n);
      enc.copyBufferToBuffer(this.velYBuf, 0, this.combinedRead, 3 * cap * f32, n);
      enc.copyBufferToBuffer(this.energyBuf, 0, this.combinedRead, 4 * cap * f32, n);
      enc.copyBufferToBuffer(this.ageBuf, 0, this.combinedRead, 5 * cap * f32, n);
    }
    enc.copyBufferToBuffer(this.resourcesBuf, 0, this.combinedRead, 6 * cap * f32, RES_CELLS * f32);
    this.queue.submit([enc.finish()]);
    return this.combinedRead.mapAsync(GPUMapMode.READ);
  }

  /** Copy the mapped combined buffer into the pools and unmap. Map must be resolved. */
  finishReadback(
    posX: Float32Array,
    posY: Float32Array,
    velX: Float32Array,
    velY: Float32Array,
    energy: Float32Array,
    age: Float32Array,
    resources: Float32Array,
    count: number,
  ): void {
    const cap = this.capacity;
    const r = new Float32Array(this.combinedRead.getMappedRange());
    if (count > 0) {
      posX.set(r.subarray(0 * cap, 0 * cap + count));
      posY.set(r.subarray(1 * cap, 1 * cap + count));
      velX.set(r.subarray(2 * cap, 2 * cap + count));
      velY.set(r.subarray(3 * cap, 3 * cap + count));
      energy.set(r.subarray(4 * cap, 4 * cap + count));
      age.set(r.subarray(5 * cap, 5 * cap + count));
    }
    resources.set(r.subarray(6 * cap, 6 * cap + RES_CELLS));
    this.combinedRead.unmap();
  }
}
