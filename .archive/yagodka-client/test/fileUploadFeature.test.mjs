import test from "node:test";
import assert from "node:assert/strict";
import { File } from "node:buffer";
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
      entryPoints: [path.resolve("src/app/features/files/fileUploadFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createFileUploadFeature !== "function") {
      throw new Error("missing export: createFileUploadFeature");
    }
    return {
      createFileUploadFeature: mod.createFileUploadFeature,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function createStore(initial) {
  let state = initial;
  return {
    get() {
      return state;
    },
    set(patch) {
      state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
    },
  };
}

function createInitialState() {
  return {
    authed: true,
    selfId: "111-111-111",
    friends: [{ id: "222-222-222" }],
    groups: [],
    boards: [],
    conversations: {},
    fileTransfers: [],
    deliverySync: {
      drafts: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1, lastLocalAt: null },
      fileTransfers: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1, lastLocalAt: null },
      outbox: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1, lastLocalAt: null },
    },
  };
}

function updateTransferByLocalId(store, localId, apply) {
  store.set((prev) => ({
    ...prev,
    fileTransfers: prev.fileTransfers.map((entry) => (entry.localId === localId ? apply(entry) : entry)),
  }));
}

function updateTransferByFileId(store, fileId, apply) {
  store.set((prev) => ({
    ...prev,
    fileTransfers: prev.fileTransfers.map((entry) => (entry.id === fileId ? apply(entry) : entry)),
  }));
}

function updateConversationFileMessage(store, key, localId, apply) {
  store.set((prev) => {
    const conv = prev.conversations[key] || [];
    return {
      ...prev,
      conversations: {
        ...prev.conversations,
        [key]: conv.map((msg) =>
          String(msg?.attachment?.localId || "") === String(localId || "") ? apply(msg) : msg
        ),
      },
    };
  });
}

function removeConversationFileMessage(store, key, localId) {
  store.set((prev) => {
    const conv = prev.conversations[key] || [];
    return {
      ...prev,
      conversations: {
        ...prev.conversations,
        [key]: conv.filter((msg) => String(msg?.attachment?.localId || "") !== String(localId || "")),
      },
    };
  });
}

function createHarness(createFileUploadFeature, overrides = {}) {
  const store = createStore(createInitialState());
  const sent = [];
  const incidents = [];
  let nextId = 1;
  let httpDisabled = Boolean(overrides.httpDisabled);
  const feature = createFileUploadFeature({
    store,
    send: (payload) => sent.push(payload),
    fileUploadMaxConcurrency: 1,
    isFileHttpDisabled: () => httpDisabled,
    disableFileHttp: () => {
      httpDisabled = true;
    },
    nextTransferId: () => `local-${nextId++}`,
    markChatAutoScroll() {},
    updateTransferByLocalId: (localId, apply) => updateTransferByLocalId(store, localId, apply),
    updateTransferByFileId: (fileId, apply) => updateTransferByFileId(store, fileId, apply),
    updateConversationFileMessage: (key, localId, apply) => updateConversationFileMessage(store, key, localId, apply),
    removeConversationFileMessage: (key, localId) => removeConversationFileMessage(store, key, localId),
    reportIncident: (kind, detail) => {
      incidents.push({ kind, detail });
      return true;
    },
  });
  return {
    feature,
    store,
    sent,
    incidents,
    isHttpDisabled: () => httpDisabled,
  };
}

async function waitFor(assertion, timeoutMs = 200) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError || new Error("waitFor timed out");
}

function installBrowserStubs() {
  const prevWindow = globalThis.window;
  const prevLocation = globalThis.location;
  const prevCreateObjectURL = URL.createObjectURL;
  const prevFetch = globalThis.fetch;
  const location = { href: "https://yagodka.org/web/" };
  globalThis.location = location;
  globalThis.window = { setTimeout, location };
  URL.createObjectURL = () => "blob:local-preview";
  return () => {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevLocation === undefined) delete globalThis.location;
    else globalThis.location = prevLocation;
    if (prevCreateObjectURL === undefined) delete URL.createObjectURL;
    else URL.createObjectURL = prevCreateObjectURL;
    if (prevFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = prevFetch;
  };
}

