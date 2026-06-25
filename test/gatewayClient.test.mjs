import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadGatewayClient() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-gateway-client-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/lib/net/gatewayClient.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.GatewayClient !== "function") throw new Error("GatewayClient export missing");
    return { GatewayClient: mod.GatewayClient, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function installRuntime() {
  const prev = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    WebSocket: Object.getOwnPropertyDescriptor(globalThis, "WebSocket"),
    dateNow: Object.getOwnPropertyDescriptor(Date, "now"),
  };
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  let nextTimerId = 1;
  let now = 1_700_000_000_000;
  const addListener = (map, type, fn) => {
    const key = String(type);
    const list = map.get(key) || [];
    list.push(fn);
    map.set(key, list);
  };
  const removeListener = (map, type, fn) => {
    const key = String(type);
    const list = map.get(key) || [];
    map.set(
      key,
      list.filter((item) => item !== fn)
    );
  };
  const emit = (map, type, event = {}) => {
    for (const fn of [...(map.get(String(type)) || [])]) fn(event);
  };
  const window = {
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, ms, interval: true });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    addEventListener: (type, fn) => addListener(windowListeners, type, fn),
    removeEventListener: (type, fn) => removeListener(windowListeners, type, fn),
  };
  const document = {
    visibilityState: "visible",
    addEventListener: (type, fn) => addListener(documentListeners, type, fn),
    removeEventListener: (type, fn) => removeListener(documentListeners, type, fn),
  };
  const navigator = { onLine: true };
  const sockets = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    readyState = FakeWebSocket.CONNECTING;
    onopen = null;
    onclose = null;
    onerror = null;
    onmessage = null;
    closed = false;
    sent = [];

    constructor(url) {
      this.url = url;
      sockets.push(this);
    }

    send(raw) {
      this.sent.push(raw);
      return undefined;
    }

    close() {
      this.closed = true;
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  Object.defineProperty(globalThis, "WebSocket", { value: FakeWebSocket, configurable: true });
  Object.defineProperty(Date, "now", { value: () => now, configurable: true });

  return {
    document,
    navigator,
    timers,
    sockets,
    advance(ms) {
      now += Math.max(0, Number(ms) || 0);
    },
    emitWindow(type, event) {
      emit(windowListeners, type, event);
    },
    emitDocument(type, event) {
      emit(documentListeners, type, event);
    },
    runTimer(predicate) {
      for (const [id, timer] of timers) {
        if (!predicate || predicate(timer)) {
          timers.delete(id);
          timer.fn();
          return timer;
        }
      }
      return null;
    },
    cleanup() {
      if (prev.window) Object.defineProperty(globalThis, "window", prev.window);
      else delete globalThis.window;
      if (prev.document) Object.defineProperty(globalThis, "document", prev.document);
      else delete globalThis.document;
      if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
      else delete globalThis.navigator;
      if (prev.WebSocket) Object.defineProperty(globalThis, "WebSocket", prev.WebSocket);
      else delete globalThis.WebSocket;
      if (prev.dateNow) Object.defineProperty(Date, "now", prev.dateNow);
    },
  };
}

