import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadChatSearch() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/chatSearch.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.computeChatSearchHits !== "function" || typeof mod.stepChatSearchPos !== "function" || typeof mod.clampChatSearchPos !== "function") {
      throw new Error("chatSearch exports missing");
    }
    return {
      computeChatSearchHits: mod.computeChatSearchHits,
      clampChatSearchPos: mod.clampChatSearchPos,
      stepChatSearchPos: mod.stepChatSearchPos,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("chatSearch: находит совпадения по тексту и имени вложения", async () => {
  const { computeChatSearchHits, cleanup } = await loadChatSearch();
  try {
    const msgs = [
      { text: "Привет мир" },
      { text: "photo", attachmentName: "cat.png" },
      { text: "ничего" },
    ];
    assert.deepEqual(computeChatSearchHits(msgs, "привет"), [0]);
    assert.deepEqual(computeChatSearchHits(msgs, "CAT"), [1]);
    assert.deepEqual(computeChatSearchHits(msgs, " "), []);
  } finally {
    await cleanup();
  }
});

test("chatSearch: stepChatSearchPos циклично переключает", async () => {
  const { stepChatSearchPos, clampChatSearchPos, cleanup } = await loadChatSearch();
  try {
    const hits = [2, 5, 9];
    assert.equal(clampChatSearchPos(hits, -1), 0);
    assert.equal(clampChatSearchPos(hits, 100), 2);
    assert.equal(stepChatSearchPos(hits, 0, 1), 1);
    assert.equal(stepChatSearchPos(hits, 2, 1), 0);
    assert.equal(stepChatSearchPos(hits, 0, -1), 2);
  } finally {
    await cleanup();
  }
});

test("chatSearch: поддерживает from:/# фильтры", async () => {
  const { computeChatSearchHits, cleanup } = await loadChatSearch();
  try {
    const msgs = [
      { text: "Привет #тег", senderTokens: "alice @alice" },
      { text: "Привет", senderTokens: "bob @bob" },
      { text: "Другой #тег", senderTokens: "bob @bob" },
    ];
    assert.deepEqual(computeChatSearchHits(msgs, "from:@bob"), [1, 2]);
    assert.deepEqual(computeChatSearchHits(msgs, "#тег"), [0, 2]);
    assert.deepEqual(computeChatSearchHits(msgs, "#тег from:@bob"), [2]);
  } finally {
    await cleanup();
  }
});
