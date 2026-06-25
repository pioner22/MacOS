import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHistoryLayoutModel() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/chat/historyLayoutModel.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.resolveUnreadDivider !== "function" || typeof mod.buildHistoryLayoutBlocks !== "function") {
      throw new Error("historyLayoutModel exports missing");
    }
    return {
      resolveUnreadDivider: mod.resolveUnreadDivider,
      buildHistoryLayoutBlocks: mod.buildHistoryLayoutBlocks,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function msg(overrides = {}) {
  return {
    ts: 100,
    from: "111-111-111",
    text: "",
    kind: "in",
    ...overrides,
  };
}

function baseState(extra = {}) {
  return {
    fileTransfers: [],
    fileOffersIn: [],
    fileThumbs: {},
    friends: [],
    lastRead: {},
    selected: { kind: "dm", id: "222-222-222" },
    ...extra,
  };
}

test("historyLayoutModel: resolveUnreadDivider пропускает sys после lastRead", async () => {
  const { resolveUnreadDivider, cleanup } = await loadHistoryLayoutModel();
  try {
    const msgs = [
      msg({ id: 1, ts: 100, kind: "out", from: "self" }),
      msg({ id: 2, ts: 110, kind: "sys", from: "system", text: "joined" }),
      msg({ id: 3, ts: 120, kind: "in", from: "222-222-222", text: "hi" }),
    ];
    const resolved = resolveUnreadDivider({
      key: "dm:222-222-222",
      msgs,
      searchActive: false,
      selected: { kind: "group", id: "room-1" },
      friends: [],
      lastRead: { "dm:222-222-222": { id: 1 } },
      savedAnchor: null,
      virtualEnabled: false,
      virtualStart: 0,
    });
    assert.equal(resolved.unreadIdx, 2);
    assert.equal(resolved.unreadInsertIdx, 2);
    assert.equal(resolved.unreadCount, 1);
    assert.equal(resolved.anchor?.msgId, 3);
  } finally {
    await cleanup();
  }
});

test("historyLayoutModel: buildHistoryLayoutBlocks считает явные message boundaries", async () => {
  const { buildHistoryLayoutBlocks, cleanup } = await loadHistoryLayoutModel();
  try {
    const msgs = [
      msg({ id: 1, ts: 100, from: "a", text: "one" }),
      msg({ id: 2, ts: 120, from: "a", text: "two" }),
      msg({ id: 3, ts: 150, from: "b", text: "three" }),
    ];
    const blocks = buildHistoryLayoutBlocks({
      msgs,
      state: baseState(),
      mobileUi: false,
      boardUi: false,
      virtualStart: 0,
      virtualEnd: msgs.length,
      unreadInsertIdx: -1,
      unreadCount: 0,
    });
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["date", "message", "message", "message"]
    );
    assert.deepEqual(blocks.slice(1), [
      { kind: "message", msgIdx: 0, continues: false, tail: false },
      { kind: "message", msgIdx: 1, continues: true, tail: true },
      { kind: "message", msgIdx: 2, continues: false, tail: true },
    ]);
  } finally {
    await cleanup();
  }
});

test("historyLayoutModel: virtual slice сохраняет continuation границу", async () => {
  const { buildHistoryLayoutBlocks, cleanup } = await loadHistoryLayoutModel();
  try {
    const msgs = [
      msg({ id: 1, ts: 100, from: "a", text: "one" }),
      msg({ id: 2, ts: 110, from: "a", text: "two" }),
      msg({ id: 3, ts: 120, from: "a", text: "three" }),
    ];
    const blocks = buildHistoryLayoutBlocks({
      msgs,
      state: baseState(),
      mobileUi: false,
      boardUi: false,
      virtualStart: 1,
      virtualEnd: msgs.length,
      unreadInsertIdx: -1,
      unreadCount: 0,
    });
    assert.deepEqual(blocks, [
      { kind: "message", msgIdx: 1, continues: true, tail: false },
      { kind: "message", msgIdx: 2, continues: true, tail: true },
    ]);
  } finally {
    await cleanup();
  }
});

test("historyLayoutModel: album block собирается отдельно от separators", async () => {
  const { buildHistoryLayoutBlocks, cleanup } = await loadHistoryLayoutModel();
  try {
    const msgs = [
      msg({
        id: 1,
        ts: 100,
        from: "a",
        attachment: { kind: "file", fileId: "file-1", name: "one.jpg", size: 1000, mime: "image/jpeg" },
      }),
      msg({
        id: 2,
        ts: 120,
        from: "a",
        attachment: { kind: "file", fileId: "file-2", name: "two.jpg", size: 1000, mime: "image/jpeg" },
      }),
    ];
    const blocks = buildHistoryLayoutBlocks({
      msgs,
      state: baseState(),
      mobileUi: false,
      boardUi: false,
      virtualStart: 0,
      virtualEnd: msgs.length,
      unreadInsertIdx: 0,
      unreadCount: 2,
    });
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["date", "unread", "album"]
    );
    const album = blocks[2];
    assert.equal(album.kind, "album");
    assert.equal(album.startIdx, 0);
    assert.equal(album.endIdx, 1);
    assert.equal(album.items.length, 2);
    assert.equal(album.continues, false);
    assert.equal(album.tail, true);
  } finally {
    await cleanup();
  }
});
