// WebGPU device acquisition — a parallel compute context for the simulation only.
// Rendering stays on PixiJS/WebGL (docs/webgpu-migration §intent); this device is
// independent of Pixi's renderer. The whole sim must still run with NO WebGPU
// (most machines, and headless), so this returns null on any failure and callers
// fall back to the CPU Tier A passes (the golden reference).

export interface GpuDevice {
  readonly device: GPUDevice;
  readonly queue: GPUQueue;
}

/**
 * Try to acquire a compute-capable WebGPU device. Returns null (never throws) if
 * WebGPU is unavailable or adapter/device request fails — the caller stays on CPU.
 */
export async function acquireGpuDevice(): Promise<GpuDevice | null> {
  // navigator.gpu is absent on browsers without WebGPU and in Node/headless.
  const gpu: GPU | undefined = (globalThis.navigator as Navigator | undefined)?.gpu;
  if (!gpu) return null;

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    // Steer binds 11 storage buffers (the dual-nutrient set + the packed supply-scent field, P4a);
    // metabolism binds 10. The default limit is 8. Request 11; if the adapter can't, requestDevice
    // rejects → caught below → null → CPU fallback (the golden path still works everywhere).
    const device = await adapter.requestDevice({
      requiredLimits: { maxStorageBuffersPerShaderStage: 11 },
    });
    if (!device) return null;
    return { device, queue: device.queue };
  } catch {
    return null;
  }
}
