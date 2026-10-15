import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadPins() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/pins.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.togglePin !== "function" || typeof mod.parsePinsPayload !== "function" || typeof mod.serializePinsPayload !== "function") {
      throw new Error("pins exports missing");
    }
    return { togglePin: mod.togglePin, parsePinsPayload: mod.parsePinsPayload, serializePinsPayload: mod.serializePinsPayload, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("pins: togglePin добавляет в начало и удаляет", async () => {
  const { togglePin, cleanup } = await loadPins();
  try {
    assert.deepEqual(togglePin([], "dm:1"), ["dm:1"]);
    assert.deepEqual(togglePin(["dm:1"], "dm:1"), []);
    assert.deepEqual(togglePin(["dm:1"], "room:2"), ["room:2", "dm:1"]);
  } finally {
    await cleanup();
  }
});

test("pins: serialize/parse фильтрует мусор", async () => {
  const { parsePinsPayload, serializePinsPayload, cleanup } = await loadPins();
  try {
    const raw = JSON.stringify({ v: 1, pins: ["dm:1", "", 123, "dm:1"] });
    assert.deepEqual(parsePinsPayload(raw), ["dm:1"]);
    const payload = serializePinsPayload(["dm:1", " ", "room:2"]);
    assert.deepEqual(parsePinsPayload(payload), ["dm:1", "room:2"]);
  } finally {
    await cleanup();
  }
});

