import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/pwa/shouldReloadForBuild.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.shouldReloadForBuild !== "function") {
      throw new Error("shouldReloadForBuild export missing");
    }
    return { shouldReloadForBuild: mod.shouldReloadForBuild, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("shouldReloadForBuild: перезапуск при смене версии или build-hash", async () => {
  const helper = await loadHelper();
  try {
    assert.equal(helper.shouldReloadForBuild("0.1.73-111111111111", "0.1.73-111111111111"), false);
    assert.equal(helper.shouldReloadForBuild("0.1.73-111111111111", "0.1.73-222222222222"), true);
    assert.equal(helper.shouldReloadForBuild("0.1.73", "0.1.73-215efba26440"), false);
    assert.equal(helper.shouldReloadForBuild("0.1.73", "0.1.73"), false);
    assert.equal(helper.shouldReloadForBuild("0.1.73-111111111111", "0.1.73"), false);
    assert.equal(helper.shouldReloadForBuild("0.1.73", ""), false);
    assert.equal(helper.shouldReloadForBuild("", "0.1.74-deadbeefcafe"), false);
    assert.equal(helper.shouldReloadForBuild("0.1.73", "0.1.74-deadbeefcafe"), true);
  } finally {
    await helper.cleanup();
  }
});
