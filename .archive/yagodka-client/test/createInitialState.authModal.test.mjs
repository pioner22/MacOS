import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadCreateInitialState() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/createInitialState.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
      define: {
        __APP_VERSION__: '"0.0.0-test"',
      },
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createInitialState !== "function") {
      throw new Error("createInitialState не экспортирован из бандла");
    }
    return { createInitialState: mod.createInitialState, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("createInitialState: сразу показывает экран авторизации без welcome-перехода", async () => {
  const { createInitialState, cleanup } = await loadCreateInitialState();
  try {
    const st = createInitialState();
    assert.deepEqual(st.modal, { kind: "auth" });
  } finally {
    await cleanup();
  }
});
