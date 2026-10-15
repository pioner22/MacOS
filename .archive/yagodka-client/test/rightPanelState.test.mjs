import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRightPanelState() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/navigation/rightPanelState.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { ...mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("rightPanelState: visibility, title and selected-link derive from one helper", async () => {
  const helper = await loadRightPanelState();
  try {
    const state = {
      page: "main",
      selected: { kind: "group", id: "g-1" },
      rightPanel: { kind: "group", id: "g-1" },
      userViewId: null,
      groupViewId: null,
      boardViewId: null,
    };
    assert.equal(helper.getRightPanelTitle(state.rightPanel), "Чат");
    assert.equal(helper.isRightPanelActiveForSelected(state), true);
    assert.equal(helper.shouldShowRightPanel(state, { fullScreenActive: false, mobileUi: false }), true);
    assert.equal(helper.shouldShowRightPanel(state, { fullScreenActive: true, mobileUi: false }), false);
    assert.equal(
      helper.shouldShowRightPanelOverlay({ ...state, modal: null }, { overlayMatches: true, mobileUi: false }),
      true
    );
    assert.equal(
      helper.shouldShowRightPanelOverlay({ ...state, modal: { kind: "auth" } }, { overlayMatches: true, mobileUi: false }),
      false
    );
  } finally {
    await helper.cleanup();
  }
});

test("rightPanelState: selected sync and view patch stay canonical", async () => {
  const helper = await loadRightPanelState();
  try {
    const synced = helper.syncRightPanelWithSelected(
      { rightPanel: { kind: "dm", id: "old" } },
      { kind: "board", id: "b-1" }
    );
    assert.deepEqual(synced, { kind: "board", id: "b-1" });

    const next = helper.applyRightPanelViewState(
      {
        page: "main",
        rightPanel: { kind: "dm", id: "u-1" },
        userViewId: null,
        groupViewId: "stale-group",
        boardViewId: "stale-board",
      },
      { kind: "dm", id: "u-1" }
    );
    assert.equal(next.userViewId, "u-1");
    assert.equal(next.groupViewId, null);
    assert.equal(next.boardViewId, null);
  } finally {
    await helper.cleanup();
  }
});
