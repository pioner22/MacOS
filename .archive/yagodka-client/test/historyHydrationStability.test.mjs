import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadModule(entryPoint) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entryPoint)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
      define: {
        __APP_VERSION__: JSON.stringify("0.1.899-test"),
        __ANDROID_APP_VERSION_NAME__: JSON.stringify("1.0.40"),
        __ANDROID_APP_VERSION_CODE__: "41",
      },
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [String(k), String(v)]));
  return {
    getItem(key) {
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
  };
}

test("historyCache: oversized legacy localStorage payload is dropped before parsing", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/chat/historyCache.ts");
  try {
    const key = "yagodka_chat_history_v2:517-048-184";
    const storage = makeStorage({ [key]: "{".repeat(2_450_000) });
    const result = mod.loadHistoryCacheForUser("517-048-184", storage);

    assert.deepEqual(result, {
      conversations: {},
      historyCursor: {},
      historyHasMore: {},
      historyLoaded: {},
      historySync: {},
    });
    assert.equal(storage.getItem(key), null);
  } finally {
    await cleanup();
  }
});

test("mainRenderSubscriptionFeature: first auth render is not blocked by local hydration", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const { mod, cleanup } = await loadModule("src/app/features/navigation/mainRenderSubscriptionFeature.ts");
  try {
    const rafQueue = [];
    const timerQueue = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        requestAnimationFrame(fn) {
          rafQueue.push(fn);
          return rafQueue.length;
        },
        setTimeout(fn) {
          timerQueue.push(fn);
          return timerQueue.length;
        },
      },
      configurable: true,
      writable: true,
    });

    const listeners = [];
    const state = {
      authed: true,
      selfId: "517-048-184",
      page: "main",
      modal: null,
      selected: null,
      conversations: {},
      fileTransfers: [],
      historyCursor: {},
      historyHasMore: {},
      pwaUpdateAvailable: false,
    };
    const store = {
      get() {
        return state;
      },
      subscribe(fn) {
        listeners.push(fn);
        return () => {};
      },
    };

    const events = [];
    mod.installMainRenderSubscriptionFeature({
      store,
      layout: {},
      actions: {},
      renderApp: () => events.push("render"),
      getUserLocalStateHydrationFeature: () => ({
        maybeHydrateLocalState: () => {
          events.push("hydrate");
          return true;
        },
      }),
      getChatSearchSyncFeature: () => null,
      syncNavOverlay: () => events.push("overlay"),
      getHistoryFeature: () => null,
      getVirtualHistoryFeature: () => null,
      scheduleChatJumpVisibility: () => {},
      onMembersAddModalVisible: () => {},
      closeMobileSidebar: () => {},
      mobileSidebarMq: { matches: false },
      floatingSidebarMq: { matches: false },
      isMobileSidebarOpen: () => false,
      setMobileSidebarOpen: () => {},
      isFloatingSidebarOpen: () => false,
      setFloatingSidebarOpen: () => {},
      scheduleAutoApplyPwaUpdate: () => {},
      requestHistory: () => {},
      maybeSendMessageRead: () => {},
      scheduleFocusComposer: () => {},
      previewAutoFetchFeature: {
        scheduleWarmupCachedPreviews: () => {},
        scheduleAutoFetchVisiblePreviews: () => {},
      },
      scheduleHistoryWarmup: () => {},
      maybeAutoFillHistoryViewport: () => {},
      maybeAutoRetryHistory: () => {},
      convoSig: () => "",
    });

    listeners[0]();
    assert.deepEqual(events, ["render", "overlay"]);

    assert.equal(rafQueue.length, 1);
    rafQueue.shift()();
    assert.equal(timerQueue.length, 1);
    timerQueue.shift()();
    assert.deepEqual(events, ["render", "overlay", "hydrate"]);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    await cleanup();
  }
});
