import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHistoryGroupGeometry() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/chat/historyGroupGeometry.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.resolveHistoryGroupRole !== "function" || typeof mod.applyHistoryGroupGeometry !== "function") {
      throw new Error("historyGroupGeometry exports missing");
    }
    return {
      resolveHistoryGroupRole: mod.resolveHistoryGroupRole,
      applyHistoryGroupGeometry: mod.applyHistoryGroupGeometry,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("historyGroupGeometry: resolveHistoryGroupRole возвращает single/start/middle/end", async () => {
  const { resolveHistoryGroupRole, cleanup } = await loadHistoryGroupGeometry();
  try {
    assert.equal(resolveHistoryGroupRole(false, true), "single");
    assert.equal(resolveHistoryGroupRole(false, false), "start");
    assert.equal(resolveHistoryGroupRole(true, false), "middle");
    assert.equal(resolveHistoryGroupRole(true, true), "end");
  } finally {
    await cleanup();
  }
});

test("historyGroupGeometry: applyHistoryGroupGeometry ставит legacy и explicit group classes", async () => {
  const { applyHistoryGroupGeometry, cleanup } = await loadHistoryGroupGeometry();
  try {
    const attrs = new Map();
    const classes = new Set();
    const line = {
      classList: {
        add(...names) {
          for (const name of names) classes.add(String(name));
        },
      },
      setAttribute(name, value) {
        attrs.set(String(name), String(value));
      },
    };

    const role = applyHistoryGroupGeometry(line, true, false);
    assert.equal(role, "middle");
    assert.ok(classes.has("msg-cont"));
    assert.ok(!classes.has("msg-tail"));
    assert.ok(classes.has("msg-group-middle"));
    assert.equal(attrs.get("data-msg-group-role"), "middle");
  } finally {
    await cleanup();
  }
});
