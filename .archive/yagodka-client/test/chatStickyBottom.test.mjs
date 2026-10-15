import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/stickyBottom.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createChatStickyBottomState !== "function") {
      throw new Error("createChatStickyBottomState export missing");
    }
    if (typeof mod.isChatStickyBottomActive !== "function") {
      throw new Error("isChatStickyBottomActive export missing");
    }
    return {
      createChatStickyBottomState: mod.createChatStickyBottomState,
      isChatStickyBottomActive: mod.isChatStickyBottomActive,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("stickyBottom: active state stays valid while host still sits on recorded bottom position", async () => {
  const { createChatStickyBottomState, isChatStickyBottomActive, cleanup } = await loadHelper();
  try {
    const host = {
      scrollTop: 880,
      scrollHeight: 1280,
      clientHeight: 400,
      getAttribute(name) {
        return name === "data-chat-key" ? "dm:456-356-735" : null;
      },
    };
    const state = createChatStickyBottomState(host, "dm:456-356-735", true, 1000);
    host.scrollHeight = 1540;
    assert.equal(isChatStickyBottomActive(host, state, "dm:456-356-735"), true);
  } finally {
    await cleanup();
  }
});

test("stickyBottom: stale active state is ignored after host has moved away from recorded bottom", async () => {
  const { isChatStickyBottomActive, cleanup } = await loadHelper();
  try {
    const host = {
      scrollTop: 360,
      scrollHeight: 1540,
      clientHeight: 400,
      getAttribute(name) {
        return name === "data-chat-key" ? "dm:456-356-735" : null;
      },
    };
    const state = { key: "dm:456-356-735", active: true, at: 1000, scrollTop: 880 };
    assert.equal(isChatStickyBottomActive(host, state, "dm:456-356-735"), false);
  } finally {
    await cleanup();
  }
});
