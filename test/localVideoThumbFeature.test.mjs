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
      entryPoints: [path.resolve("src/app/features/files/localVideoThumbFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createLocalVideoThumbFeature !== "function") {
      throw new Error("createLocalVideoThumbFeature export missing");
    }
    return { createLocalVideoThumbFeature: mod.createLocalVideoThumbFeature, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function makeFeature(helper, state) {
  return helper.createLocalVideoThumbFeature({
    store: {
      get: () => state,
      set: (patch) => Object.assign(state, typeof patch === "function" ? patch(state) : { ...state, ...patch }),
    },
    prefetchAllowed: true,
    constrained: false,
    slowNetwork: false,
    fileThumbMaxEntries: 32,
    thumbCacheId: (fileId) => `thumb:${fileId}`,
    enqueueFileGet() {},
    shouldCachePreview: () => false,
    enforceFileCachePolicy: async () => {},
    putCachedFileBlob: async () => {},
  });
}

test("localVideoThumbFeature: active fullscreen thumb url is not revoked while viewer uses it", async () => {
  const helper = await loadFeature();
  const prevUrl = globalThis.URL;
  const revoked = [];
  try {
    globalThis.URL = { ...(prevUrl || {}), revokeObjectURL: (url) => revoked.push(String(url)) };
    const state = {
      authed: true,
      conn: "connected",
      selfId: "u1",
      fileThumbs: {
        "f-1": { url: "blob:thumb-old", mime: "image/jpeg", ts: 1 },
      },
      modal: { kind: "file_viewer", fileId: "f-1", url: "blob:thumb-old", name: "photo.jpg", mime: "image/jpeg" },
    };
    const feature = makeFeature(helper, state);

    feature.setFileThumb("f-1", "blob:thumb-new", "image/jpeg");

    assert.deepEqual(revoked, []);
    assert.equal(state.fileThumbs["f-1"]?.url, "blob:thumb-new");
  } finally {
    if (prevUrl === undefined) delete globalThis.URL;
    else globalThis.URL = prevUrl;
    await helper.cleanup();
  }
});

test("localVideoThumbFeature: inactive replaced thumb urls are still revoked", async () => {
  const helper = await loadFeature();
  const prevUrl = globalThis.URL;
  const revoked = [];
  try {
    globalThis.URL = { ...(prevUrl || {}), revokeObjectURL: (url) => revoked.push(String(url)) };
    const state = {
      authed: true,
      conn: "connected",
      selfId: "u1",
      fileThumbs: {
        "f-1": { url: "blob:thumb-old", mime: "image/jpeg", ts: 1 },
      },
      modal: { kind: "file_viewer", fileId: "f-2", url: "blob:other", name: "other.jpg", mime: "image/jpeg" },
    };
    const feature = makeFeature(helper, state);

    feature.setFileThumb("f-1", "blob:thumb-new", "image/jpeg");

    assert.deepEqual(revoked, ["blob:thumb-old"]);
    assert.equal(state.fileThumbs["f-1"]?.url, "blob:thumb-new");
  } finally {
    if (prevUrl === undefined) delete globalThis.URL;
    else globalThis.URL = prevUrl;
    await helper.cleanup();
  }
});
