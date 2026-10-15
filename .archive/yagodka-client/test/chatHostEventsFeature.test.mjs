import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadChatHostEventsFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/navigation/chatHostEventsFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.shouldIgnoreChatHostScrollSideEffects !== "function") {
      throw new Error("shouldIgnoreChatHostScrollSideEffects export missing");
    }
    return { ...mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("chatHostEventsFeature: viewer overlays do not mutate chat scroll side effects", async () => {
  const helper = await loadChatHostEventsFeature();
  try {
    assert.equal(helper.shouldIgnoreChatHostScrollSideEffects({ modal: null }), false);
    assert.equal(
      helper.shouldIgnoreChatHostScrollSideEffects({
        modal: { kind: "context_menu", payload: { target: { kind: "sidebar_tools", id: "tools" }, x: 0, y: 0 } },
      }),
      false
    );
    assert.equal(
      helper.shouldIgnoreChatHostScrollSideEffects({
        modal: { kind: "file_viewer", chatKey: "dm:u1", msgIdx: 1, fileId: "f1", openedAtMs: 1700 },
      }),
      true
    );
    assert.equal(
      helper.shouldIgnoreChatHostScrollSideEffects({
        modal: { kind: "call", callId: "c1", roomName: "Room", mode: "video", from: "u1", title: "Call" },
      }),
      true
    );
  } finally {
    await helper.cleanup();
  }
});
