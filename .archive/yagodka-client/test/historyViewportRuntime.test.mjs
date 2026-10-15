import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/historyViewportRuntime.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.getChatHistoryViewportRuntime !== "function") throw new Error("getChatHistoryViewportRuntime export missing");
    if (typeof mod.captureAndStoreChatShiftAnchor !== "function") throw new Error("captureAndStoreChatShiftAnchor export missing");
    if (typeof mod.captureAndStoreViewerReturnAnchor !== "function") throw new Error("captureAndStoreViewerReturnAnchor export missing");
    if (typeof mod.markChatPendingBottomStick !== "function") throw new Error("markChatPendingBottomStick export missing");
    if (typeof mod.isChatPendingBottomStickActive !== "function") throw new Error("isChatPendingBottomStickActive export missing");
    if (typeof mod.clearChatPendingBottomStick !== "function") throw new Error("clearChatPendingBottomStick export missing");
    if (typeof mod.resetChatHistoryViewportRuntime !== "function") throw new Error("resetChatHistoryViewportRuntime export missing");
    return {
      getChatHistoryViewportRuntime: mod.getChatHistoryViewportRuntime,
      captureAndStoreChatShiftAnchor: mod.captureAndStoreChatShiftAnchor,
      captureAndStoreViewerReturnAnchor: mod.captureAndStoreViewerReturnAnchor,
      markChatPendingBottomStick: mod.markChatPendingBottomStick,
      isChatPendingBottomStickActive: mod.isChatPendingBottomStickActive,
      clearChatPendingBottomStick: mod.clearChatPendingBottomStick,
      resetChatHistoryViewportRuntime: mod.resetChatHistoryViewportRuntime,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function createMsgNode(id, top, bottom) {
  return {
    classList: { contains: (name) => name === "msg" },
    getBoundingClientRect: () => ({ top, bottom }),
    getAttribute(name) {
      if (name === "data-msg-key") return `msg:${id}`;
      if (name === "data-msg-id") return String(id);
      return null;
    },
  };
}

test("historyViewportRuntime: keeps one shared runtime per host and stores captured shift anchor", async () => {
  const { getChatHistoryViewportRuntime, captureAndStoreChatShiftAnchor, cleanup } = await loadHelper();
  try {
    const first = createMsgNode(101, 24, 84);
    const second = createMsgNode(102, 92, 152);
    const host = {
      scrollTop: 320,
      firstElementChild: { children: [first, second] },
      getBoundingClientRect: () => ({ top: 0, bottom: 200 }),
    };

    const runtime = getChatHistoryViewportRuntime(host);
    runtime.virtualAvgHeights.set("dm:123", 88);
    runtime.unreadClearArmed.add("dm:123");

    const anchor = captureAndStoreChatShiftAnchor(host, "dm:123");
    const runtimeAgain = getChatHistoryViewportRuntime(host);

    assert.equal(runtimeAgain, runtime);
    assert.equal(runtimeAgain.virtualAvgHeights.get("dm:123"), 88);
    assert.equal(runtimeAgain.unreadClearArmed.has("dm:123"), true);
    assert.deepEqual(anchor, {
      key: "dm:123",
      msgKey: "msg:101",
      msgId: 101,
      rectTop: 24,
      scrollTop: 320,
    });
    assert.equal(runtimeAgain.shiftAnchor, anchor);
  } finally {
    await cleanup();
  }
});

test("historyViewportRuntime: stores a separate viewer return anchor", async () => {
  const { getChatHistoryViewportRuntime, captureAndStoreViewerReturnAnchor, cleanup } = await loadHelper();
  try {
    const first = createMsgNode(201, 34, 94);
    const host = {
      scrollTop: 640,
      firstElementChild: { children: [first] },
      getBoundingClientRect: () => ({ top: 0, bottom: 220 }),
    };

    const anchor = captureAndStoreViewerReturnAnchor(host, "dm:viewer");
    const runtime = getChatHistoryViewportRuntime(host);

    assert.deepEqual(anchor, {
      key: "dm:viewer",
      msgKey: "msg:201",
      msgId: 201,
      rectTop: 34,
      scrollTop: 640,
    });
    assert.equal(runtime.viewerReturnAnchor, anchor);
    assert.equal(runtime.shiftAnchor, null);
  } finally {
    await cleanup();
  }
});

test("historyViewportRuntime: pending bottom stick is scoped, expires, and can be cleared", async () => {
  const {
    getChatHistoryViewportRuntime,
    markChatPendingBottomStick,
    isChatPendingBottomStickActive,
    clearChatPendingBottomStick,
    cleanup,
  } = await loadHelper();
  try {
    const host = {};
    const key = "dm:456-356-735";

    assert.equal(isChatPendingBottomStickActive(host, key, 1000), false);
    assert.equal(markChatPendingBottomStick(host, key, 1000, 500), true);
    assert.equal(isChatPendingBottomStickActive(host, key, 1200), true);
    assert.equal(isChatPendingBottomStickActive(host, "dm:517-048-184", 1200), false);
    assert.equal(isChatPendingBottomStickActive(host, key, 1501), false);
    assert.equal(getChatHistoryViewportRuntime(host).pendingBottomStickKey, null);

    assert.equal(markChatPendingBottomStick(host, key, 2000, 500), true);
    clearChatPendingBottomStick(host, "dm:517-048-184");
    assert.equal(isChatPendingBottomStickActive(host, key, 2100), true);
    clearChatPendingBottomStick(host, key);
    assert.equal(isChatPendingBottomStickActive(host, key, 2100), false);
  } finally {
    await cleanup();
  }
});

test("historyViewportRuntime: reset clears sticky/anchor state and disconnects observer", async () => {
  const { getChatHistoryViewportRuntime, resetChatHistoryViewportRuntime, cleanup } = await loadHelper();
  try {
    const host = { scrollTop: 0, firstElementChild: null };
    const runtime = getChatHistoryViewportRuntime(host);
    let disconnectCount = 0;
    runtime.stickyBottom = { key: "dm:123", active: true, at: 1000, scrollTop: 480 };
    runtime.pendingBottomStickKey = "dm:123";
    runtime.pendingBottomStickUntil = 2000;
    runtime.shiftAnchor = { key: "dm:123", msgKey: "msg:101", msgId: 101, rectTop: 40, scrollTop: 480 };
    runtime.viewerReturnAnchor = { key: "dm:123", msgKey: "msg:102", msgId: 102, rectTop: 80, scrollTop: 560 };
    runtime.compensatedAt = 123456;
    runtime.virtualAvgHeights.set("dm:123", 92);
    runtime.unreadAnchors.set("dm:123", { msgKey: "msg:101", msgId: 101 });
    runtime.unreadClearArmed.add("dm:123");
    runtime.linesObserved = { tagName: "DIV" };
    runtime.linesObserver = {
      disconnect() {
        disconnectCount += 1;
      },
    };

    resetChatHistoryViewportRuntime(host);

    assert.equal(disconnectCount, 1);
    assert.equal(runtime.stickyBottom, null);
    assert.equal(runtime.pendingBottomStickKey, null);
    assert.equal(runtime.pendingBottomStickUntil, 0);
    assert.equal(runtime.shiftAnchor, null);
    assert.equal(runtime.viewerReturnAnchor, null);
    assert.equal(runtime.compensatedAt, 0);
    assert.equal(runtime.virtualAvgHeights.size, 0);
    assert.equal(runtime.unreadAnchors.size, 0);
    assert.equal(runtime.unreadClearArmed.size, 0);
    assert.equal(runtime.linesObserver, null);
    assert.equal(runtime.linesObserved, null);
    assert.equal(runtime.linesObserverRaf, null);
  } finally {
    await cleanup();
  }
});

test("history autoscroll: sent-message pending bottom stick is wired into render path", async () => {
  const [renderChatSrc, historyFeatureSrc, mountAppSrc, modalCloseSrc] = await Promise.all([
    readFile(path.resolve("src/components/chat/renderChat.ts"), "utf8"),
    readFile(path.resolve("src/app/features/history/historyFeature.ts"), "utf8"),
    readFile(path.resolve("src/app/mountApp.ts"), "utf8"),
    readFile(path.resolve("src/app/features/navigation/modalCloseFeature.ts"), "utf8"),
  ]);

  assert.match(renderChatSrc, /isChatPendingBottomStickActive\(scrollHost,\s*key\)/);
  assert.match(renderChatSrc, /stickyActive\s*\|\|\s*atBottomBefore\s*\|\|\s*pendingBottomStickActive/);
  assert.match(renderChatSrc, /tailMessageAppended/);
  assert.match(renderChatSrc, /markChatPendingBottomStick\(scrollHost,\s*key,\s*Date\.now\(\),\s*2500\)/);
  assert.match(renderChatSrc, /window\.setTimeout\(stickNow,\s*260\)/);
  assert.match(renderChatSrc, /clearChatPendingBottomStick\(scrollHost,\s*key\)/);
  assert.match(renderChatSrc, /viewerReturnAnchor/);
  assert.match(renderChatSrc, /!viewerReturnAnchor\s*&&\s*allowSticky/);
  assert.match(renderChatSrc, /isChatPendingBottomStickActive\(scrollHost,\s*curKey\)\s*\|\|\s*isChatStickyBottomActive/);
  assert.match(historyFeatureSrc, /markChatPendingBottomStick\(chatHost,\s*k\)/);
  assert.match(mountAppSrc, /markChatPendingBottomStick\(host,\s*k\)/);
  assert.match(mountAppSrc, /isChatPendingBottomStickActive\(host,\s*k\)/);
  assert.match(mountAppSrc, /window\.setTimeout\(stickNow,\s*260\)/);
  assert.match(mountAppSrc, /chatHost:\s*layout\.chatHost/);
  assert.match(modalCloseSrc, /closeFileViewerState/);
  assert.match(modalCloseSrc, /captureAndStoreViewerReturnAnchor/);
  assert.match(modalCloseSrc, /isChatHostNearBottom\(chatHost,\s*32\)/);
  assert.match(modalCloseSrc, /delete historyVirtualStart\[key\]/);
  assert.match(modalCloseSrc, /markChatPendingBottomStick\(chatHost,\s*key,\s*Date\.now\(\),\s*2500\)/);
});

test("history autoscroll: sendChat hard-scrolls after local message insert", async () => {
  const [sendChatSrc, mountAppSrc] = await Promise.all([
    readFile(path.resolve("src/app/features/navigation/sendChatFeature.ts"), "utf8"),
    readFile(path.resolve("src/app/mountApp.ts"), "utf8"),
  ]);

  assert.match(sendChatSrc, /scrollChatToBottom\?:\s*\(key:\s*string\)\s*=>\s*void/);
  assert.match(sendChatSrc, /scheduleSaveOutbox\(\);\s*markChatAutoScroll\(convKey,\s*false\);\s*scrollChatToBottom\?\.\(convKey\);/s);
  assert.match(mountAppSrc, /createSendChatFeature\(\{[\s\S]*markChatAutoScroll,\s*scrollChatToBottom,/);
});
