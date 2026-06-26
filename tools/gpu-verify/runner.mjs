import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:5179/";

const browser = await chromium.launch({
  channel: "chromium", // full chromium in --headless=new mode (needed for WebGPU)
  args: [
    "--no-sandbox",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
});

const page = await browser.newPage();
page.on("console", (m) => console.log("  [page]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

await page.goto(URL, { waitUntil: "domcontentloaded" });

const result = await page.evaluate(async () => {
  const out = {};
  try {
    const gpu = navigator.gpu;
    out.hasNavigatorGpu = !!gpu;
    if (gpu) {
      const ad = await gpu.requestAdapter();
      out.hasAdapter = !!ad;
      if (ad && ad.info) out.adapter = { vendor: ad.info.vendor, architecture: ad.info.architecture, description: ad.info.description };
    }

    const cap = await import("/src/data/capacity.ts");
    const { createWorld } = await import("/src/state/world.ts");
    const { initResourceField, seedPopulation } = await import("/src/sim/init.ts");
    const { simStep } = await import("/src/sim/step.ts");
    const { GpuContext } = await import("/src/gpu/gpuContext.ts");
    const { verifyHash, verifySense, verifySteer } = await import("/src/gpu/verify.ts");

    const world = createWorld(0x5eed);
    initResourceField(world);
    seedPopulation(world);
    for (let i = 0; i < 200; i++) simStep(world);
    world.intensity.neighborBudget = 64; // max → sense doesn't cap

    const ctx = await GpuContext.create(cap.HASH_CELL_SIZE, cap.WORLD_W, cap.WORLD_H, cap.MAX_AGENTS);
    if (!ctx) { out.error = "GpuContext.create returned null (no WebGPU device)"; return out; }
    out.gpuErrors = [];
    ctx.device.addEventListener("uncapturederror", (e) => { out.gpuErrors.push(String(e.error && e.error.message || e.error)); });
    out.hash = await verifyHash(world, ctx);
    out.sense = await verifySense(world, ctx);
    out.steer = await verifySteer(world, ctx);
  } catch (e) {
    out.error = String((e && e.stack) || e);
  }
  return out;
});

console.log("\n=== RESULT ===");
console.log(JSON.stringify(result, null, 2));
await browser.close();
