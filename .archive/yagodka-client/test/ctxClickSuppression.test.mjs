import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/ui/ctxClickSuppression.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.armCtxClickSuppression !== "function" || typeof mod.consumeCtxClickSuppression !== "function") {
      throw new Error("ctxClickSuppression exports missing");
    }
    return {
      armCtxClickSuppression: mod.armCtxClickSuppression,
      consumeCtxClickSuppression: mod.consumeCtxClickSuppression,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("ctxClickSuppression: arm/consume работают и сбрасывают состояние", async () => {
  const { armCtxClickSuppression, consumeCtxClickSuppression, cleanup } = await loadHelpers();
  const realNow = Date.now;
  try {
    Date.now = () => 1_000;
    let st = { key: null, until: 0 };
    st = armCtxClickSuppression(st, "dm", "123-456-789", 500);
    assert.deepEqual(st, { key: "dm:123-456-789", until: 1_500 });

    Date.now = () => 1_200;
    const r1 = consumeCtxClickSuppression(st, "dm", "123-456-789");
    assert.equal(r1.suppressed, true);
    assert.deepEqual(r1.state, { key: null, until: 0 });

    const r2 = consumeCtxClickSuppression(r1.state, "dm", "123-456-789");
    assert.equal(r2.suppressed, false);
    assert.deepEqual(r2.state, { key: null, until: 0 });

    Date.now = () => 1_000;
    st = armCtxClickSuppression({ key: null, until: 0 }, "dm", "x", 250);
    Date.now = () => 2_000;
    const r3 = consumeCtxClickSuppression(st, "dm", "x");
    assert.equal(r3.suppressed, false);
    assert.deepEqual(r3.state, { key: null, until: 0 });

    Date.now = () => 1_000;
    st = armCtxClickSuppression({ key: null, until: 0 }, "dm", "x", 1_000);
    const r4 = consumeCtxClickSuppression(st, "group", "x");
    assert.equal(r4.suppressed, false);
    assert.deepEqual(r4.state, st);
  } finally {
    Date.now = realNow;
    await cleanup();
  }
});
