import test from "node:test";
import assert from "node:assert/strict";
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
      entryPoints: [path.resolve("src/components/chat/renderChatHelpers.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.getFileAttachmentInfo !== "function") {
      throw new Error("getFileAttachmentInfo export missing");
    }
    return { getFileAttachmentInfo: mod.getFileAttachmentInfo, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("renderChatHelpers: preview-only history does not trust stale network media urls", async () => {
  const { getFileAttachmentInfo, cleanup } = await loadHelpers();
  const prevLocation = globalThis.location;
  globalThis.location = { href: "https://yagodka.org/web/" };
  try {
    const state = {
      selfId: "111-111-111",
      selected: { kind: "dm", id: "222-222-222" },
      historyPreviewOnly: { "dm:222-222-222": true },
      fileOffersIn: [],
      fileTransfers: [
        {
          localId: "ft-1",
          id: "f-1",
          name: "ghost.jpg",
          size: 123,
          mime: "image/jpeg",
          direction: "in",
          peer: "222-222-222",
          room: null,
          status: "complete",
          progress: 100,
          url: "https://yagodka.org/files/f-1",
        },
      ],
      fileThumbs: {
        "f-1": { url: "https://yagodka.org/files/thumb/f-1", mime: "image/jpeg", ts: 1 },
      },
    };
    const msg = {
      kind: "in",
      from: "222-222-222",
      to: "111-111-111",
      text: "[file] ghost.jpg",
      ts: 1,
      id: 10,
      attachment: { kind: "file", fileId: "f-1", name: "ghost.jpg", size: 123, mime: "image/jpeg" },
    };

    const info = getFileAttachmentInfo(state, msg);
    assert.ok(info);
    assert.equal(info.url, null);
    assert.equal(info.thumbUrl, null);
  } finally {
    if (prevLocation === undefined) delete globalThis.location;
    else globalThis.location = prevLocation;
    await cleanup();
  }
});

test("renderChatHelpers: preview-only history still trusts blob media urls", async () => {
  const { getFileAttachmentInfo, cleanup } = await loadHelpers();
  const prevLocation = globalThis.location;
  globalThis.location = { href: "https://yagodka.org/web/" };
  try {
    const state = {
      selfId: "111-111-111",
      selected: { kind: "dm", id: "222-222-222" },
      historyPreviewOnly: { "dm:222-222-222": true },
      fileOffersIn: [],
      fileTransfers: [
        {
          localId: "ft-1",
          id: "f-1",
          name: "live.jpg",
          size: 123,
          mime: "image/jpeg",
          direction: "in",
          peer: "222-222-222",
          room: null,
          status: "complete",
          progress: 100,
          url: "blob:live",
        },
      ],
      fileThumbs: {
        "f-1": { url: "blob:thumb-live", mime: "image/jpeg", ts: 1 },
      },
    };
    const msg = {
      kind: "in",
      from: "222-222-222",
      to: "111-111-111",
      text: "[file] live.jpg",
      ts: 1,
      id: 10,
      attachment: { kind: "file", fileId: "f-1", name: "live.jpg", size: 123, mime: "image/jpeg" },
    };

    const info = getFileAttachmentInfo(state, msg);
    assert.ok(info);
    assert.equal(info.url, "blob:live");
    assert.equal(info.thumbUrl, "blob:thumb-live");
  } finally {
    if (prevLocation === undefined) delete globalThis.location;
    else globalThis.location = prevLocation;
    await cleanup();
  }
});
