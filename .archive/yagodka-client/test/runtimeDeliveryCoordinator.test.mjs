import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRuntimeDeliveryCoordinator() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/runtime/deliveryCoordinator.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { ...mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("runtimeDeliveryCoordinator: pending/whenOnline outbox and active transfers use one decision layer", async () => {
  const helper = await loadRuntimeDeliveryCoordinator();
  try {
    assert.equal(
      helper.hasPendingOutboxEntries({
        "dm:u-1": [{ localId: "o-1", ts: 1, text: "a", to: "u-1", status: "queued" }],
      }),
      true
    );
    assert.equal(
      helper.hasWhenOnlineOutboxEntries({
        "dm:u-1": [{ localId: "o-1", ts: 1, text: "a", to: "u-1", status: "queued", whenOnline: true }],
      }),
      true
    );
    assert.equal(
      helper.hasActiveFileTransferEntries([
        { localId: "f-1", id: "f-1", name: "a", size: 1, direction: "in", peer: "u-1", status: "downloading", progress: 12 },
      ]),
      true
    );
  } finally {
    await helper.cleanup();
  }
});

test("runtimeDeliveryCoordinator: persist/worker sync depends on unified delivery sync state", async () => {
  const helper = await loadRuntimeDeliveryCoordinator();
  try {
    const state = {
      authed: true,
      selfId: "u-1",
      drafts: { "dm:u-1": "hello" },
      fileTransfers: [],
      outbox: {},
      deliverySync: {
        drafts: { loaded: true, source: "cache", reconcilePending: true, lastServerAt: null, lastLocalAt: 1 },
        fileTransfers: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
        outbox: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1, lastLocalAt: null },
      },
    };
    assert.equal(helper.shouldPersistRuntimeDeliveryDomain(state, "drafts"), true);
    assert.equal(helper.shouldPersistRuntimeDeliveryDomain(state, "fileTransfers"), false);
    assert.equal(helper.shouldSyncOutboxToWorker(state, "u-1"), true);
    assert.equal(helper.shouldSyncOutboxToWorker(state, "u-2"), false);
    assert.equal(helper.shouldReconcileOutboxFromWorker(state, "u-1"), false);
    assert.equal(helper.shouldRegisterOutboxBackgroundSync(state.outbox), false);
    assert.equal(
      helper.shouldRegisterOutboxBackgroundSync({
        "dm:u-1": [{ localId: "o-1", ts: 1, text: "a", to: "u-1", status: "queued" }],
      }),
      true
    );
  } finally {
    await helper.cleanup();
  }
});

test("runtimeDeliveryCoordinator: outbox drain plan centralizes schedule, retry and when-online gating", async () => {
  const helper = await loadRuntimeDeliveryCoordinator();
  try {
    const nowMs = 10_000;
    const state = {
      authed: true,
      selfId: "u-1",
      conn: "connected",
      netLeader: true,
      friends: [{ id: "u-offline", online: false }, { id: "u-online", online: true }],
      outbox: {
        "dm:u-offline": [{ localId: "w-1", ts: 1, text: "later", to: "u-offline", status: "queued", whenOnline: true }],
        "dm:u-online": [{ localId: "r-1", ts: 2, text: "retry", to: "u-online", status: "queued", lastAttemptAt: 9_400 }],
        "dm:u-2": [{ localId: "s-1", ts: 3, text: "scheduled", to: "u-2", status: "queued", scheduleAt: 12_500 }],
        "dm:u-3": [{ localId: "q-1", ts: 4, text: "ready", to: "u-3", status: "queued" }],
      },
    };
    const plan = helper.planOutboxDrain(state, {
      nowMs,
      scheduleGraceMs: 1200,
      retryMinMs: 900,
      maxEntries: 12,
    });
    assert.equal(plan.blocked, "none");
    assert.equal(plan.drainable.length, 1);
    assert.equal(plan.drainable[0].localId, "q-1");
    assert.equal(plan.retryAt, 10_300);
    assert.equal(plan.nextScheduleAt, 12_500);
    assert.equal(helper.shouldAttemptOutboxDrain(state), true);
  } finally {
    await helper.cleanup();
  }
});

