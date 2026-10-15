import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadStore() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-store-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/stores/store.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.Store !== "function") throw new Error("Store export missing");
    return { Store: mod.Store, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("Store: reducer returning same state does not notify subscribers", async () => {
  const helper = await loadStore();
  try {
    const store = new helper.Store({ count: 1 });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.set((prev) => prev);
    assert.equal(calls, 0);
    assert.deepEqual(store.get(), { count: 1 });

    store.set((prev) => ({ ...prev, count: 2 }));
    assert.equal(calls, 1);
    assert.deepEqual(store.get(), { count: 2 });
  } finally {
    await helper.cleanup();
  }
});

test("Store: explicit notify still supports DOM-driven re-render hooks", async () => {
  const helper = await loadStore();
  try {
    const store = new helper.Store({ count: 1 });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.notify();
    assert.equal(calls, 1);
    assert.deepEqual(store.get(), { count: 1 });
  } finally {
    await helper.cleanup();
  }
});
