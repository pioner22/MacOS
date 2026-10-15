import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/files/fileGetFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createFileGetFeature !== "function") throw new Error("createFileGetFeature export missing");
    return { createFileGetFeature: mod.createFileGetFeature, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("fileGetFeature: pending update activity tracks active file_get", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const helper = await loadFeature();
  try {
    const timers = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        setTimeout(fn, ms) {
          timers.push({ fn, ms });
          return timers.length;
        },
        clearTimeout() {},
        location: { href: "https://yagodka.org/web/" },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible" },
      configurable: true,
      writable: true,
    });

    const sendCalls = [];
    const store = {
      state: {
        authed: true,
        conn: "connected",
        netLeader: true,
        fileTransfers: [],
        fileThumbs: {},
      },
      get() {
        return this.state;
      },
      set(patch) {
        this.state =
          typeof patch === "function"
            ? patch(this.state)
            : {
                ...this.state,
                ...patch,
              };
      },
    };

    const feature = helper.createFileGetFeature({
      store,
      send: (payload) => {
        sendCalls.push(payload);
        return true;
      },
      deviceCaps: {
        constrained: false,
        slowNetwork: false,
        prefetchAllowed: true,
        fileGetMax: 2,
        fileGetPrefetch: 1,
        fileGetTimeoutMs: 10_000,
      },
      isFileHttpDisabled: () => true,
      isUploadActive: () => false,
      isDownloadActive: () => false,
      resolveFileMeta: () => ({ name: "photo.jpg", size: 100, mime: "image/jpeg" }),
    });

    assert.equal(feature.hasPendingActivityForUpdate(), false);
    feature.enqueue("file-1", { priority: "high", silent: true });
    assert.equal(feature.hasPendingActivityForUpdate(), true);
    assert.equal(sendCalls.length, 1);
    assert.deepEqual(sendCalls[0], { type: "file_get", file_id: "file-1", transport: "http" });

    feature.finish("file-1");
    assert.equal(feature.hasPendingActivityForUpdate(), false);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    await helper.cleanup();
  }
});

test("fileGetFeature: registers pending file_get as a PWA reload blocker", async () => {
  const src = await readFile("src/app/features/files/fileGetFeature.ts", "utf8");
  assert.match(src, /registerPwaReloadBlocker/);
  assert.match(src, /"file_get"/);
  assert.match(src, /hasPendingActivityForUpdate/);
});

test("pwa reload safety: history and preview activity use the shared reload blocker registry", async () => {
  const lazyRecoverySrc = await readFile("src/app/bootstrap/lazyImportRecovery.ts", "utf8");
  const historySrc = await readFile("src/app/features/history/historyFeature.ts", "utf8");
  const previewSrc = await readFile("src/app/features/files/previewAutoFetchFeature.ts", "utf8");

  assert.match(lazyRecoverySrc, /hasPwaReloadBlockers/);
  assert.match(lazyRecoverySrc, /lazy_import_deferred/);
  assert.match(historySrc, /registerPwaReloadBlocker\("history"/);
  assert.match(previewSrc, /registerPwaReloadBlocker\("preview_auto_fetch"/);
});
