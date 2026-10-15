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
      entryPoints: [path.resolve("src/helpers/ui/scrollSnapshot.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.readScrollSnapshot !== "function") throw new Error("scrollSnapshot exports missing");
    return { readScrollSnapshot: mod.readScrollSnapshot, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("scrollSnapshot: использует snapshot только когда он свежий", async () => {
  const { readScrollSnapshot, cleanup } = await loadHelpers();
  try {
    const base = {
      curTop: 10,
      curLeft: 2,
      prevTop: 90,
      prevLeft: 7,
      prevAt: 1_000,
      hasPrev: true,
      maxAgeMs: 300,
    };

    const r1 = readScrollSnapshot({ ...base, now: 1_100 });
    assert.equal(r1.usedPrev, true);
    assert.equal(r1.top, 90);
    assert.equal(r1.left, 7);

    const r2 = readScrollSnapshot({ ...base, now: 1_400 });
    assert.equal(r2.usedPrev, false);
    assert.equal(r2.top, 10);
    assert.equal(r2.left, 2);

    const r3 = readScrollSnapshot({ ...base, hasPrev: false, now: 1_100 });
    assert.equal(r3.usedPrev, false);
    assert.equal(r3.top, 10);
    assert.equal(r3.left, 2);

    const r4 = readScrollSnapshot({ ...base, prevAt: 2_000, now: 1_500 });
    assert.equal(r4.usedPrev, false);
    assert.equal(r4.top, 10);
    assert.equal(r4.left, 2);
  } finally {
    await cleanup();
  }
});

