import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadWorker() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-connection-worker-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/bootstrap/clientConnectionWorker.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createClientConnectionWorker !== "function") throw new Error("createClientConnectionWorker export missing");
    return { createClientConnectionWorker: mod.createClientConnectionWorker, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function makeStore(initial = {}) {
  const store = {
    state: {
      conn: "connecting",
      status: "",
      pwaUpdateAvailable: false,
      modal: { kind: "auth" },
      ...initial,
    },
    get() {
      return this.state;
    },
    set(patch) {
      this.state = typeof patch === "function" ? patch(this.state) : { ...this.state, ...patch };
      return this.state;
    },
  };
  return store;
}

test("clientConnectionWorker: blocks gateway connect when client update readiness is not connectable", async () => {
  const helper = await loadWorker();
  try {
    const store = makeStore();
    let connectCalls = 0;
    const worker = helper.createClientConnectionWorker({
      store,
      gateway: {
        connect: () => {
          connectCalls += 1;
        },
        send: () => false,
        close: () => {},
      },
      updateWorker: {
        whenClientReadyForConnection: async () => ({
          connect: false,
          reason: "update_error",
          buildId: "0.1.912-next",
          stage: "error",
        }),
      },
    });

    worker.startAfterClientUpdateReady();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(connectCalls, 0);
    assert.equal(store.state.conn, "disconnected");
    assert.equal(store.state.pwaUpdateAvailable, false);
    assert.deepEqual(store.state.modal, { kind: "auth" });
    assert.match(store.state.status, /Обновление клиента выполняется/);
  } finally {
    await helper.cleanup();
  }
});

test("clientConnectionWorker: starts gateway once after client update readiness", async () => {
  const helper = await loadWorker();
  try {
    const store = makeStore();
    let connectCalls = 0;
    const worker = helper.createClientConnectionWorker({
      store,
      gateway: {
        connect: () => {
          connectCalls += 1;
        },
        send: () => false,
        close: () => {},
      },
      updateWorker: {
        whenClientReadyForConnection: async () => ({
          connect: true,
          reason: "boot_reconciled",
          buildId: "0.1.911-current",
          stage: "idle",
        }),
      },
    });

    worker.startAfterClientUpdateReady();
    worker.startAfterClientUpdateReady();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(connectCalls, 1);
    assert.match(store.state.status, /Проверяем обновление клиента/);
  } finally {
    await helper.cleanup();
  }
});

test("clientConnectionWorker: checks desktop updater before PWA readiness and blocks on desktop update", async () => {
  const helper = await loadWorker();
  try {
    const store = makeStore();
    let connectCalls = 0;
    let desktopChecks = 0;
    let pwaChecks = 0;
    const worker = helper.createClientConnectionWorker({
      store,
      gateway: {
        connect: () => {
          connectCalls += 1;
        },
        send: () => false,
        close: () => {},
      },
      desktopUpdateWorker: {
        whenClientReadyForConnection: async () => {
          desktopChecks += 1;
          return {
            connect: false,
            reason: "desktop_update_available",
            buildId: "0.1.913",
            stage: "available",
          };
        },
      },
      updateWorker: {
        whenClientReadyForConnection: async () => {
          pwaChecks += 1;
          return {
            connect: true,
            reason: "client_update_ready",
            buildId: "0.1.913",
            stage: "idle",
          };
        },
      },
    });

    worker.startAfterClientUpdateReady();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(connectCalls, 0);
    assert.equal(desktopChecks, 1);
    assert.equal(pwaChecks, 0);
    assert.deepEqual(store.state.modal, { kind: "desktop_update" });
    assert.match(store.state.status, /Доступно desktop обновление/);
  } finally {
    await helper.cleanup();
  }
});
