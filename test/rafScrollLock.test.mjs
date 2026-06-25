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
      entryPoints: [path.resolve("src/helpers/ui/rafScrollLock.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createRafScrollLock !== "function") throw new Error("createRafScrollLock export missing");
    return { createRafScrollLock: mod.createRafScrollLock, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("rafScrollLock: вызывает restore каждый кадр до stop()", async () => {
  const helper = await loadHelper();
  try {
    const calls = [];
    const scheduled = new Map();
    const canceled = [];
    let nextId = 1;

    const raf = (cb) => {
      const id = nextId++;
      scheduled.set(id, cb);
      return id;
    };
    const caf = (id) => {
      canceled.push(id);
      scheduled.delete(id);
    };
    const restore = (top, left) => calls.push([top, left]);

    const lock = helper.createRafScrollLock({ restore, requestAnimationFrame: raf, cancelAnimationFrame: caf });
    assert.equal(lock.isActive(), false);

    lock.start(10, 20);
    assert.equal(lock.isActive(), true);
    assert.deepEqual(calls, [[10, 20]]);
    assert.equal(scheduled.size, 1);

    // Simulate one animation frame.
    {
      const [id, cb] = [...scheduled.entries()][0];
      scheduled.delete(id);
      cb(0);
    }
    assert.equal(calls.length, 2, "restore должен вызваться на каждом кадре");
    assert.equal(scheduled.size, 1, "после кадра должен быть запланирован следующий");

    // Stop should cancel the next scheduled frame.
    const nextScheduledId = [...scheduled.keys()][0];
    lock.stop();
    assert.equal(lock.isActive(), false);
    assert.deepEqual(canceled, [nextScheduledId]);
    assert.equal(scheduled.size, 0);
  } finally {
    await helper.cleanup();
  }
});

