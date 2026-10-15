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
      entryPoints: [path.resolve("src/app/features/files/fileDownloadFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createFileDownloadFeature !== "function") throw new Error("createFileDownloadFeature export missing");
    return { createFileDownloadFeature: mod.createFileDownloadFeature, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("fileDownloadFeature: exhausted silent not_found records terminal history state", async () => {
  const helper = await loadFeature();
  try {
    const state = {
      authed: true,
      conn: "connected",
      netLeader: true,
      selfId: "u1",
      status: "",
      fileTransfers: [],
      fileThumbs: {},
    };
    const calls = { retry: 0, clearSilent: 0, save: 0 };
    const store = {
      get: () => state,
      set: (patch) => {
        const next = typeof patch === "function" ? patch(state) : { ...state, ...patch };
        Object.assign(state, next);
      },
      subscribe: () => {},
    };
    const noop = () => {};
    const feature = helper.createFileDownloadFeature({
      store,
      send: noop,
      deviceCaps: { constrained: false, slowNetwork: false, prefetchAllowed: true },
      downloadByFileId: new Map(),
      disableFileHttp: noop,
      nextTransferId: () => "ft-missing",
      updateTransferByFileId: noop,
      scheduleSaveFileTransfers: () => {
        calls.save += 1;
      },
      resolveFileMeta: () => ({ name: "missing.jpg", size: 2048, mime: "image/jpeg" }),
      shouldCacheFile: () => false,
      shouldCachePreview: () => false,
      enforceFileCachePolicy: async () => {},
      thumbCacheId: (fileId) => `thumb:${fileId}`,
      canAutoDownloadFullFile: () => false,
      resolveAutoDownloadKind: () => "image",
      isSilentFileGet: () => true,
      clearSilentFileGet: () => {
        calls.clearSilent += 1;
      },
      clearFileAcceptRetry: noop,
      clearFileGetNotFoundRetry: noop,
      scheduleFileGetNotFoundRetry: () => {
        calls.retry += 1;
        return false;
      },
      finishFileGet: noop,
      touchFileGetTimeout: noop,
      dropFileGetQueue: noop,
      tryResolveHttpFileUrlWaiter: () => false,
      requestFreshHttpDownloadUrl: async () => ({ url: "https://example.invalid/file" }),
      rejectHttpFileUrlWaiter: noop,
      scheduleThumbPollRetry: noop,
      clearThumbPollRetry: noop,
      setFileThumb: noop,
      maybeSetVideoPosterFromBlob: noop,
      probeImageDimensions: async () => ({ w: null, h: null }),
      pendingFileDownloads: new Map(),
      triggerBrowserDownload: noop,
      takePendingFileViewer: () => null,
      clearPendingFileViewer: noop,
      buildFileViewerModalState: () => ({ kind: "file_viewer" }),
      postStreamChunk: () => true,
      postStreamEnd: noop,
      postStreamError: noop,
      clearCachedPreviewAttempt: noop,
      clearPreviewPrefetchAttempt: noop,
      isUploadActive: () => false,
      abortUploadByFileId: noop,
    });

    assert.equal(feature.handleMessage({ type: "file_error", file_id: "missing-img", reason: "not_found" }), true);
    assert.equal(calls.retry, 1);
    assert.equal(calls.clearSilent, 1);
    assert.equal(calls.save, 1);
    assert.equal(state.status, "");
    assert.deepEqual(state.fileTransfers, [
      {
        localId: "ft-missing",
        id: "missing-img",
        name: "missing.jpg",
        size: 2048,
        mime: "image/jpeg",
        direction: "in",
        peer: "—",
        room: null,
        status: "error",
        progress: 0,
        error: "not_found",
      },
    ]);
  } finally {
    await helper.cleanup();
  }
});

test("fileDownloadFeature: visual not_found reports unavailable media instead of raw error", async () => {
  const helper = await loadFeature();
  try {
    const state = {
      authed: true,
      conn: "connected",
      netLeader: true,
      selfId: "u1",
      status: "",
      fileTransfers: [],
      fileThumbs: {},
    };
    const store = {
      get: () => state,
      set: (patch) => {
        const next = typeof patch === "function" ? patch(state) : { ...state, ...patch };
        Object.assign(state, next);
      },
      subscribe: () => {},
    };
    const noop = () => {};
    const feature = helper.createFileDownloadFeature({
      store,
      send: noop,
      deviceCaps: { constrained: false, slowNetwork: false, prefetchAllowed: true },
      downloadByFileId: new Map(),
      disableFileHttp: noop,
      nextTransferId: () => "ft-missing",
      updateTransferByFileId: noop,
      scheduleSaveFileTransfers: noop,
      resolveFileMeta: () => ({ name: "missing.jpg", size: 2048, mime: "image/jpeg" }),
      shouldCacheFile: () => false,
      shouldCachePreview: () => false,
      enforceFileCachePolicy: async () => {},
      thumbCacheId: (fileId) => `thumb:${fileId}`,
      canAutoDownloadFullFile: () => false,
      resolveAutoDownloadKind: () => "image",
      isSilentFileGet: () => false,
      clearSilentFileGet: noop,
      clearFileAcceptRetry: noop,
      clearFileGetNotFoundRetry: noop,
      scheduleFileGetNotFoundRetry: () => false,
      finishFileGet: noop,
      touchFileGetTimeout: noop,
      dropFileGetQueue: noop,
      tryResolveHttpFileUrlWaiter: () => false,
      requestFreshHttpDownloadUrl: async () => ({ url: "https://example.invalid/file" }),
      rejectHttpFileUrlWaiter: noop,
      scheduleThumbPollRetry: noop,
      clearThumbPollRetry: noop,
      setFileThumb: noop,
      maybeSetVideoPosterFromBlob: noop,
      probeImageDimensions: async () => ({ w: null, h: null }),
      pendingFileDownloads: new Map(),
      triggerBrowserDownload: noop,
      takePendingFileViewer: () => null,
      clearPendingFileViewer: noop,
      buildFileViewerModalState: () => ({ kind: "file_viewer" }),
      postStreamChunk: () => true,
      postStreamEnd: noop,
      postStreamError: noop,
      clearCachedPreviewAttempt: noop,
      clearPreviewPrefetchAttempt: noop,
      isUploadActive: () => false,
      abortUploadByFileId: noop,
    });

    assert.equal(feature.handleMessage({ type: "file_error", file_id: "missing-img", reason: "not_found" }), true);
    assert.equal(state.status, "Файл недоступен");
    assert.equal(state.fileTransfers[0]?.status, "error");
    assert.equal(state.fileTransfers[0]?.error, "not_found");
  } finally {
    await helper.cleanup();
  }
});

test("fileDownloadFeature: audio file_url becomes progressive media URL without full download", async () => {
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const helper = await loadFeature();
  try {
    const messages = [];
    Object.defineProperty(globalThis, "location", {
      value: { href: "https://yagodka.org/web/" },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { serviceWorker: { controller: { postMessage: (msg) => messages.push(msg) } } },
      configurable: true,
      writable: true,
    });

    const state = { authed: true, conn: "connected", netLeader: true, selfId: "u1", status: "", fileTransfers: [], fileThumbs: {} };
    const downloadByFileId = new Map();
    const calls = { save: 0, finish: 0, clearSilent: 0 };
    const store = {
      get: () => state,
      set: (patch) => Object.assign(state, typeof patch === "function" ? patch(state) : { ...state, ...patch }),
      subscribe: () => {},
    };
    const noop = () => {};
    const feature = helper.createFileDownloadFeature({
      store,
      send: noop,
      deviceCaps: { constrained: false, slowNetwork: false, prefetchAllowed: true },
      downloadByFileId,
      disableFileHttp: noop,
      nextTransferId: () => "ft-audio",
      updateTransferByFileId: noop,
      scheduleSaveFileTransfers: () => {
        calls.save += 1;
      },
      resolveFileMeta: () => ({ name: "voice_1.ogg", size: 4096, mime: "audio/ogg" }),
      shouldCacheFile: () => false,
      shouldCachePreview: () => false,
      enforceFileCachePolicy: async () => {},
      thumbCacheId: (fileId) => `thumb:${fileId}`,
      canAutoDownloadFullFile: () => true,
      resolveAutoDownloadKind: () => "audio",
      isSilentFileGet: () => false,
      clearSilentFileGet: () => {
        calls.clearSilent += 1;
      },
      clearFileAcceptRetry: noop,
      clearFileGetNotFoundRetry: noop,
      scheduleFileGetNotFoundRetry: () => false,
      finishFileGet: () => {
        calls.finish += 1;
      },
      touchFileGetTimeout: noop,
      dropFileGetQueue: noop,
      tryResolveHttpFileUrlWaiter: () => false,
      requestFreshHttpDownloadUrl: async () => ({ url: "https://example.invalid/file" }),
      rejectHttpFileUrlWaiter: noop,
      scheduleThumbPollRetry: noop,
      clearThumbPollRetry: noop,
      setFileThumb: noop,
      maybeSetVideoPosterFromBlob: noop,
      probeImageDimensions: async () => ({ w: null, h: null }),
      pendingFileDownloads: new Map(),
      triggerBrowserDownload: noop,
      takePendingFileViewer: () => null,
      clearPendingFileViewer: noop,
      buildFileViewerModalState: () => ({ kind: "file_viewer" }),
      postStreamChunk: () => true,
      postStreamEnd: noop,
      postStreamError: noop,
      clearCachedPreviewAttempt: noop,
      clearPreviewPrefetchAttempt: noop,
      isUploadActive: () => false,
      abortUploadByFileId: noop,
    });

    assert.equal(
      feature.handleMessage({
        type: "file_url",
        file_id: "aud-1",
        url: "https://yagodka.org/files/aud-1",
        auth_token: "secret-token",
        name: "voice_1.ogg",
        size: 4096,
        mime: "audio/ogg",
      }),
      true
    );

    assert.equal(downloadByFileId.size, 0);
    assert.equal(calls.save, 1);
    assert.equal(calls.finish, 1);
    assert.equal(calls.clearSilent, 1);
    assert.equal(state.fileTransfers[0]?.status, "complete");
    assert.match(state.fileTransfers[0]?.url || "", /\/web\/__yagodka_media__\/files\/aud-1\?sid=/);
    assert.equal(messages[0]?.type, "PWA_MEDIA_SOURCE_REGISTER");
    assert.equal(messages[0]?.headers?.Authorization, "Bearer secret-token");
  } finally {
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    await helper.cleanup();
  }
});

test("fileDownloadFeature: silent voice file_url stays progressive instead of app download", async () => {
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const helper = await loadFeature();
  try {
    const messages = [];
    Object.defineProperty(globalThis, "location", {
      value: { href: "https://yagodka.org/web/" },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { serviceWorker: { controller: { postMessage: (msg) => messages.push(msg) } } },
      configurable: true,
      writable: true,
    });

    const state = { authed: true, conn: "connected", netLeader: true, selfId: "u1", status: "idle", fileTransfers: [], fileThumbs: {} };
    const downloadByFileId = new Map();
    const calls = { save: 0, finish: 0, clearSilent: 0, browserDownload: 0 };
    const store = {
      get: () => state,
      set: (patch) => Object.assign(state, typeof patch === "function" ? patch(state) : { ...state, ...patch }),
      subscribe: () => {},
    };
    const noop = () => {};
    const feature = helper.createFileDownloadFeature({
      store,
      send: noop,
      deviceCaps: { constrained: false, slowNetwork: false, prefetchAllowed: true },
      downloadByFileId,
      disableFileHttp: noop,
      nextTransferId: () => "ft-audio-silent",
      updateTransferByFileId: noop,
      scheduleSaveFileTransfers: () => {
        calls.save += 1;
      },
      resolveFileMeta: () => ({ name: "voice_2.ogg", size: 8192, mime: "audio/ogg" }),
      shouldCacheFile: () => false,
      shouldCachePreview: () => false,
      enforceFileCachePolicy: async () => {},
      thumbCacheId: (fileId) => `thumb:${fileId}`,
      canAutoDownloadFullFile: () => true,
      resolveAutoDownloadKind: () => "audio",
      isSilentFileGet: () => true,
      clearSilentFileGet: () => {
        calls.clearSilent += 1;
      },
      clearFileAcceptRetry: noop,
      clearFileGetNotFoundRetry: noop,
      scheduleFileGetNotFoundRetry: () => false,
      finishFileGet: () => {
        calls.finish += 1;
      },
      touchFileGetTimeout: noop,
      dropFileGetQueue: noop,
      tryResolveHttpFileUrlWaiter: () => false,
      requestFreshHttpDownloadUrl: async () => ({ url: "https://example.invalid/file" }),
      rejectHttpFileUrlWaiter: noop,
      scheduleThumbPollRetry: noop,
      clearThumbPollRetry: noop,
      setFileThumb: noop,
      maybeSetVideoPosterFromBlob: noop,
      probeImageDimensions: async () => ({ w: null, h: null }),
      pendingFileDownloads: new Map(),
      triggerBrowserDownload: () => {
        calls.browserDownload += 1;
      },
      takePendingFileViewer: () => null,
      clearPendingFileViewer: noop,
      buildFileViewerModalState: () => ({ kind: "file_viewer" }),
      postStreamChunk: () => true,
      postStreamEnd: noop,
      postStreamError: noop,
      clearCachedPreviewAttempt: noop,
      clearPreviewPrefetchAttempt: noop,
      isUploadActive: () => false,
      abortUploadByFileId: noop,
    });

    assert.equal(
      feature.handleMessage({
        type: "file_url",
        file_id: "aud-2",
        url: "https://yagodka.org/files/aud-2",
        auth_token: "secret-token-2",
        name: "voice_2.ogg",
        size: 8192,
        mime: "audio/ogg",
      }),
      true
    );

    assert.equal(downloadByFileId.size, 0);
    assert.equal(calls.browserDownload, 0);
    assert.equal(calls.save, 1);
    assert.equal(calls.finish, 1);
    assert.equal(calls.clearSilent, 1);
    assert.equal(state.status, "idle");
    assert.equal(state.fileTransfers[0]?.status, "complete");
    assert.match(state.fileTransfers[0]?.url || "", /\/web\/__yagodka_media__\/files\/aud-2\?sid=/);
    assert.equal(messages[0]?.type, "PWA_MEDIA_SOURCE_REGISTER");
    assert.equal(messages[0]?.headers?.Authorization, "Bearer secret-token-2");
  } finally {
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    await helper.cleanup();
  }
});

test("fileDownloadFeature: audio file_url waits for PWA controller instead of full blob fallback", async () => {
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const helper = await loadFeature();
  try {
    let controller = null;
    let readyResolve = null;
    const listeners = new Map();
    const ready = new Promise((resolve) => {
      readyResolve = resolve;
    });
    Object.defineProperty(globalThis, "location", {
      value: { href: "https://yagodka.org/web/" },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          get controller() {
            return controller;
          },
          addEventListener(type, cb) {
            listeners.set(type, cb);
          },
          removeEventListener(type, cb) {
            if (listeners.get(type) === cb) listeners.delete(type);
          },
          ready,
        },
      },
      configurable: true,
      writable: true,
    });

    const state = { authed: true, conn: "connected", netLeader: true, selfId: "u1", status: "idle", fileTransfers: [], fileThumbs: {} };
    const downloadByFileId = new Map();
    const sent = [];
    const calls = { finish: 0, clearSilent: 0, browserDownload: 0 };
    const store = {
      get: () => state,
      set: (patch) => Object.assign(state, typeof patch === "function" ? patch(state) : { ...state, ...patch }),
      subscribe: () => {},
    };
    const noop = () => {};
    const feature = helper.createFileDownloadFeature({
      store,
      send: (payload) => sent.push(payload),
      deviceCaps: { constrained: false, slowNetwork: false, prefetchAllowed: true },
      downloadByFileId,
      disableFileHttp: noop,
      nextTransferId: () => "ft-audio-wait",
      updateTransferByFileId: noop,
      scheduleSaveFileTransfers: noop,
      resolveFileMeta: () => ({ name: "song.mp3", size: 12_000_000, mime: "audio/mpeg" }),
      shouldCacheFile: () => false,
      shouldCachePreview: () => false,
      enforceFileCachePolicy: async () => {},
      thumbCacheId: (fileId) => `thumb:${fileId}`,
      canAutoDownloadFullFile: () => true,
      resolveAutoDownloadKind: () => "audio",
      isSilentFileGet: () => true,
      clearSilentFileGet: () => {
        calls.clearSilent += 1;
      },
      clearFileAcceptRetry: noop,
      clearFileGetNotFoundRetry: noop,
      scheduleFileGetNotFoundRetry: () => false,
      finishFileGet: () => {
        calls.finish += 1;
      },
      touchFileGetTimeout: noop,
      dropFileGetQueue: noop,
      tryResolveHttpFileUrlWaiter: () => false,
      requestFreshHttpDownloadUrl: async () => ({ url: "https://example.invalid/file" }),
      rejectHttpFileUrlWaiter: noop,
      scheduleThumbPollRetry: noop,
      clearThumbPollRetry: noop,
      setFileThumb: noop,
      maybeSetVideoPosterFromBlob: noop,
      probeImageDimensions: async () => ({ w: null, h: null }),
      pendingFileDownloads: new Map(),
      triggerBrowserDownload: () => {
        calls.browserDownload += 1;
      },
      takePendingFileViewer: () => null,
      clearPendingFileViewer: noop,
      buildFileViewerModalState: () => ({ kind: "file_viewer" }),
      postStreamChunk: () => true,
      postStreamEnd: noop,
      postStreamError: noop,
      clearCachedPreviewAttempt: noop,
      clearPreviewPrefetchAttempt: noop,
      isUploadActive: () => false,
      abortUploadByFileId: noop,
    });

    assert.equal(
      feature.handleMessage({
        type: "file_url",
        file_id: "aud-wait",
        url: "https://yagodka.org/files/aud-wait",
        auth_token: "secret-token-wait",
        name: "song.mp3",
        size: 12_000_000,
        mime: "audio/mpeg",
      }),
      true
    );
    assert.equal(downloadByFileId.size, 0);
    assert.equal(calls.browserDownload, 0);
    assert.equal(sent.length, 0);

    controller = { postMessage() {} };
    readyResolve();
    listeners.get("controllerchange")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(sent, [{ type: "file_get", file_id: "aud-wait" }]);
    assert.equal(calls.finish, 0);
    assert.equal(calls.clearSilent, 0);
  } finally {
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    await helper.cleanup();
  }
});

test("fileDownloadFeature: fullscreen image upgrade keeps current preview as fallback", async () => {
  const helper = await loadFeature();
  const prevUrl = globalThis.URL;
  try {
    globalThis.URL = { ...(prevUrl || {}), createObjectURL: () => "blob:full-img" };
    const state = {
      authed: true,
      conn: "connected",
      netLeader: true,
      selfId: "u1",
      status: "idle",
      fileThumbs: { "img-1": { url: "blob:thumb-img", mime: "image/jpeg", ts: 1 } },
      fileTransfers: [
        {
          localId: "ft-img",
          id: "img-1",
          name: "photo.jpg",
          size: 4,
          mime: "image/jpeg",
          direction: "in",
          peer: "u2",
          status: "downloading",
          progress: 50,
        },
      ],
      modal: {
        kind: "file_viewer",
        fileId: "img-1",
        url: "blob:thumb-img",
        name: "photo.jpg",
        size: 4,
        mime: "image/jpeg",
        caption: null,
        chatKey: "dm:u2",
        msgIdx: 3,
      },
    };
    const downloadByFileId = new Map([
      [
        "img-1",
        {
          fileId: "img-1",
          name: "photo.jpg",
          size: 4,
          from: "u2",
          room: null,
          mime: "image/jpeg",
          chunks: [new Uint8Array([1, 2, 3, 4]).buffer],
          received: 4,
          lastProgress: 100,
        },
      ],
    ]);
    const pendingViewer = {
      fileId: "img-1",
      name: "photo.jpg",
      size: 4,
      mime: "image/jpeg",
      caption: null,
      chatKey: "dm:u2",
      msgIdx: 3,
    };
    let pendingTaken = 0;
    const store = {
      get: () => state,
      set: (patch) => Object.assign(state, typeof patch === "function" ? patch(state) : { ...state, ...patch }),
      subscribe: () => {},
    };
    const noop = () => {};
    const feature = helper.createFileDownloadFeature({
      store,
      send: noop,
      deviceCaps: { constrained: false, slowNetwork: false, prefetchAllowed: true },
      downloadByFileId,
      disableFileHttp: noop,
      nextTransferId: () => "ft-next",
      updateTransferByFileId: (fileId, apply) => {
        state.fileTransfers = state.fileTransfers.map((entry) => (entry.id === fileId ? apply(entry) : entry));
      },
      scheduleSaveFileTransfers: noop,
      resolveFileMeta: () => ({ name: "photo.jpg", size: 4, mime: "image/jpeg" }),
      shouldCacheFile: () => false,
      shouldCachePreview: () => false,
      enforceFileCachePolicy: async () => {},
      thumbCacheId: (fileId) => `thumb:${fileId}`,
      canAutoDownloadFullFile: () => true,
      resolveAutoDownloadKind: () => "image",
      isSilentFileGet: () => false,
      clearSilentFileGet: noop,
      clearFileAcceptRetry: noop,
      clearFileGetNotFoundRetry: noop,
      scheduleFileGetNotFoundRetry: () => false,
      finishFileGet: noop,
      touchFileGetTimeout: noop,
      dropFileGetQueue: noop,
      tryResolveHttpFileUrlWaiter: () => false,
      requestFreshHttpDownloadUrl: async () => ({ url: "https://example.invalid/file" }),
      rejectHttpFileUrlWaiter: noop,
      scheduleThumbPollRetry: noop,
      clearThumbPollRetry: noop,
      setFileThumb: noop,
      maybeSetVideoPosterFromBlob: noop,
      probeImageDimensions: async () => ({ w: null, h: null }),
      pendingFileDownloads: new Map(),
      triggerBrowserDownload: noop,
      takePendingFileViewer: () => {
        pendingTaken += 1;
        return pendingViewer;
      },
      clearPendingFileViewer: noop,
      buildFileViewerModalState: (params) => ({ kind: "file_viewer", ...params }),
      postStreamChunk: () => true,
      postStreamEnd: noop,
      postStreamError: noop,
      clearCachedPreviewAttempt: noop,
      clearPreviewPrefetchAttempt: noop,
      isUploadActive: () => false,
      abortUploadByFileId: noop,
    });

    assert.equal(feature.handleMessage({ type: "file_download_complete", file_id: "img-1" }), true);
    assert.equal(pendingTaken, 1);
    assert.equal(state.modal?.kind, "file_viewer");
    assert.equal(state.modal?.url, "blob:full-img");
    assert.equal(state.modal?.fallbackUrl, "blob:thumb-img");
    assert.equal(state.modal?.fileId, "img-1");
  } finally {
    if (prevUrl === undefined) delete globalThis.URL;
    else globalThis.URL = prevUrl;
    await helper.cleanup();
  }
});

test("fileDownloadFeature: fullscreen video upgrade applies completed blob url", async () => {
  const helper = await loadFeature();
  const prevUrl = globalThis.URL;
  try {
    globalThis.URL = { ...(prevUrl || {}), createObjectURL: () => "blob:full-video" };
    const state = {
      authed: true,
      conn: "connected",
      netLeader: true,
      selfId: "u1",
      status: "idle",
      fileThumbs: {},
      fileTransfers: [
        {
          localId: "ft-video",
          id: "vid-1",
          name: "clip.webm",
          size: 4,
          mime: "video/webm",
          direction: "in",
          peer: "u2",
          status: "downloading",
          progress: 50,
        },
      ],
      modal: {
        kind: "file_viewer",
        fileId: "vid-1",
        url: "/__yagodka_stream__/files/vid-1?sid=old",
        name: "clip.webm",
        size: 4,
        mime: "video/webm",
        caption: null,
        chatKey: "dm:u2",
        msgIdx: 7,
      },
    };
    const downloadByFileId = new Map([
      [
        "vid-1",
        {
          fileId: "vid-1",
          name: "clip.webm",
          size: 4,
          from: "u2",
          room: null,
          mime: "video/webm",
          chunks: [new Uint8Array([1, 2, 3, 4]).buffer],
          received: 4,
          lastProgress: 100,
        },
      ],
    ]);
    const pendingViewer = {
      fileId: "vid-1",
      name: "clip.webm",
      size: 4,
      mime: "video/webm",
      caption: null,
      chatKey: "dm:u2",
      msgIdx: 7,
    };
    let pendingTaken = 0;
    let posterProbeCount = 0;
    const store = {
      get: () => state,
      set: (patch) => Object.assign(state, typeof patch === "function" ? patch(state) : { ...state, ...patch }),
      subscribe: () => {},
    };
    const noop = () => {};
    const feature = helper.createFileDownloadFeature({
      store,
      send: noop,
      deviceCaps: { constrained: false, slowNetwork: false, prefetchAllowed: true },
      downloadByFileId,
      disableFileHttp: noop,
      nextTransferId: () => "ft-next",
      updateTransferByFileId: (fileId, apply) => {
        state.fileTransfers = state.fileTransfers.map((entry) => (entry.id === fileId ? apply(entry) : entry));
      },
      scheduleSaveFileTransfers: noop,
      resolveFileMeta: () => ({ name: "clip.webm", size: 4, mime: "video/webm" }),
      shouldCacheFile: () => false,
      shouldCachePreview: () => false,
      enforceFileCachePolicy: async () => {},
      thumbCacheId: (fileId) => `thumb:${fileId}`,
      canAutoDownloadFullFile: () => true,
      resolveAutoDownloadKind: () => "video",
      isSilentFileGet: () => false,
      clearSilentFileGet: noop,
      clearFileAcceptRetry: noop,
      clearFileGetNotFoundRetry: noop,
      scheduleFileGetNotFoundRetry: () => false,
      finishFileGet: noop,
      touchFileGetTimeout: noop,
      dropFileGetQueue: noop,
      tryResolveHttpFileUrlWaiter: () => false,
      requestFreshHttpDownloadUrl: async () => ({ url: "https://example.invalid/file" }),
      rejectHttpFileUrlWaiter: noop,
      scheduleThumbPollRetry: noop,
      clearThumbPollRetry: noop,
      setFileThumb: noop,
      maybeSetVideoPosterFromBlob: () => {
        posterProbeCount += 1;
      },
      probeImageDimensions: async () => ({ w: null, h: null }),
      pendingFileDownloads: new Map(),
      triggerBrowserDownload: noop,
      takePendingFileViewer: () => {
        pendingTaken += 1;
        return pendingViewer;
      },
      clearPendingFileViewer: noop,
      buildFileViewerModalState: (params) => ({ kind: "file_viewer", ...params }),
      postStreamChunk: () => true,
      postStreamEnd: noop,
      postStreamError: noop,
      clearCachedPreviewAttempt: noop,
      clearPreviewPrefetchAttempt: noop,
      isUploadActive: () => false,
      abortUploadByFileId: noop,
    });

    assert.equal(feature.handleMessage({ type: "file_download_complete", file_id: "vid-1" }), true);
    assert.equal(pendingTaken, 1);
    assert.equal(state.modal?.kind, "file_viewer");
    assert.equal(state.modal?.url, "blob:full-video");
    assert.equal(state.modal?.fallbackUrl, null);
    assert.equal(state.modal?.fileId, "vid-1");
    assert.equal(state.modal?.mime, "video/webm");
    assert.equal(posterProbeCount, 1);
  } finally {
    if (prevUrl === undefined) delete globalThis.URL;
    else globalThis.URL = prevUrl;
    await helper.cleanup();
  }
});
