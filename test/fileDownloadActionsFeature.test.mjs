import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/files/fileDownloadActionsFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createFileDownloadActionsFeature !== "function") {
      throw new Error("createFileDownloadActionsFeature export missing");
    }
    return {
      createFileDownloadActionsFeature: mod.createFileDownloadActionsFeature,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("fileDownloadActionsFeature: download fallback opens a new context instead of navigating current PWA shell", async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevCustomEvent = globalThis.CustomEvent;
  const helper = await loadFeature();
  try {
    const opened = [];
    const statuses = [];
    class CustomEventStub extends Event {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    globalThis.CustomEvent = CustomEventStub;
    globalThis.document = {
      createElement() {
        throw new Error("anchor_unavailable");
      },
      body: {
        appendChild() {},
      },
    };
    globalThis.window = {
      open(url, target, features) {
        opened.push({ url: String(url), target: String(target), features: String(features) });
        return {};
      },
      setTimeout() {
        return 1;
      },
      dispatchEvent() {
        return true;
      },
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      location: { href: "https://yagodka.org/web/" },
    };

    const feature = helper.createFileDownloadActionsFeature({
      store: {
        get() {
          return {
            fileTransfers: [],
            fileOffersIn: [],
            conversations: {},
            selected: null,
            selfId: "111",
          };
        },
        set(patch) {
          if (patch && typeof patch === "object" && typeof patch.status === "string") statuses.push(patch.status);
        },
      },
      downloadByFileId: new Map(),
      enqueueFileGet() {},
      scheduleSaveFileTransfers() {},
    });

    feature.triggerBrowserDownload("blob:test", "photo.jpg");
    assert.deepEqual(opened, [{ url: "blob:test", target: "_blank", features: "noopener,noreferrer" }]);
    assert.deepEqual(statuses, []);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    if (prevCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = prevCustomEvent;
    await helper.cleanup();
  }
});

test("fileDownloadActionsFeature: beginViewerStream prepares inline PWA stream and starts file_get only after stream ready", async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNavigator = globalThis.navigator;
  const prevCustomEvent = globalThis.CustomEvent;
  const helper = await loadFeature();
  try {
    const enqueued = [];
    const statuses = [];
    class CustomEventStub extends Event {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    globalThis.CustomEvent = CustomEventStub;
    globalThis.document = {
      createElement() {
        return {
          style: {},
          click() {},
          remove() {},
        };
      },
      body: {
        appendChild() {},
      },
    };
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: {
            postMessage() {},
          },
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: {
        ReadableStream,
        setTimeout() {
          return 1;
        },
        dispatchEvent() {
          return true;
        },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        location: { href: "https://yagodka.org/web/" },
      },
      configurable: true,
      writable: true,
    });

    const downloadByFileId = new Map();
    const feature = helper.createFileDownloadActionsFeature({
      store: {
        get() {
          return {
            conn: "connected",
            authed: true,
            fileTransfers: [],
            fileOffersIn: [],
            conversations: {},
            selected: null,
            selfId: "111",
          };
        },
        set(patch) {
          if (patch && typeof patch === "object" && typeof patch.status === "string") statuses.push(patch.status);
        },
      },
      downloadByFileId,
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      scheduleSaveFileTransfers() {},
    });

    const url = feature.beginViewerStream("f-1", { name: "photo.jpg", size: 123, mime: "image/jpeg" });
    assert.equal(typeof url, "string");
    assert.match(url, /__yagodka_stream__\/files\/f-1/);
    assert.match(url, /inline=1/);
    const sid = new URL(url, "https://yagodka.org").searchParams.get("sid");
    assert.ok(sid);

    feature.handlePwaStreamReady({ streamId: sid, fileId: "f-1" });

    assert.deepEqual(enqueued, ["f-1"]);
    assert.equal(downloadByFileId.get("f-1")?.streaming, true);
    assert.equal(downloadByFileId.get("f-1")?.streamId, sid);
    assert.deepEqual(statuses, [], "inline viewer stream must not overwrite the mobile header status");
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true, writable: true });
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true, writable: true });
    if (prevCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = prevCustomEvent;
    await helper.cleanup();
  }
});