test("GatewayClient: stuck WebSocket CONNECTING is bounded by connect timeout and reconnects", async () => {
  const helper = await loadGatewayClient();
  const runtime = installRuntime();
  const statuses = [];
  try {
    const client = new helper.GatewayClient(
      "wss://yagodka.example/ws",
      () => {},
      (conn, detail) => statuses.push({ conn, detail })
    );

    client.connect();
    assert.deepEqual(statuses, [{ conn: "connecting", detail: undefined }]);
    assert.equal(runtime.sockets.length, 1);

    const timeout = runtime.runTimer((timer) => timer.ms === 12_000);
    assert.ok(timeout, "connect timeout timer should be installed");
    assert.equal(runtime.sockets[0].closed, true, "stuck socket should be closed by watchdog");
    assert.deepEqual(statuses.at(-1), { conn: "disconnected", detail: "connect_timeout" });

    const statusCount = statuses.length;
    const timerCount = runtime.timers.size;
    runtime.sockets[0].onclose?.({ code: 1006, reason: "" });
    assert.equal(statuses.length, statusCount, "late close from stale socket should be ignored");
    assert.equal(runtime.timers.size, timerCount, "late close must not schedule duplicate reconnect");

    const reconnect = runtime.runTimer((timer) => timer.ms < 30_000);
    assert.ok(reconnect, "connect timeout should schedule a bounded reconnect");
    assert.equal(runtime.sockets.length, 2);
    client.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});

test("GatewayClient: open-but-dead WebSocket is closed by heartbeat watchdog", async () => {
  const helper = await loadGatewayClient();
  const runtime = installRuntime();
  const statuses = [];
  try {
    const client = new helper.GatewayClient(
      "wss://yagodka.example/ws",
      () => {},
      (conn, detail) => statuses.push({ conn, detail })
    );

    client.connect();
    const socket = runtime.sockets[0];
    socket.readyState = globalThis.WebSocket.OPEN;
    socket.onopen?.();
    assert.deepEqual(statuses.at(-1), { conn: "connected", detail: undefined });
    assert.equal(JSON.parse(socket.sent.at(-1)).type, "ping");

    runtime.advance(46_000);
    const heartbeat = runtime.runTimer((timer) => timer.interval && timer.ms === 10_000);
    assert.ok(heartbeat, "heartbeat interval should be installed");
    assert.equal(socket.closed, true, "stale open socket should be closed");
    assert.deepEqual(statuses.at(-1), { conn: "disconnected", detail: "heartbeat_timeout" });

    const statusCount = statuses.length;
    socket.onclose?.({ code: 1006, reason: "" });
    assert.equal(statuses.length, statusCount, "late close from heartbeat-killed socket should be ignored");
    const reconnect = runtime.runTimer((timer) => !timer.interval && timer.ms < 30_000);
    assert.ok(reconnect, "heartbeat timeout should schedule reconnect");
    assert.equal(runtime.sockets.length, 2);
    client.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});

test("GatewayClient: pageshow recovers a suspended CONNECTING socket without waiting for timer resume", async () => {
  const helper = await loadGatewayClient();
  const runtime = installRuntime();
  const statuses = [];
  try {
    const client = new helper.GatewayClient(
      "wss://yagodka.example/ws",
      () => {},
      (conn, detail) => statuses.push({ conn, detail })
    );

    client.connect();
    const socket = runtime.sockets[0];
    assert.equal(socket.readyState, globalThis.WebSocket.CONNECTING);
    runtime.advance(13_000);
    runtime.emitWindow("pageshow");
    assert.equal(socket.closed, true, "pageshow should close stale CONNECTING socket");
    assert.deepEqual(statuses.at(-1), { conn: "disconnected", detail: "connect_timeout" });
    const reconnect = runtime.runTimer((timer) => !timer.interval && timer.ms < 30_000);
    assert.ok(reconnect);
    assert.equal(runtime.sockets.length, 2);
    client.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});

test("GatewayClient: offline/online lifecycle closes stale socket and reconnects without reload", async () => {
  const helper = await loadGatewayClient();
  const runtime = installRuntime();
  const statuses = [];
  try {
    const client = new helper.GatewayClient(
      "wss://yagodka.example/ws",
      () => {},
      (conn, detail) => statuses.push({ conn, detail })
    );

    client.connect();
    const socket = runtime.sockets[0];
    socket.readyState = globalThis.WebSocket.OPEN;
    socket.onopen?.();
    runtime.navigator.onLine = false;
    runtime.emitWindow("offline");
    assert.equal(socket.closed, true);
    assert.deepEqual(statuses.at(-1), { conn: "disconnected", detail: "offline" });

    runtime.navigator.onLine = true;
    runtime.emitWindow("online");
    assert.equal(runtime.sockets.length, 2, "online should reconnect in the same app session");
    client.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});
