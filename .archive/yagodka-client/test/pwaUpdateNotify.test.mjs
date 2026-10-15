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
      entryPoints: [path.resolve("src/helpers/pwa/registerServiceWorker.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.__shouldNotifyUpdateForTest !== "function") {
      throw new Error("__shouldNotifyUpdateForTest export missing");
    }
    return {
      shouldNotifyUpdate: mod.__shouldNotifyUpdateForTest,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("pwa update notify: waiting triggers без controller", async () => {
  const helper = await loadHelper();
  try {
    assert.equal(helper.shouldNotifyUpdate(null), false);
    assert.equal(helper.shouldNotifyUpdate({}), false);
    assert.equal(helper.shouldNotifyUpdate({ waiting: {} }), true);
  } finally {
    await helper.cleanup();
  }
});
