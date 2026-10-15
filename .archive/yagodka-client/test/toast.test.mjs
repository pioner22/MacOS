import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadToastHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/ui/toast.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.defaultToastTimeoutMs !== "function") throw new Error("defaultToastTimeoutMs export missing");
    return { defaultToastTimeoutMs: mod.defaultToastTimeoutMs, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("toast: default timeout зависит от наличия actions", async () => {
  const { defaultToastTimeoutMs, cleanup } = await loadToastHelper();
  try {
    assert.equal(defaultToastTimeoutMs({ message: "hi" }), 3500);
    assert.equal(defaultToastTimeoutMs({ message: "hi", actions: [{ id: "undo", label: "Отмена" }] }), 6500);
  } finally {
    await cleanup();
  }
});

