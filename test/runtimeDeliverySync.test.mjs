import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRuntimeDeliverySync() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/runtime/deliverySync.ts")],
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

test("runtimeDeliverySync: cache snapshots переводят drafts/transfers/outbox в loaded cache owner", async () => {
  const helper = await loadRuntimeDeliverySync();
  try {
    let next = {
      drafts: {},
      fileTransfers: [],
      outbox: {},
      deliverySync: helper.createRuntimeDeliverySyncState(),
    };
    next = helper.applyDraftMapSnapshot(next, { "dm:u-1": "hello" }, { source: "cache", reconcilePending: true });
    next = helper.applyFileTransferSnapshot(
      next,
      [{ localId: "ft-1", id: "f-1", name: "a.jpg", size: 1, direction: "in", peer: "u-1", status: "complete", progress: 100 }],
      { source: "cache", reconcilePending: true }
    );
    next = helper.applyOutboxSnapshot(
      next,
      { "dm:u-1": [{ localId: "o-1", ts: 1, text: "queued", to: "u-1", status: "queued" }] },
      { source: "cache", reconcilePending: true }
    );
    assert.equal(next.deliverySync.drafts.loaded, true);
    assert.equal(next.deliverySync.drafts.source, "cache");
    assert.equal(next.deliverySync.drafts.reconcilePending, true);
    assert.equal(next.deliverySync.fileTransfers.loaded, true);
    assert.equal(next.deliverySync.fileTransfers.source, "cache");
    assert.equal(next.deliverySync.outbox.loaded, true);
    assert.equal(next.deliverySync.outbox.source, "cache");
  } finally {
    await helper.cleanup();
  }
});

test("runtimeDeliverySync: local mutations проходят через единый owner и обновляют lastLocalAt", async () => {
  const helper = await loadRuntimeDeliverySync();
  try {
    let next = {
      drafts: { "dm:u-1": "a" },
      fileTransfers: [{ localId: "ft-1", id: "f-1", name: "a.jpg", size: 1, direction: "in", peer: "u-1", status: "complete", progress: 100 }],
      outbox: { "dm:u-1": [{ localId: "o-1", ts: 1, text: "queued", to: "u-1", status: "queued" }] },
      deliverySync: helper.createRuntimeDeliverySyncState({
        drafts: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1 },
        fileTransfers: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1 },
        outbox: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1 },
      }),
    };
    next = helper.applyDraftMapMutation(next, { "dm:u-1": "b" });
    next = helper.applyFileTransferMutation(
      next,
      [
        { localId: "upload-1", id: null, name: "b.mov", size: 3, direction: "out", peer: "u-2", status: "uploading", progress: 35 },
        { localId: "ft-1", id: "f-1", name: "a.jpg", size: 1, direction: "in", peer: "u-1", status: "error", progress: 100 },
      ]
    );
    next = helper.applyOutboxMutation(
      next,
      { "dm:u-1": [{ localId: "o-1", ts: 1, text: "queued", to: "u-1", status: "sending" }] }
    );
    assert.equal(next.deliverySync.drafts.source, "server");
    assert.equal(next.deliverySync.fileTransfers.source, "server");
    assert.equal(next.deliverySync.outbox.source, "server");
    assert.equal(next.fileTransfers.length, 2);
    assert.equal(next.fileTransfers[0].status, "uploading");
    assert.equal(next.fileTransfers[0].id, null);
    assert.equal(typeof next.deliverySync.drafts.lastLocalAt, "number");
    assert.equal(typeof next.deliverySync.fileTransfers.lastLocalAt, "number");
    assert.equal(typeof next.deliverySync.outbox.lastLocalAt, "number");
  } finally {
    await helper.cleanup();
  }
});
