import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadDeriveServerSearchQuery() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/search/serverSearchQuery.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.deriveServerSearchQuery !== "function") {
      throw new Error("deriveServerSearchQuery не экспортирован из бандла");
    }
    return { deriveServerSearchQuery: mod.deriveServerSearchQuery, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("deriveServerSearchQuery: normalizes @handle", async () => {
  const { deriveServerSearchQuery, cleanup } = await loadDeriveServerSearchQuery();
  try {
    assert.deepEqual(deriveServerSearchQuery("@Pioner"), { kind: "handle", query: "@pioner" });
    assert.deepEqual(deriveServerSearchQuery("Pioner"), { kind: "handle", query: "@pioner" });
    assert.deepEqual(deriveServerSearchQuery("@pioner,"), { kind: "handle", query: "@pioner" });
  } finally {
    await cleanup();
  }
});

test("deriveServerSearchQuery: keeps legacy id formatting (hyphens)", async () => {
  const { deriveServerSearchQuery, cleanup } = await loadDeriveServerSearchQuery();
  try {
    assert.deepEqual(deriveServerSearchQuery("315-046-028"), { kind: "id", query: "315-046-028" });
    assert.deepEqual(deriveServerSearchQuery("315"), { kind: "id", query: "315" });
    assert.equal(deriveServerSearchQuery("31"), null);
  } finally {
    await cleanup();
  }
});

test("deriveServerSearchQuery: room id prefix", async () => {
  const { deriveServerSearchQuery, cleanup } = await loadDeriveServerSearchQuery();
  try {
    assert.deepEqual(deriveServerSearchQuery("grp-"), { kind: "room_id", query: "grp-" });
    assert.deepEqual(deriveServerSearchQuery("b-1"), { kind: "room_id", query: "b-1" });
    assert.equal(deriveServerSearchQuery("b-"), null);
  } finally {
    await cleanup();
  }
});

test("deriveServerSearchQuery: iOS wrong layout works only with @", async () => {
  const { deriveServerSearchQuery, cleanup } = await loadDeriveServerSearchQuery();
  try {
    // "Шмфт" is "Ivan" typed on RU layout.
    assert.equal(deriveServerSearchQuery("Шмфт"), null);
    assert.deepEqual(deriveServerSearchQuery("@Шмфт"), { kind: "handle", query: "@ivan" });
  } finally {
    await cleanup();
  }
});

