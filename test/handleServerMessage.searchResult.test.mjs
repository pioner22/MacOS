import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHandleServerMessage() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/handleServerMessage.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.handleServerMessage !== "function") {
      throw new Error("handleServerMessage не экспортирован из бандла");
    }
    return { handleServerMessage: mod.handleServerMessage, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function createPatchHarness(initial) {
  let state = initial;
  const patch = (p) => {
    if (typeof p === "function") state = p(state);
    else state = { ...state, ...p };
  };
  return { getState: () => state, patch };
}

test("handleServerMessage: search_result не перезаписывает searchQuery", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const gateway = { send() {} };
    const { getState, patch } = createPatchHarness({
      searchQuery: "Pioner",
      searchResults: [],
      status: "",
    });

    handleServerMessage(
      { type: "search_result", query: "@pioner", results: [{ id: "123-45", name: "Pioner", handle: "@pioner", online: true, friend: false }] },
      getState(),
      gateway,
      patch
    );

    const st = getState();
    assert.equal(st.searchQuery, "Pioner");
    assert.equal(st.searchResults.length, 1);
    assert.equal(st.searchResults[0].id, "123-45");
    assert.equal(st.searchResults[0].name, "Pioner");
    assert.equal(st.searchResults[0].handle, "@pioner");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: stale search_result игнорируется", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const gateway = { send() {} };
    const { getState, patch } = createPatchHarness({
      searchQuery: "Other",
      searchResults: [{ id: "old" }],
      status: "",
    });

    handleServerMessage(
      { type: "search_result", query: "@pioner", results: [{ id: "123-45", online: true, friend: false }] },
      getState(),
      gateway,
      patch
    );

    const st = getState();
    assert.deepEqual(st.searchResults, [{ id: "old" }]);
  } finally {
    await cleanup();
  }
});
