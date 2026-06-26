# Headless GPU verify

Runs the WebGPU migration verifies (`src/gpu/verify.ts`) in a real WebGPU context
**without a browser click**, so each ported Tier A pass can be checked against the CPU
golden reference automatically. Uses Playwright driving headless Chrome with a
**SwiftShader** software WebGPU adapter — deterministic, no real GPU required. This
checks *correctness* (the GPU determinism domain), not performance.

`runner.mjs` loads the Vite dev server, then `page.evaluate`s a fresh world
(`createWorld → initResourceField → seedPopulation → simStep`), sets max intensity,
creates a `GpuContext`, and runs `verifyHash` / `verifySense`, printing JSON.

## One-time setup (kept OUT of the project to avoid touching node_modules)

```bash
WORK=/path/to/scratch          # NOT the repo
cd "$WORK" && npm init -y && npm i playwright@latest
# Use the LINUX node explicitly — plain npx may grab Windows node on WSL:
PLAYWRIGHT_BROWSERS_PATH="$WORK/pw-browsers" \
  /usr/bin/node "$WORK/node_modules/playwright-core/cli.js" install chromium
# No sudo? fetch chromium's missing libs locally:
mkdir -p "$WORK/debs" && cd "$WORK/debs"
apt-get download libnspr4 libnss3 libasound2t64
for d in *.deb; do dpkg-deb -x "$d" "$WORK/syslibs"; done
```

## Run

```bash
# 1) dev server (works under WSL; esbuild resolves fine now)
cd <repo> && npx vite --port 5179 --strictPort &

# 2) runner
WORK=/path/to/scratch
cp tools/gpu-verify/runner.mjs "$WORK/"
cd "$WORK"
PLAYWRIGHT_BROWSERS_PATH="$WORK/pw-browsers" \
LD_LIBRARY_PATH="$WORK/syslibs/usr/lib/x86_64-linux-gnu" \
URL=http://localhost:5179/ \
  /usr/bin/node runner.mjs
```

Expect `hash.ok` and `sense.ok` true with zero mismatches. Add new verify calls to
`runner.mjs` as more passes (steer/integrate/metabolism) are ported.
