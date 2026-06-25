import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  const entry = path.join(tempDir, "entry.ts");
  try {
    await writeFile(
      entry,
      [
        `export { shouldHydrateSilentFullBlob, getSilentFileUrlPlan } from ${JSON.stringify(path.resolve("src/app/features/files/fileDownloadFeature.ts"))};`,
        `export { prefetchHistoryMediaFromHistoryResult } from ${JSON.stringify(path.resolve("src/helpers/chat/historyMediaPrefetch.ts"))};`,
      ].join("\n"),
      "utf8"
    );
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    for (const key of ["shouldHydrateSilentFullBlob", "getSilentFileUrlPlan", "prefetchHistoryMediaFromHistoryResult"]) {
      if (typeof mod[key] !== "function") throw new Error(`missing export: ${key}`);
    }
    return {
      shouldHydrateSilentFullBlob: mod.shouldHydrateSilentFullBlob,
      getSilentFileUrlPlan: mod.getSilentFileUrlPlan,
      prefetchHistoryMediaFromHistoryResult: mod.prefetchHistoryMediaFromHistoryResult,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("file auto hydration: preview caching alone does not full-download visual media", async () => {
  const { shouldHydrateSilentFullBlob, getSilentFileUrlPlan, cleanup } = await loadHelpers();
  try {
    const allowFullDownload = shouldHydrateSilentFullBlob({
      kind: "image",
      name: "IMG20250516141154.jpg",
      mime: "image/jpeg",
      size: 4 * 1024 * 1024,
      userId: "u1",
      shouldCachePreview: () => true,
      canAutoDownloadFullFile: () => false,
    });
    const plan = getSilentFileUrlPlan({
      hasUrl: true,
      hasThumbUrl: true,
      kind: "image",
      allowFullDownload,
    });
    assert.equal(allowFullDownload, false);
    assert.deepEqual(plan, {
      fetchThumb: true,
      fetchFull: false,
      scheduleThumbPoll: false,
      finishWithoutNetwork: false,
    });
  } finally {
    await cleanup();
  }
});

test("file auto hydration: silent video without thumb keeps full download and thumb polling together", async () => {
  const { shouldHydrateSilentFullBlob, getSilentFileUrlPlan, cleanup } = await loadHelpers();
  try {
    const allowFullDownload = shouldHydrateSilentFullBlob({
      kind: "video",
      name: "clip.mp4",
      mime: "video/mp4",
      size: 10 * 1024 * 1024,
      userId: "u1",
      shouldCachePreview: () => false,
      canAutoDownloadFullFile: () => true,
    });
    const plan = getSilentFileUrlPlan({
      hasUrl: true,
      hasThumbUrl: false,
      kind: "video",
      allowFullDownload,
    });
    assert.equal(allowFullDownload, true);
    assert.deepEqual(plan, {
      fetchThumb: false,
      fetchFull: true,
      scheduleThumbPoll: true,
      finishWithoutNetwork: false,
    });
  } finally {
    await cleanup();
  }
});

test("history media prefetch: visual media is not auto-queued without user action", async () => {
  const prevDocument = globalThis.document;
  globalThis.document = { visibilityState: "visible" };
  const { prefetchHistoryMediaFromHistoryResult, cleanup } = await loadHelpers();
  try {
    const enqueued = [];
    prefetchHistoryMediaFromHistoryResult(
      {
        peer: "222-222-222",
        rows: [
          {
            id: 10,
            attachment: {
              kind: "file",
              file_id: "f-1",
              name: "large-photo.jpg",
              mime: "image/jpeg",
              size: 4 * 1024 * 1024,
            },
          },
        ],
      },
      {
        getState: () => ({
          authed: true,
          conn: "connected",
          selfId: "u1",
          netLeader: true,
          selected: { kind: "dm", id: "222-222-222" },
          fileThumbs: { "f-1": { url: "blob:thumb-1" } },
          fileTransfers: [],
        }),
        devicePrefetchAllowed: true,
        autoDownloadCachePolicyFeature: {
          resolveAutoDownloadKind: () => "image",
          canAutoDownloadFullFile: () => false,
          shouldCachePreview: () => true,
        },
        enqueueFileGet: (fileId, opts) => enqueued.push({ fileId, opts }),
      }
    );
    assert.deepEqual(enqueued, []);
  } finally {
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    await cleanup();
  }
});

test("history media prefetch: thumb-only entry is skipped when full hydration is not allowed", async () => {
  const prevDocument = globalThis.document;
  globalThis.document = { visibilityState: "visible" };
  const { prefetchHistoryMediaFromHistoryResult, cleanup } = await loadHelpers();
  try {
    const enqueued = [];
    prefetchHistoryMediaFromHistoryResult(
      {
        peer: "222-222-222",
        rows: [
          {
            id: 11,
            attachment: {
              kind: "file",
              file_id: "f-2",
              name: "photo.jpg",
              mime: "image/jpeg",
              size: 4 * 1024 * 1024,
            },
          },
        ],
      },
      {
        getState: () => ({
          authed: true,
          conn: "connected",
          selfId: "u1",
          netLeader: true,
          selected: { kind: "dm", id: "333-333-333" },
          fileThumbs: { "f-2": { url: "blob:thumb-2" } },
          fileTransfers: [],
        }),
        devicePrefetchAllowed: true,
        autoDownloadCachePolicyFeature: {
          resolveAutoDownloadKind: () => "image",
          canAutoDownloadFullFile: () => false,
          shouldCachePreview: () => false,
        },
        enqueueFileGet: (fileId, opts) => enqueued.push({ fileId, opts }),
      }
    );
    assert.deepEqual(enqueued, []);
  } finally {
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    await cleanup();
  }
});

test("history media prefetch: terminal error transfers are not requeued", async () => {
  const prevDocument = globalThis.document;
  globalThis.document = { visibilityState: "visible" };
  const { prefetchHistoryMediaFromHistoryResult, cleanup } = await loadHelpers();
  try {
    const enqueued = [];
    prefetchHistoryMediaFromHistoryResult(
      {
        peer: "222-222-222",
        rows: [
          {
            id: 12,
            attachment: {
              kind: "file",
              file_id: "missing-img",
              name: "missing.jpg",
              mime: "image/jpeg",
              size: 2048,
            },
          },
        ],
      },
      {
        getState: () => ({
          authed: true,
          conn: "connected",
          selfId: "u1",
          netLeader: true,
          selected: { kind: "dm", id: "222-222-222" },
          fileThumbs: {},
          fileTransfers: [{ id: "missing-img", status: "error" }],
        }),
        devicePrefetchAllowed: true,
        autoDownloadCachePolicyFeature: {
          resolveAutoDownloadKind: () => "image",
          canAutoDownloadFullFile: () => true,
          shouldCachePreview: () => true,
        },
        enqueueFileGet: (fileId, opts) => enqueued.push({ fileId, opts }),
      }
    );
    assert.deepEqual(enqueued, []);
  } finally {
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    await cleanup();
  }
});
