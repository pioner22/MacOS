import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHistorySync() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/historySync.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.newestServerMessageId !== "function") {
      throw new Error("newestServerMessageId export missing");
    }
    return {
      newestServerMessageId: mod.newestServerMessageId,
      getConversationHistorySyncState: mod.getConversationHistorySyncState,
      applyConversationHistorySyncState: mod.applyConversationHistorySyncState,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("historySync: newestServerMessageId игнорирует локальные/пустые id и берёт максимум", async () => {
  const { newestServerMessageId, cleanup } = await loadHistorySync();
  try {
    assert.equal(newestServerMessageId([]), null);
    assert.equal(
      newestServerMessageId([
        { kind: "out", from: "me", text: "x", ts: 1, id: -1 },
        { kind: "in", from: "a", text: "y", ts: 2, id: null },
        { kind: "in", from: "a", text: "z", ts: 3, id: 10 },
        { kind: "in", from: "a", text: "q", ts: 4, id: 7 },
      ]),
      10
    );
  } finally {
    await cleanup();
  }
});

test("historySync: absent virtualStart не превращается в top-window, но явный 0 сохраняется", async () => {
  const { getConversationHistorySyncState, applyConversationHistorySyncState, cleanup } = await loadHistorySync();
  try {
    const key = "dm:peer-1";
    let state = {
      historySync: {},
      historyLoaded: {},
      historyPreviewOnly: {},
      historyCursor: {},
      historyHasMore: {},
      historyLoading: {},
      historyLoadingSlots: {},
      historyVirtualStart: {},
    };

    state = applyConversationHistorySyncState(state, key, { loaded: true, loading: false });
    assert.equal(
      Object.prototype.hasOwnProperty.call(state.historyVirtualStart, key),
      false,
      "loading/loaded updates must not persist virtualStart=0 implicitly"
    );

    state = applyConversationHistorySyncState(state, key, { virtualStart: 0 });
    assert.equal(Object.prototype.hasOwnProperty.call(state.historyVirtualStart, key), true);
    assert.equal(state.historyVirtualStart[key], 0);
    assert.equal(getConversationHistorySyncState(state, key).virtualStart, 0);

    state = applyConversationHistorySyncState(state, key, { loading: false });
    assert.equal(state.historyVirtualStart[key], 0, "explicit top virtual window must survive later sync patches");
  } finally {
    await cleanup();
  }
});

test("historySync: emptyNotice нормализуется, сохраняется и очищается явным null", async () => {
  const { getConversationHistorySyncState, applyConversationHistorySyncState, cleanup } = await loadHistorySync();
  try {
    const key = "dm:peer-1";
    let state = {
      historySync: {},
      historyLoaded: {},
      historyPreviewOnly: {},
      historyCursor: {},
      historyHasMore: {},
      historyLoading: {},
      historyLoadingSlots: {},
      historyVirtualStart: {},
    };

    state = applyConversationHistorySyncState(state, key, {
      loaded: true,
      emptyNotice: {
        kind: "cleared",
        scope: "dm",
        by: "peer-1",
        at: 123,
        deleted: 2,
      },
    });

    let sync = getConversationHistorySyncState(state, key);
    assert.equal(sync.emptyNotice.kind, "cleared");
    assert.equal(sync.emptyNotice.scope, "dm");
    assert.equal(sync.emptyNotice.by, "peer-1");
    assert.equal(sync.emptyNotice.deleted, 2);

    state = applyConversationHistorySyncState(state, key, { loading: false });
    sync = getConversationHistorySyncState(state, key);
    assert.equal(sync.emptyNotice.by, "peer-1");

    state = applyConversationHistorySyncState(state, key, { emptyNotice: null });
    assert.equal(getConversationHistorySyncState(state, key).emptyNotice, null);
  } finally {
    await cleanup();
  }
});

test("historySync: mixed historySync и legacy maps читаются по live legacy flags, а не по stale raw snapshot", async () => {
  const { getConversationHistorySyncState, cleanup } = await loadHistorySync();
  try {
    const state = {
      historySync: {
        "dm:peer-1": {
          loaded: true,
          previewOnly: true,
          cursor: 99,
          hasMore: true,
          loading: true,
          loadingSlots: 5,
          virtualStart: 7,
          source: "cache",
          reconcilePending: true,
          lastServerAt: null,
        },
      },
      historyLoaded: { "dm:peer-1": true },
      historyPreviewOnly: {},
      historyCursor: { "dm:peer-1": 42 },
      historyHasMore: { "dm:peer-1": false },
      historyLoading: {},
      historyLoadingSlots: {},
      historyVirtualStart: {},
    };
    const sync = getConversationHistorySyncState(state, "dm:peer-1");
    assert.equal(sync.loaded, true);
    assert.equal(sync.previewOnly, false);
    assert.equal(sync.cursor, 42);
    assert.equal(sync.hasMore, false);
    assert.equal(sync.loading, false);
    assert.equal(sync.loadingSlots, 0);
    assert.equal(sync.virtualStart, 0);
    assert.equal(sync.source, "cache");
    assert.equal(sync.reconcilePending, true);
  } finally {
    await cleanup();
  }
});
