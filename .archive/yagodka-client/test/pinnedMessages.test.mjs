import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadPinnedMessages() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/pinnedMessages.ts")],
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
      "togglePinnedMessage",
      "isPinnedMessage",
      "mergePinnedMessagesMaps",
      "loadPinnedMessagesForUser",
      "savePinnedMessagesForUser",
    ];
    for (const k of required) {
      if (typeof mod[k] !== "function") throw new Error(`pinnedMessages export missing: ${k}`);
    }
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("pinnedMessages: togglePinnedMessage добавляет/удаляет и двигает в начало", async () => {
  const { mod, cleanup } = await loadPinnedMessages();
  try {
    const key = "dm:123-45";
    const m0 = {};
    const m1 = mod.togglePinnedMessage(m0, key, 10);
    assert.deepEqual(m1, { [key]: [10] });
    assert.equal(mod.isPinnedMessage(m1, key, 10), true);

    const m2 = mod.togglePinnedMessage(m1, key, 20);
    assert.deepEqual(m2, { [key]: [20, 10] });

    const m3 = mod.togglePinnedMessage(m2, key, 10);
    assert.deepEqual(m3, { [key]: [20] });

    const m4 = mod.togglePinnedMessage(m3, key, 10);
    assert.deepEqual(m4, { [key]: [10, 20] });
  } finally {
    await cleanup();
  }
});

test("pinnedMessages: mergePinnedMessagesMaps объединяет без дублей (правые приоритетнее)", async () => {
  const { mod, cleanup } = await loadPinnedMessages();
  try {
    const key = "room:1";
    const a = { [key]: [1, 2, 3] };
    const b = { [key]: [3, 4] };
    assert.deepEqual(mod.mergePinnedMessagesMaps(a, b), { [key]: [3, 4, 1, 2] });
  } finally {
    await cleanup();
  }
});

test("pinnedMessages: loadPinnedMessagesForUser удаляет legacy v1 key (без миграции)", async () => {
  const { mod, cleanup } = await loadPinnedMessages();
  try {
    const userId = "123-45";
    const storage = (() => {
      const map = new Map();
      return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, v),
        removeItem: (k) => map.delete(k),
        _dump: () => new Map(map),
      };
    })();

    const legacyKey = `yagodka_pinned_messages_v1:${userId}`;
    storage.setItem(legacyKey, JSON.stringify({ v: 1, pinned: { "dm:1": 100 } }));
    const loaded = mod.loadPinnedMessagesForUser(userId, storage);
    assert.deepEqual(loaded, {});

    const v2Key = `yagodka_pinned_messages_v2:${userId}`;
    assert.equal(storage.getItem(legacyKey), null);
    assert.equal(storage.getItem(v2Key), null);

    // roundtrip: save writes v2 and keeps arrays
    const next = { "dm:1": [100, 200] };
    mod.savePinnedMessagesForUser(userId, next, storage);
    const loaded2 = mod.loadPinnedMessagesForUser(userId, storage);
    assert.deepEqual(loaded2, next);
  } finally {
    await cleanup();
  }
});