test("fileUploadFeature: sends offer, resolves file id and uploads through HTTP bearer transport", async () => {
  const restore = installBrowserStubs();
  const helper = await loadFeature();
  try {
    const fetchCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      fetchCalls.push({ url: String(url), init });
      if (init.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "Upload-Offset": "0" } });
      }
      if (init.method === "PATCH") {
        assert.equal(init.headers.Authorization, "Bearer upload-token");
        assert.equal(init.headers["Upload-Offset"], "0");
        return new Response(null, { status: 204, headers: { "Upload-Offset": "5" } });
      }
      throw new Error(`unexpected fetch method: ${init.method}`);
    };

    const { feature, store, sent } = createHarness(helper.createFileUploadFeature);
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "photo.jpg", { type: "image/jpeg" });

    feature.sendFile(file, { kind: "dm", id: "222-222-222" }, "caption");

    assert.equal(sent[0].type, "file_offer");
    assert.equal(sent[0].transport, "http");
    assert.equal(sent[0].local_id, "local-1");
    assert.equal(sent[0].to, "222-222-222");
    assert.equal(sent[0].mime, "image/jpeg");
    assert.equal(store.get().fileTransfers[0].status, "offering");
    assert.equal(store.get().conversations["dm:222-222-222"][0].attachment.localId, "local-1");

    feature.handleMessage({
      type: "file_offer_result",
      ok: true,
      local_id: "local-1",
      file_id: "f-http",
      msg_id: 42,
      upload_url: "/files/upload/f-http",
      upload_auth_token: "upload-token",
    });

    await waitFor(() => {
      assert.equal(sent.some((payload) => payload.type === "file_upload_complete" && payload.file_id === "f-http"), true);
    });

    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0].url, "https://yagodka.org/files/upload/f-http");
    assert.equal(fetchCalls[1].url, "https://yagodka.org/files/upload/f-http");
    assert.equal(store.get().fileTransfers[0].id, "f-http");
    assert.equal(store.get().fileTransfers[0].status, "uploaded");
    assert.equal(store.get().fileTransfers[0].progress, 100);
    assert.equal(store.get().conversations["dm:222-222-222"][0].id, 42);
    assert.equal(store.get().conversations["dm:222-222-222"][0].attachment.fileId, "f-http");
  } finally {
    await helper.cleanup();
    restore();
  }
});

test("fileUploadFeature: reports pending upload activity for PWA reload safety", async () => {
  const restore = installBrowserStubs();
  const helper = await loadFeature();
  try {
    const { feature, store, sent } = createHarness(helper.createFileUploadFeature);
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });

    assert.equal(feature.hasPendingActivityForUpdate(), false);
    feature.sendFile(file, { kind: "dm", id: "222-222-222" }, "");

    assert.equal(feature.hasPendingActivityForUpdate(), true);
    assert.equal(sent[0].type, "file_offer");

    feature.handleMessage({
      type: "file_offer_result",
      ok: false,
      local_id: "local-1",
      reason: "not_authorized",
    });

    assert.equal(feature.hasPendingActivityForUpdate(), false);
    assert.equal(store.get().fileTransfers[0].status, "error");
  } finally {
    await helper.cleanup();
    restore();
  }
});

test("fileUploadFeature: falls back from failed HTTP upload to legacy chunks", async () => {
  const restore = installBrowserStubs();
  const helper = await loadFeature();
  try {
    globalThis.fetch = async (_url, init = {}) => {
      if (init.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "Upload-Offset": "0" } });
      }
      return new Response(null, { status: 404 });
    };

    const { feature, store, sent, isHttpDisabled } = createHarness(helper.createFileUploadFeature);
    const file = new File([new Uint8Array([9, 8, 7])], "clip.mp4", { type: "video/mp4" });

    feature.sendFile(file, { kind: "dm", id: "222-222-222" }, "");
    feature.handleMessage({
      type: "file_offer_result",
      ok: true,
      local_id: "local-1",
      file_id: "f-legacy",
      upload_url: "/files/upload/f-legacy",
      upload_auth_token: "upload-token",
    });

    await waitFor(() => {
      assert.equal(sent.some((payload) => payload.type === "file_chunk" && payload.file_id === "f-legacy"), true);
      assert.equal(
        sent.some((payload) => payload.type === "file_upload_complete" && payload.file_id === "f-legacy"),
        true
      );
    });

    assert.equal(isHttpDisabled(), true);
    assert.equal(store.get().fileTransfers[0].status, "uploaded");
    assert.equal(store.get().fileTransfers[0].progress, 100);
  } finally {
    await helper.cleanup();
    restore();
  }
});
