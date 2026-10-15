import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadMainConversationState() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/navigation/mainConversationState.ts")],
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

test("mainConversationState: active selection only exists on main surface without modal", async () => {
  const helper = await loadMainConversationState();
  try {
    const active = helper.getActiveConversationTarget({
      page: "main",
      modal: null,
      selected: { kind: "group", id: "g-1" },
    });
    assert.deepEqual(active, { kind: "group", id: "g-1" });
    assert.equal(helper.hasActiveConversationSelection({ page: "main", modal: null, selected: { kind: "dm", id: "u-1" } }), true);
    assert.equal(helper.hasActiveConversationSelection({ page: "main", modal: { kind: "auth" }, selected: { kind: "dm", id: "u-1" } }), false);
    assert.equal(helper.isMainConversationSurface({ page: "main", modal: null }), true);
    assert.equal(helper.isMainConversationSurface({ page: "files", modal: null }), false);
    assert.equal(
      helper.hasActiveConversationSelection({
        page: "main",
        modal: { kind: "file_viewer", chatKey: "dm:u-1", msgIdx: 0, fileId: "f-1", openedAtMs: 1000 },
        selected: { kind: "dm", id: "u-1" },
      }),
      false
    );
    assert.equal(
      helper.hasConversationViewportSelection({
        page: "main",
        modal: { kind: "context_menu", payload: { target: { kind: "sidebar_tools", id: "tools" }, x: 0, y: 0 } },
        selected: { kind: "dm", id: "u-1" },
      }),
      true
    );
    assert.deepEqual(
      helper.getConversationViewportTarget({
        page: "main",
        modal: { kind: "context_menu", payload: { target: { kind: "sidebar_tools", id: "tools" }, x: 0, y: 0 } },
        selected: { kind: "group", id: "g-1" },
      }),
      { kind: "group", id: "g-1" }
    );
    assert.deepEqual(
      helper.getConversationViewportTarget({
        page: "main",
        modal: { kind: "file_viewer", chatKey: "dm:u-1", msgIdx: 0, fileId: "f-1", openedAtMs: 1000 },
        selected: { kind: "dm", id: "u-1" },
      }),
      { kind: "dm", id: "u-1" }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mainConversationState: peer and room checks share one canonical matcher", async () => {
  const helper = await loadMainConversationState();
  try {
    const dmState = { page: "main", modal: null, selected: { kind: "dm", id: "u-1" } };
    const roomState = { page: "main", modal: null, selected: { kind: "board", id: "b-1" } };
    assert.equal(helper.isViewingDmPeer(dmState, "u-1"), true);
    assert.equal(helper.isViewingDmPeer(dmState, "u-2"), false);
    assert.equal(helper.isViewingRoomId(roomState, "b-1"), true);
    assert.equal(helper.isViewingRoomId(roomState, "g-1"), false);
    assert.equal(helper.isActiveConversationTarget(roomState, { kind: "board", id: "b-1" }), true);
    assert.equal(helper.isActiveConversationTarget(roomState, { kind: "group", id: "b-1" }), false);
  } finally {
    await helper.cleanup();
  }
});
