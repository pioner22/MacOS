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
      entryPoints: [path.resolve("src/app/features/files/fileViewerFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createFileViewerFeature !== "function") {
      throw new Error("createFileViewerFeature export missing");
    }
    return {
      createFileViewerFeature: mod.createFileViewerFeature,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("fileViewerFeature: iOS standalone image opens via inline stream instead of blob download", async () => {
  const prevWindow = globalThis.window;
  const prevNavigator = globalThis.navigator;
  const helper = await loadFeature();
  try {
    const patches = [];
    const enqueued = [];
    const pending = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        matchMedia(query) {
          return { matches: query === "(display-mode: standalone)" };
        },
        setTimeout() {
          return 1;
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        standalone: true,
        maxTouchPoints: 5,
      },
      configurable: true,
      writable: true,
    });

    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "f-1",
              name: "photo.jpg",
              size: 123,
              mime: "image/jpeg",
            },
          },
        ],
      },
      fileTransfers: [],
      fileThumbs: {},
      modal: null,
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          patches.push(patch);
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      beginViewerStream(fileId) {
        return `/__yagodka_stream__/files/${fileId}?sid=stream-1&inline=1`;
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0);

    assert.equal(opened, true);
    assert.deepEqual(enqueued, []);
    assert.deepEqual(pending, []);
    assert.equal(storeState.modal?.kind, "file_viewer");
    assert.equal(storeState.modal?.url, "/__yagodka_stream__/files/f-1?sid=stream-1&inline=1");
    assert.ok(
      patches.some((patch) => patch && typeof patch === "object" && String(patch.status || "").includes("Загрузка: photo.jpg"))
    );
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true, writable: true });
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true, writable: true });
    await helper.cleanup();
  }
});

test("fileViewerFeature: iOS standalone image with thumb opens preview immediately before stream", async () => {
  const prevWindow = globalThis.window;
  const prevNavigator = globalThis.navigator;
  const helper = await loadFeature();
  try {
    const enqueued = [];
    const pending = [];
    const statuses = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        matchMedia(query) {
          return { matches: query === "(display-mode: standalone)" };
        },
        setTimeout() {
          return 1;
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        standalone: true,
        maxTouchPoints: 5,
      },
      configurable: true,
      writable: true,
    });

    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "f-thumb",
              name: "photo.jpg",
              size: 123,
              mime: "image/jpeg",
            },
          },
        ],
      },
      fileOffersIn: [],
      fileTransfers: [],
      fileThumbs: {
        "f-thumb": { url: "blob:thumb-f-thumb", mime: "image/jpeg", ts: 1000 },
      },
      modal: null,
      status: "",
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") {
            if (typeof patch.status === "string") statuses.push(patch.status);
            Object.assign(storeState, patch);
          }
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        throw new Error("thumb path should open before cache lookup");
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      beginViewerStream() {
        throw new Error("thumb path should not start inline stream");
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0);

    assert.equal(opened, true);
    assert.equal(storeState.modal?.kind, "file_viewer");
    assert.equal(storeState.modal?.url, "blob:thumb-f-thumb");
    assert.equal(storeState.modal?.fileId, "f-thumb");
    assert.deepEqual(enqueued, ["f-thumb"]);
    assert.equal(pending[0]?.fileId, "f-thumb");
    assert.ok(statuses.includes("Скачивание: photo.jpg"));
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true, writable: true });
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true, writable: true });
    await helper.cleanup();
  }
});

