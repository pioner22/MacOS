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
      entryPoints: [path.resolve("src/app/features/files/fileHttpDownloadRuntime.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createFileHttpDownloadRuntime !== "function") {
      throw new Error("missing export: createFileHttpDownloadRuntime");
    }
    return {
      createFileHttpDownloadRuntime: mod.createFileHttpDownloadRuntime,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("fileHttpDownloadRuntime: high-priority work starts before prefetch and follower prefetch is held back", async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  globalThis.window = globalThis;
  globalThis.document = { visibilityState: "visible" };

  const { createFileHttpDownloadRuntime, cleanup } = await loadHelper();
  try {
    const started = [];
    const runtime = createFileHttpDownloadRuntime({
      getState: () => ({ authed: true, conn: "connected", netLeader: false }),
      prefetchAllowed: true,
      maxConcurrency: 2,
      prefetchConcurrency: 1,
      isUserRequested: () => false,
      onStart: ({ fileId, priority }) => started.push({ fileId, priority }),
    });

    runtime.enqueue("pref-1", {
      url: "/files/pref-1",
      name: "pref-1",
      size: 1,
      mime: null,
      silent: true,
      priority: "prefetch",
    });
    runtime.enqueue("high-1", {
      url: "/files/high-1",
      name: "high-1",
      size: 1,
      mime: null,
      silent: false,
      priority: "high",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(started, [{ fileId: "high-1", priority: "high" }]);
  } finally {
    await cleanup();
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }
});

test("fileHttpDownloadRuntime: queued prefetch is promoted to high when the user explicitly requests it", async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  globalThis.window = globalThis;
  globalThis.document = { visibilityState: "visible" };

  const { createFileHttpDownloadRuntime, cleanup } = await loadHelper();
  try {
    const requested = new Set();
    const started = [];
    const runtime = createFileHttpDownloadRuntime({
      getState: () => ({ authed: true, conn: "connected", netLeader: true }),
      prefetchAllowed: true,
      maxConcurrency: 1,
      prefetchConcurrency: 1,
      isUserRequested: (fileId) => requested.has(fileId),
      onStart: ({ fileId, priority }) => started.push({ fileId, priority }),
    });

    runtime.enqueue("pref-2", {
      url: "/files/pref-2",
      name: "pref-2",
      size: 1,
      mime: null,
      silent: true,
      priority: "prefetch",
    });
    requested.add("pref-2");
    runtime.scheduleDrain();

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(started, [{ fileId: "pref-2", priority: "high" }]);
  } finally {
    await cleanup();
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }
});
