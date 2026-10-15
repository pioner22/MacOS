import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadDraftHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/drafts.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    const required = ["sanitizeDraftMap", "parseDraftsPayload", "serializeDraftsPayload", "updateDraftMap"];
    for (const k of required) {
      if (typeof mod[k] !== "function") throw new Error(`draft helper export missing: ${k}`);
    }
    return {
      sanitizeDraftMap: mod.sanitizeDraftMap,
      parseDraftsPayload: mod.parseDraftsPayload,
      serializeDraftsPayload: mod.serializeDraftsPayload,
      updateDraftMap: mod.updateDraftMap,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("drafts: updateDraftMap добавляет/удаляет по пустому тексту", async () => {
  const { updateDraftMap, cleanup } = await loadDraftHelpers();
  try {
    const a = updateDraftMap({}, "dm:111", "привет");
    assert.deepEqual(a, { "dm:111": "привет" });

    const b = updateDraftMap(a, "dm:111", "   ");
    assert.deepEqual(b, {});

    const c = updateDraftMap({}, "  ", "x");
    assert.deepEqual(c, {});
  } finally {
    await cleanup();
  }
});

test("drafts: serialize/parse фильтрует мусор и сохраняет только строки", async () => {
  const { parseDraftsPayload, serializeDraftsPayload, cleanup } = await loadDraftHelpers();
  try {
    const raw = JSON.stringify({ v: 1, drafts: { "dm:1": " ok ", "": "bad", "room:x": 123 } });
    assert.deepEqual(parseDraftsPayload(raw), { "dm:1": " ok " });

    const payload = serializeDraftsPayload({ "dm:1": "a", "dm:2": "   ", "room:1": "b" });
    assert.deepEqual(parseDraftsPayload(payload), { "dm:1": "a", "room:1": "b" });

    assert.deepEqual(parseDraftsPayload("not-json"), {});
    assert.deepEqual(parseDraftsPayload(JSON.stringify({ v: 2, drafts: { "dm:1": "a" } })), {});
  } finally {
    await cleanup();
  }
});

test("drafts: sanitizeDraftMap ограничивает размер черновика", async () => {
  const { sanitizeDraftMap, cleanup } = await loadDraftHelpers();
  try {
    const big = "x".repeat(5000);
    const out = sanitizeDraftMap({ "dm:1": big });
    assert.equal(typeof out["dm:1"], "string");
    assert.ok(out["dm:1"].length <= 4000);
  } finally {
    await cleanup();
  }
});