test("runtimeDeliveryCoordinator: worker reconcile follows unified reconcilePending owner", async () => {
  const helper = await loadRuntimeDeliveryCoordinator();
  try {
    const state = {
      authed: true,
      selfId: "u-1",
      outbox: {},
      deliverySync: {
        drafts: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
        fileTransfers: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
        outbox: { loaded: true, source: "cache", reconcilePending: true, lastServerAt: null, lastLocalAt: 10 },
      },
    };
    assert.equal(helper.shouldReconcileOutboxFromWorker(state, "u-1"), true);
    assert.equal(helper.shouldReconcileOutboxFromWorker(state, "u-2"), false);
  } finally {
    await helper.cleanup();
  }
});

test("runtimeDeliveryCoordinator: fileTransfers cache reconcile and merge use one restore contract", async () => {
  const helper = await loadRuntimeDeliveryCoordinator();
  try {
    const state = {
      authed: true,
      selfId: "u-1",
      fileTransfers: [
        { localId: "live-1", id: "f-live", name: "live", size: 1, direction: "in", peer: "u-1", status: "downloading", progress: 20 },
      ],
      deliverySync: {
        drafts: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
        fileTransfers: { loaded: true, source: "cache", reconcilePending: true, lastServerAt: null, lastLocalAt: 10 },
        outbox: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
      },
    };
    assert.equal(helper.shouldReconcileFileTransfersFromCache(state, "u-1"), true);
    assert.equal(helper.hasTerminalFileTransferEntries(state.fileTransfers), false);
    assert.equal(helper.isTerminalFileTransferStatus("complete"), true);
    assert.equal(helper.isTerminalFileTransferStatus("downloading"), false);

    const merged = helper.mergeRestoredFileTransfers(state.fileTransfers, [
      { localId: "cache-1", id: "f-cached", name: "cached", size: 2, direction: "in", peer: "u-2", status: "complete", progress: 100 },
      { localId: "dup-live", id: "f-live", name: "dup", size: 3, direction: "in", peer: "u-3", status: "complete", progress: 100 },
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged.some((entry) => entry.id === "f-live" && entry.status === "downloading"), true);
    assert.equal(merged.some((entry) => entry.id === "f-cached" && entry.status === "complete"), true);
  } finally {
    await helper.cleanup();
  }
});

test("runtimeDeliveryCoordinator: upload/download retry policy and upload fallback are centralized", async () => {
  const helper = await loadRuntimeDeliveryCoordinator();
  try {
    const downloadPolicy = helper.getDeliveryRetryPolicy("file_download_http", { constrained: true, slowNetwork: false });
    assert.equal(downloadPolicy.maxRetries, 6);
    assert.equal(downloadPolicy.baseDelayMs, 650);
    assert.equal(downloadPolicy.maxDelayMs, 8000);

    const uploadPolicy = helper.getDeliveryRetryPolicy("file_upload_http");
    assert.equal(uploadPolicy.maxRetries, 4);
    assert.equal(uploadPolicy.baseDelayMs, 400);
    assert.equal(uploadPolicy.maxDelayMs, 5000);
    assert.equal(helper.parseDeliveryRetryAfterMs("2"), 2000);
    assert.equal(helper.computeDeliveryRetryDelayMs(2, uploadPolicy, { retryAfterMs: 0, jitterRatio: 0 }), 1600);
    assert.equal(helper.shouldFallbackUploadHttpToLegacy("upload_http_404", 404), true);
    assert.equal(helper.shouldFallbackUploadHttpToLegacy("upload_http_403", 403), false);
    assert.equal(helper.shouldFallbackUploadHttpToLegacy("upload_http_500", 500), true);
  } finally {
    await helper.cleanup();
  }
});
