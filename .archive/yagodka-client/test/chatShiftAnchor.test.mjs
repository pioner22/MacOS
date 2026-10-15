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
    if (typeof mod.captureChatShiftAnchor !== "function") throw new Error("captureChatShiftAnchor export missing");
    if (typeof mod.findChatShiftAnchorElement !== "function") throw new Error("findChatShiftAnchorElement export missing");
    return {
      captureChatShiftAnchor: mod.captureChatShiftAnchor,
      findChatShiftAnchorElement: mod.findChatShiftAnchorElement,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function rect(top, bottom) {
  return { top, bottom };
}

function msg({ key, id, top, bottom }) {
  return {
    classList: { contains: (name) => name === "msg" },
    getAttribute(name) {
      if (name === "data-msg-key") return key ?? null;
      if (name === "data-msg-id") return id == null ? null : String(id);
      return null;
    },
    getBoundingClientRect() {
      return rect(top, bottom);
    },
  };
}

test("captureChatShiftAnchor: keeps the first visible message top as the stable anchor", async () => {
  const { captureChatShiftAnchor, findChatShiftAnchorElement, cleanup } = await loadHelper();
  try {
    const first = msg({ key: "m1", id: 1, top: 120, bottom: 360 });
    const second = msg({ key: "m2", id: 2, top: 360, bottom: 520 });
    const third = msg({ key: "m3", id: 3, top: 520, bottom: 640 });
    const host = {
      scrollTop: 240,
      firstElementChild: { children: [first, second, third] },
      getBoundingClientRect() {
        return rect(100, 400);
      },
    };

    const anchor = captureChatShiftAnchor(host, "dm:123");
    assert.deepEqual(anchor, {
      key: "dm:123",
      msgKey: "m1",
      msgId: 1,
      rectTop: 120,
      scrollTop: 240,
    });
    assert.equal(findChatShiftAnchorElement(host, anchor), first);
  } finally {
    await cleanup();
  }
});

test("captureChatShiftAnchor: falls back to the first message when nothing is visible", async () => {
  const { captureChatShiftAnchor, cleanup } = await loadHelper();
  try {
    const first = msg({ key: "m1", id: 1, top: 20, bottom: 80 });
    const second = msg({ key: "m2", id: 2, top: 80, bottom: 90 });
    const host = {
      scrollTop: 0,
      firstElementChild: { children: [first, second] },
      getBoundingClientRect() {
        return rect(100, 200);
      },
    };

    const anchor = captureChatShiftAnchor(host, "dm:123");
    assert.equal(anchor?.msgKey, "m1");
    assert.equal(anchor?.rectTop, 20);
  } finally {
    await cleanup();
  }
});
