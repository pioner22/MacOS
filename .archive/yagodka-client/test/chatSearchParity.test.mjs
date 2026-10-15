import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper(entryPoint) {
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
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("chat search: searchableMessages splits voice and music attachments", async () => {
  const { mod, cleanup } = await loadHelper("src/app/features/search/searchableMessagesFeature.ts");
  try {
    const state = {
      selected: { kind: "dm", id: "u2" },
      conversations: {
        "dm:u2": [
          {
            text: "",
            from: "u1",
            attachment: { kind: "file", name: "audio-note.ogg", mime: "audio/ogg" },
          },
          {
            text: "",
            from: "u1",
            attachment: { kind: "file", name: "audio-track.mp3", mime: "audio/mpeg" },
          },
        ],
      },
      friends: [{ id: "u1", display_name: "Alice", handle: "alice" }],
      profiles: {},
    };
    const messages = mod.searchableMessagesForSelected(state);
    assert.deepEqual(messages.map((m) => m.flags), [{ voice: true }, { music: true }]);
  } finally {
    await cleanup();
  }
});

test("chat search: counts and hits distinguish music and voice filters", async () => {
  const { mod, cleanup } = await loadHelper("src/helpers/chat/chatSearch.ts");
  try {
    const messages = [
      { attachmentName: "audio-note.ogg", senderTokens: "@alice", flags: { voice: true } },
      { attachmentName: "audio-track.mp3", senderTokens: "@alice", flags: { music: true } },
      { text: "hello", senderTokens: "@bob", flags: { links: true } },
    ];
    const counts = mod.computeChatSearchCounts(messages, "audio from:@alice");
    assert.deepEqual(counts, {
      all: 2,
      media: 0,
      files: 0,
      links: 0,
      music: 1,
      voice: 1,
    });
    assert.deepEqual(mod.computeChatSearchHits(messages, "audio from:@alice", "voice"), [0]);
    assert.deepEqual(mod.computeChatSearchHits(messages, "audio from:@alice", "music"), [1]);
  } finally {
    await cleanup();
  }
});