test("fileViewerFeature: iOS standalone video with thumb opens poster preview and queues full upgrade", async () => {
  const prevWindow = globalThis.window;
  const prevNavigator = globalThis.navigator;
  const helper = await loadFeature();
  try {
    const enqueued = [];
    const pending = [];
    const statuses = [];
    let streamAttempts = 0;
    Object.defineProperty(globalThis, "window", {
      value: {
        matchMedia(query) {
          return { matches: query === "(display-mode: standalone)" };
        },
        setTimeout() {
          return 1;
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        standalone: true,
        maxTouchPoints: 5,
      },
      configurable: true,
      writable: true,
    });

    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "vid-thumb",
              name: "clip.mp4",
              size: 9_000_000,
              mime: "video/mp4",
            },
          },
        ],
      },
      fileOffersIn: [],
      fileTransfers: [],
      fileThumbs: {
        "vid-thumb": { url: "blob:video-thumb", mime: "image/jpeg", ts: 1000 },
      },
      modal: null,
      status: "",
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") {
            if (typeof patch.status === "string") statuses.push(patch.status);
            Object.assign(storeState, patch);
          }
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        throw new Error("video thumb path should open before cache lookup");
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      beginViewerStream() {
        streamAttempts += 1;
        return "/__yagodka_stream__/files/vid-thumb?sid=bad&inline=1";
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0);

    assert.equal(opened, true);
    assert.equal(streamAttempts, 0, "video viewer must not use Range-incompatible inline stream");
    assert.equal(storeState.modal?.kind, "file_viewer");
    assert.equal(storeState.modal?.url, "blob:video-thumb");
    assert.equal(storeState.modal?.mime, "image/jpeg");
    assert.equal(storeState.modal?.autoplay, undefined);
    assert.deepEqual(enqueued, ["vid-thumb"]);
    assert.equal(pending[0]?.fileId, "vid-thumb");
    assert.equal(pending[0]?.mime, "video/mp4");
    assert.ok(statuses.includes("Скачивание: clip.mp4"));
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true, writable: true });
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true, writable: true });
    await helper.cleanup();
  }
});

test("fileViewerFeature: explicit visual open accepts pending file offer before file_get", async () => {
  const helper = await loadFeature();
  try {
    const accepted = [];
    const enqueued = [];
    const pending = [];
    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "f-offer",
              name: "photo.jpg",
              size: 123,
              mime: "image/jpeg",
            },
          },
        ],
      },
      fileOffersIn: [{ id: "f-offer", from: "222", name: "photo.jpg", size: 123, mime: "image/jpeg" }],
      fileTransfers: [],
      fileThumbs: {},
      modal: null,
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      acceptFileOffer(fileId) {
        accepted.push(String(fileId));
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0);

    assert.equal(opened, true);
    assert.deepEqual(accepted, ["f-offer"]);
    assert.deepEqual(enqueued, ["f-offer"]);
    assert.equal(pending[0]?.fileId, "f-offer");
  } finally {
    await helper.cleanup();
  }
});

test("fileViewerFeature: failed iOS inline stream recovery falls back to file_get", async () => {
  const prevWindow = globalThis.window;
  const prevNavigator = globalThis.navigator;
  const helper = await loadFeature();
  try {
    const enqueued = [];
    const pending = [];
    let streamAttempts = 0;
    Object.defineProperty(globalThis, "window", {
      value: {
        location: { href: "https://yagodka.org/web/" },
        matchMedia(query) {
          return { matches: query === "(display-mode: standalone)" };
        },
        setTimeout() {
          return 1;
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        standalone: true,
        maxTouchPoints: 5,
      },
      configurable: true,
      writable: true,
    });

    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "f-stream",
              name: "photo.jpg",
              size: 123,
              mime: "image/jpeg",
            },
          },
        ],
      },
      fileOffersIn: [],
      fileTransfers: [],
      fileThumbs: {},
      modal: {
        kind: "file_viewer",
        fileId: "f-stream",
        url: "/__yagodka_stream__/files/f-stream?sid=s1&inline=1",
        name: "photo.jpg",
        size: 123,
        mime: "image/jpeg",
        caption: null,
        chatKey: "dm:222",
        msgIdx: 0,
        prevIdx: null,
        nextIdx: null,
        openedAtMs: Date.now(),
      },
      status: "",
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      beginViewerStream() {
        streamAttempts += 1;
        return "/__yagodka_stream__/files/f-stream?sid=s2&inline=1";
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    await feature.recoverCurrent();

    assert.equal(streamAttempts, 0);
    assert.deepEqual(enqueued, ["f-stream"]);
    assert.equal(pending[0]?.fileId, "f-stream");
    assert.equal(storeState.status, "Скачивание: photo.jpg");
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true, writable: true });
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true, writable: true });
    await helper.cleanup();
  }
});

