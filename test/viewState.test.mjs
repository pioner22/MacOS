import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadViewState() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/navigation/viewState.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return {
      ...mod,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("viewState: applyRestartNavigationState восстанавливает selected и page-view из snapshot", async () => {
  const helper = await loadViewState();
  try {
    const base = {
      page: "main",
      selected: null,
      rightPanel: { kind: "dm", id: "stale" },
      userViewId: null,
      groupViewId: "old-group",
      boardViewId: null,
    };
    const next = helper.applyRestartNavigationState(base, {
      page: "user",
      selected: { kind: "dm", id: "222-222-222" },
      userViewId: null,
      groupViewId: "ignored-group",
    });
    assert.equal(next.page, "user");
    assert.deepEqual(next.selected, { kind: "dm", id: "222-222-222" });
    assert.equal(next.userViewId, "222-222-222");
    assert.equal(next.groupViewId, null);
    assert.equal(next.boardViewId, null);
    assert.equal(next.rightPanel, null);
  } finally {
    await helper.cleanup();
  }
});

test("viewState: resetNavigationState очищает selected, rightPanel и page-view ids", async () => {
  const helper = await loadViewState();
  try {
    const next = helper.resetNavigationState(
      {
        page: "group",
        selected: { kind: "group", id: "g-1" },
        rightPanel: { kind: "group", id: "g-1" },
        userViewId: "u-1",
        groupViewId: "g-1",
        boardViewId: "b-1",
      },
      { page: "main" }
    );
    assert.equal(next.page, "main");
    assert.equal(next.selected, null);
    assert.equal(next.rightPanel, null);
    assert.equal(next.userViewId, null);
    assert.equal(next.groupViewId, null);
    assert.equal(next.boardViewId, null);
  } finally {
    await helper.cleanup();
  }
});
