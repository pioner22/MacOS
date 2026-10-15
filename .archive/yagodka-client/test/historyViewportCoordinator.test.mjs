import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/historyViewportCoordinator.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    const required = [
      "shiftVirtualStartForPrepend",
      "resolveVirtualStartForIndex",
      "resolveVirtualStartForScroll",
      "markHistoryViewportCompensation",
      "historyViewportRecentlyCompensated",
    ];
    for (const key of required) {
      if (typeof mod[key] !== "function") throw new Error(`historyViewportCoordinator export missing: ${key}`);
    }
    return {
      shiftVirtualStartForPrepend: mod.shiftVirtualStartForPrepend,
      resolveVirtualStartForIndex: mod.resolveVirtualStartForIndex,
      resolveVirtualStartForScroll: mod.resolveVirtualStartForScroll,
      markHistoryViewportCompensation: mod.markHistoryViewportCompensation,
      historyViewportRecentlyCompensated: mod.historyViewportRecentlyCompensated,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

test("historyViewportCoordinator: shared virtual-start math is deterministic", async () => {
  const helper = await loadHelpers();
  try {
    assert.equal(helper.shiftVirtualStartForPrepend(25, 3), 28);
    assert.equal(helper.shiftVirtualStartForPrepend(25, 0), 25);
    assert.equal(helper.shiftVirtualStartForPrepend(null, 5), null);
    assert.equal(helper.resolveVirtualStartForIndex(500, 100, 160), 20);
    assert.deepEqual(
      helper.resolveVirtualStartForScroll({
        msgsLength: 500,
        currentStart: 20,
        scrollTop: 1200,
        avgHint: 48,
        overscan: 60,
        windowSize: 200,
        stickToBottom: false,
      }),
      { currentStart: 20, targetStart: 0, changed: true }
    );
    assert.deepEqual(
      helper.resolveVirtualStartForScroll({
        msgsLength: 500,
        currentStart: 40,
        scrollTop: 1200,
        avgHint: 48,
        overscan: 60,
        windowSize: 200,
        stickToBottom: true,
      }),
      { currentStart: 40, targetStart: 300, changed: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("historyViewportCoordinator: compensated scroll is visible to history policy", async () => {
  const helper = await loadHelpers();
  try {
    const host = {};
    assert.equal(helper.historyViewportRecentlyCompensated(host, 350, 1000), false);
    const now = Date.now();
    helper.markHistoryViewportCompensation(host);
    assert.equal(helper.historyViewportRecentlyCompensated(host, 350, now + 50), true);
    assert.equal(helper.historyViewportRecentlyCompensated(host, 350, now + 500), false);
  } finally {
    await helper.cleanup();
  }
});

test("history viewport source guards: coordinator owns virtual-start math and historyFeature no longer compensates prepends directly", async () => {
  const [coordinatorSrc, historyFeatureSrc, historyServerSrc, virtualFeatureSrc, mainRenderSrc, renderChatSrc, ctxMenuSrc, chatSurfaceSrc] =
    await Promise.all([
      readFile(path.resolve("src/helpers/chat/historyViewportCoordinator.ts"), "utf8"),
      readFile(path.resolve("src/app/features/history/historyFeature.ts"), "utf8"),
      readFile(path.resolve("src/app/handleServerMessage/history.ts"), "utf8"),
      readFile(path.resolve("src/app/features/history/virtualHistoryFeature.ts"), "utf8"),
      readFile(path.resolve("src/app/features/navigation/mainRenderSubscriptionFeature.ts"), "utf8"),
      readFile(path.resolve("src/components/chat/renderChat.ts"), "utf8"),
      readFile(path.resolve("src/app/features/contextMenu/contextMenuActionsFeature.ts"), "utf8"),
      readFile(path.resolve("src/app/features/navigation/chatSurfaceDeferredActions.ts"), "utf8"),
    ]);

  assert.match(coordinatorSrc, /shiftVirtualStartForPrepend/);
  assert.match(historyServerSrc, /shiftVirtualStartForPrepend/);
  assert.match(historyFeatureSrc, /shiftVirtualStartForPrepend/);
  assert.match(virtualFeatureSrc, /resolveVirtualStartForScroll/);
  assert.match(virtualFeatureSrc, /resolveVirtualStartForIndex/);
  assert.match(ctxMenuSrc, /resolveVirtualStartForIndex/);
  assert.match(chatSurfaceSrc, /resolveVirtualStartForIndex/);
  assert.match(renderChatSrc, /markHistoryViewportCompensation/);
  assert.doesNotMatch(historyFeatureSrc, /historyPrependAnchor/);
  assert.doesNotMatch(mainRenderSrc, /applyPrependAnchorAfterRender/);
});
