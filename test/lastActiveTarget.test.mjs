import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadLastActiveTargetHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/ui/lastActiveTarget.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    const required = ["normalizeTargetRef", "parseLastActiveTargetPayload", "serializeLastActiveTargetPayload"];
    for (const k of required) {
      if (typeof mod[k] !== "function") throw new Error(`lastActiveTarget helper export missing: ${k}`);
    }
    return {
      normalizeTargetRef: mod.normalizeTargetRef,
      parseLastActiveTargetPayload: mod.parseLastActiveTargetPayload,
      serializeLastActiveTargetPayload: mod.serializeLastActiveTargetPayload,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("lastActiveTarget: parseLastActiveTargetPayload фильтрует мусор и валидирует kind/id", async () => {
  const { parseLastActiveTargetPayload, cleanup } = await loadLastActiveTargetHelpers();
  try {
    assert.equal(parseLastActiveTargetPayload(null), null);
    assert.equal(parseLastActiveTargetPayload(""), null);
    assert.equal(parseLastActiveTargetPayload("not-json"), null);
    assert.equal(parseLastActiveTargetPayload(JSON.stringify({ v: 2, target: { kind: "dm", id: "1" } })), null);
    assert.equal(parseLastActiveTargetPayload(JSON.stringify({ v: 1, target: { kind: "bad", id: "1" } })), null);
    assert.equal(parseLastActiveTargetPayload(JSON.stringify({ v: 1, target: { kind: "dm", id: "" } })), null);
    assert.equal(parseLastActiveTargetPayload(JSON.stringify({ v: 1, target: { kind: "dm", id: "x".repeat(200) } })), null);

    assert.deepEqual(parseLastActiveTargetPayload(JSON.stringify({ v: 1, target: { kind: "dm", id: "517-048-184" } })), {
      kind: "dm",
      id: "517-048-184",
    });
    assert.deepEqual(parseLastActiveTargetPayload(JSON.stringify({ v: 1, target: { kind: "board", id: "058-160-211" }, at: 123 })), {
      kind: "board",
      id: "058-160-211",
    });
  } finally {
    await cleanup();
  }
});

test("lastActiveTarget: serializeLastActiveTargetPayload делает roundtrip с parse", async () => {
  const { parseLastActiveTargetPayload, serializeLastActiveTargetPayload, cleanup } = await loadLastActiveTargetHelpers();
  try {
    const raw = serializeLastActiveTargetPayload({ kind: "group", id: "123-123-123" }, 1700000000000);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.v, 1);
    assert.deepEqual(parsed.target, { kind: "group", id: "123-123-123" });
    assert.equal(parsed.at, 1700000000000);
    assert.deepEqual(parseLastActiveTargetPayload(raw), { kind: "group", id: "123-123-123" });
  } finally {
    await cleanup();
  }
});