test("fileViewerFeature: video recovery restores thumb preview before full file_get", async () => {
  const helper = await loadFeature();
  try {
    const enqueued = [];
    const pending = [];
    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "vid-recover",
              name: "clip.mp4",
              size: 9_000_000,
              mime: "video/mp4",
            },
          },
        ],
      },
      fileOffersIn: [],
      fileTransfers: [],
      fileThumbs: {
        "vid-recover": { url: "blob:recover-thumb", mime: "image/jpeg", ts: 1000 },
      },
      modal: {
        kind: "file_viewer",
        fileId: "vid-recover",
        url: "/__yagodka_stream__/files/vid-recover?sid=s1&inline=1",
        name: "clip.mp4",
        size: 9_000_000,
        mime: "video/mp4",
        caption: null,
        chatKey: "dm:222",
        msgIdx: 0,
        prevIdx: null,
        nextIdx: null,
        openedAtMs: Date.now(),
      },
      status: "",
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      beginViewerStream() {
        throw new Error("video recovery must not restart inline stream");
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    await feature.recoverCurrent();

    assert.equal(storeState.modal?.url, "blob:recover-thumb");
    assert.equal(storeState.modal?.mime, "image/jpeg");
    assert.deepEqual(enqueued, ["vid-recover"]);
    assert.equal(pending[0]?.fileId, "vid-recover");
    assert.equal(pending[0]?.mime, "video/mp4");
  } finally {
    await helper.cleanup();
  }
});

test("fileViewerFeature: terminal visual not_found is not re-enqueued from chat open", async () => {
  const helper = await loadFeature();
  try {
    const enqueued = [];
    const pending = [];
    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "missing-img",
              name: "photo.jpg",
              size: 123,
              mime: "image/jpeg",
            },
          },
        ],
      },
      fileOffersIn: [],
      fileTransfers: [
        {
          localId: "ft-missing",
          id: "missing-img",
          name: "photo.jpg",
          size: 123,
          mime: "image/jpeg",
          direction: "in",
          peer: "222",
          status: "error",
          progress: 0,
          error: "not_found",
        },
      ],
      fileThumbs: {},
      modal: null,
      status: "",
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      acceptFileOffer() {
        throw new Error("missing media must not accept an offer");
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0);

    assert.equal(opened, true);
    assert.deepEqual(enqueued, []);
    assert.deepEqual(pending, []);
    assert.equal(storeState.status, "Файл недоступен");
  } finally {
    await helper.cleanup();
  }
});

test("fileViewerFeature: pdf message is not treated as visual gallery media", async () => {
  const helper = await loadFeature();
  try {
    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "doc-1",
              name: "contract.pdf",
              size: 123,
              mime: "application/pdf",
            },
          },
        ],
      },
      fileOffersIn: [],
      fileTransfers: [],
      fileThumbs: {},
      modal: null,
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet() {
        throw new Error("pdf visual open must not enqueue");
      },
      setPendingFileViewer() {},
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0, { kindHint: undefined });
    assert.equal(opened, false);
    assert.equal(storeState.modal, null);
  } finally {
    await helper.cleanup();
  }
});

test("fileViewerFeature: thumb-only unknown attachment opens as image preview and queues full upgrade", async () => {
  const helper = await loadFeature();
  try {
    const enqueued = [];
    const pending = [];
    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "thumb-only",
              name: "файл",
              size: 0,
              mime: null,
            },
          },
        ],
      },
      fileOffersIn: [],
      fileTransfers: [],
      fileThumbs: {
        "thumb-only": { url: "blob:thumb-only", mime: "image/jpeg", ts: 1000 },
      },
      modal: null,
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0);
    assert.equal(opened, true);
    assert.equal(storeState.modal?.kind, "file_viewer");
    assert.equal(storeState.modal?.url, "blob:thumb-only");
    assert.equal(storeState.modal?.mime, "image/jpeg");
    assert.deepEqual(enqueued, ["thumb-only"]);
    assert.equal(pending[0]?.fileId, "thumb-only");
  } finally {
    await helper.cleanup();
  }
});

test("fileViewerFeature: image full url keeps thumb fallback for mobile recovery", async () => {
  const helper = await loadFeature();
  try {
    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "img-1",
              name: "IMG_3375.jpeg",
              size: 123,
              mime: "image/jpeg",
            },
          },
        ],
      },
      fileOffersIn: [],
      fileTransfers: [
        {
          localId: "ft-img",
          id: "img-1",
          name: "IMG_3375.jpeg",
          size: 123,
          mime: "image/jpeg",
          direction: "in",
          peer: "222",
          status: "complete",
          progress: 100,
          url: "blob:full-img",
        },
      ],
      fileThumbs: {
        "img-1": { url: "blob:thumb-img", mime: "image/jpeg", ts: 1000 },
      },
      modal: null,
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet() {
        throw new Error("complete image should open direct url");
      },
      setPendingFileViewer() {},
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0);
    assert.equal(opened, true);
    assert.equal(storeState.modal?.url, "blob:full-img");
    assert.equal(storeState.modal?.fallbackUrl, "blob:thumb-img");
  } finally {
    await helper.cleanup();
  }
});
