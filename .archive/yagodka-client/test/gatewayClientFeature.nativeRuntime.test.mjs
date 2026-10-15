import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

function mkStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(String(key)) ? data.get(String(key)) : null),
    setItem: (key, value) => {
      data.set(String(key), String(value));
    },
    removeItem: (key) => {
      data.delete(String(key));
    },
    clear: () => {
      data.clear();
    },
  };
}

function makeStore(initial) {
  let state = { ...initial };
  let setCalls = 0;
  return {
    get: () => state,
    set: (patch) => {
      setCalls += 1;
      state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
      return state;
    },
    getSetCalls: () => setCalls,
  };
}

function stubRuntime({ native = false, standalone = false, desktop = false, webSocketClass = undefined } = {}) {
  const prev = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
    BroadcastChannel: Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel"),
    WebSocket: Object.getOwnPropertyDescriptor(globalThis, "WebSocket"),
    Capacitor: Object.getOwnPropertyDescriptor(globalThis, "Capacitor"),
  };

  let channelConstructed = 0;
  class FakeBroadcastChannel {
    constructor() {
      channelConstructed += 1;
    }
    addEventListener() {}
    postMessage() {}
    close() {}
  }

  const localStorage = mkStorage();
  const sessionStorage = mkStorage();
  const document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
    hasFocus: () => true,
  };
  const window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    matchMedia: (query) => ({ matches: standalone && /display-mode:\s*(standalone|fullscreen)/.test(String(query || "")) }),
    ...(desktop ? { yagodkaDesktop: { platform: "darwin" } } : {}),
  };
  const navigator = {
    standalone,
    locks: {
      request: async (_name, arg1, arg2) => {
        const cb = typeof arg1 === "function" ? arg1 : arg2;
        if (typeof cb === "function") return await cb({});
        return undefined;
      },
    },
  };
  const Capacitor = native
    ? {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      }
    : undefined;

  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true });
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  Object.defineProperty(globalThis, "BroadcastChannel", { value: FakeBroadcastChannel, configurable: true });
  if (webSocketClass) Object.defineProperty(globalThis, "WebSocket", { value: webSocketClass, configurable: true });
  if (Capacitor) Object.defineProperty(globalThis, "Capacitor", { value: Capacitor, configurable: true });
  else delete globalThis.Capacitor;

  return {
    getChannelConstructed: () => channelConstructed,
    cleanup: () => {
      if (prev.window) Object.defineProperty(globalThis, "window", prev.window);
      else delete globalThis.window;
      if (prev.document) Object.defineProperty(globalThis, "document", prev.document);
      else delete globalThis.document;
      if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
      else delete globalThis.navigator;
      if (prev.localStorage) Object.defineProperty(globalThis, "localStorage", prev.localStorage);
      else delete globalThis.localStorage;
      if (prev.sessionStorage) Object.defineProperty(globalThis, "sessionStorage", prev.sessionStorage);
      else delete globalThis.sessionStorage;
      if (prev.BroadcastChannel) Object.defineProperty(globalThis, "BroadcastChannel", prev.BroadcastChannel);
      else delete globalThis.BroadcastChannel;
      if (prev.WebSocket) Object.defineProperty(globalThis, "WebSocket", prev.WebSocket);
      else delete globalThis.WebSocket;
      if (prev.Capacitor) Object.defineProperty(globalThis, "Capacitor", prev.Capacitor);
      else delete globalThis.Capacitor;
    },
  };
}

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/net/gatewayClientFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createGatewayClientFeature !== "function") {
      throw new Error("gatewayClientFeature export missing");
    }
    return {
      createGatewayClientFeature: mod.createGatewayClientFeature,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function makeDeps(store) {
  return {
    store,
    getGatewayUrl: () => "wss://yagodka.example/ws",
    clearPendingHistoryRequests: () => {},
    handleHistoryResultMessage: () => {},
    dispatchServerMessage: () => {},
    scheduleSaveOutbox: () => {},
    onAuthed: () => {},
    maybeAutoAuthOnConnected: () => {},
  };
}

function makeFakeWebSocket() {
  const instances = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    readyState = FakeWebSocket.CONNECTING;
    onopen = null;
    onclose = null;
    onerror = null;
    onmessage = null;

    constructor(url) {
      this.url = url;
      instances.push(this);
    }

    send() {
      return undefined;
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }
  return { FakeWebSocket, instances };
}

test("gatewayClientFeature: native runtime bypasses multiplex gateway even when browser locks are available", async () => {
  const helper = await loadFeature();
  const runtime = stubRuntime({ native: true });
  try {
    const store = makeStore({
      netLeader: false,
      authed: false,
      selfId: null,
      outbox: {},
      conversations: {},
      conn: "connecting",
      status: "",
      modal: null,
    });
    const { gateway } = helper.createGatewayClientFeature(makeDeps(store));
    assert.equal(runtime.getChannelConstructed(), 0, "native runtime should not open BroadcastChannel for gateway leadership");
    assert.equal(gateway.getRole?.(), "solo");
    assert.equal(store.get().netLeader, true);
    gateway.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});

test("gatewayClientFeature: standalone PWA bypasses multiplex to avoid stale browser-tab leadership", async () => {
  const helper = await loadFeature();
  const runtime = stubRuntime({ standalone: true });
  try {
    const store = makeStore({
      netLeader: false,
      authed: false,
      selfId: null,
      outbox: {},
      conversations: {},
      conn: "connecting",
      status: "",
      modal: null,
    });
    const { gateway } = helper.createGatewayClientFeature(makeDeps(store));
    assert.equal(runtime.getChannelConstructed(), 0, "standalone PWA should keep its own gateway socket");
    assert.equal(gateway.getRole?.(), "solo");
    assert.equal(store.get().netLeader, true);
    gateway.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});

test("gatewayClientFeature: Electron desktop bridge bypasses multiplex even with browser locks", async () => {
  const helper = await loadFeature();
  const runtime = stubRuntime({ desktop: true });
  try {
    const store = makeStore({
      netLeader: false,
      authed: false,
      selfId: null,
      outbox: {},
      conversations: {},
      conn: "connecting",
      status: "",
      modal: null,
    });
    const { gateway } = helper.createGatewayClientFeature(makeDeps(store));
    assert.equal(runtime.getChannelConstructed(), 0, "desktop runtime should not share gateway leadership with browser tabs");
    assert.equal(gateway.getRole?.(), "solo");
    assert.equal(store.get().netLeader, true);
    gateway.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});

test("gatewayClientFeature: browser runtime still keeps multiplex path when locks are available", async () => {
  const helper = await loadFeature();
  const runtime = stubRuntime({ native: false });
  try {
    const store = makeStore({
      netLeader: false,
      authed: false,
      selfId: null,
      outbox: {},
      conversations: {},
      conn: "connecting",
      status: "",
      modal: null,
    });
    const { gateway } = helper.createGatewayClientFeature(makeDeps(store));
    assert.equal(runtime.getChannelConstructed(), 1, "browser runtime should still initialize BroadcastChannel multiplexing");
    assert.notEqual(gateway.getRole?.(), "solo");
    gateway.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});

test("MultiplexGatewayClient: follower has stale-leader watchdog for visible connected tabs", async () => {
  const src = await readFile(path.resolve("src/lib/net/multiplexGatewayClient.ts"), "utf8");
  assert.match(src, /leaderStaleMs\s*=\s*Math\.max\(this\.heartbeatMs\s*\*\s*3,\s*6500\)/);
  assert.match(src, /followerWatchdogTimer/);
  assert.match(src, /checkLeaderHealth/);
  assert.match(src, /leader_recovery/);
  assert.match(src, /this\.post\(\{\s*t:\s*"connect"/);
  assert.match(src, /leaderAcquireInFlight/);
  assert.match(src, /window\.addEventListener\("focus",\s*this\.focusHandler\)/);
  assert.match(src, /window\.addEventListener\("pageshow",\s*this\.pageShowHandler\)/);
  assert.match(src, /window\.addEventListener\("online",\s*this\.onlineHandler\)/);
  assert.match(src, /onRuntimeWake\(\)/);
});

test("gatewayClientFeature: duplicate disconnected status does not rewrite store", async () => {
  const helper = await loadFeature();
  const fakeWs = makeFakeWebSocket();
  const runtime = stubRuntime({ native: true, webSocketClass: fakeWs.FakeWebSocket });
  let saveOutboxCalls = 0;
  try {
    const store = makeStore({
      netLeader: true,
      authed: false,
      selfId: null,
      outbox: {},
      conversations: {},
      conn: "connecting",
      status: "Подключение…",
      modal: { kind: "auth" },
    });
    const { gateway } = helper.createGatewayClientFeature({
      ...makeDeps(store),
      scheduleSaveOutbox: () => {
        saveOutboxCalls += 1;
      },
    });

    gateway.connect();
    assert.equal(store.getSetCalls(), 0, "same connecting state should be ignored");
    assert.equal(fakeWs.instances.length, 1);

    fakeWs.instances[0].onclose?.({ code: 1006, reason: "" });
    assert.equal(store.getSetCalls(), 1, "first disconnect should update visible network state once");
    assert.equal(store.get().conn, "disconnected");

    gateway.connect();
    assert.equal(fakeWs.instances.length, 2);
    assert.equal(store.getSetCalls(), 1, "auth retry connecting state should stay visually stable");

    fakeWs.instances[0].onclose?.({ code: 1006, reason: "" });
    assert.equal(store.getSetCalls(), 1, "duplicate disconnect should not trigger another store write");
    fakeWs.instances[1].onclose?.({ code: 1006, reason: "" });
    assert.equal(store.getSetCalls(), 1, "retry disconnect with same visible status should not trigger another store write");
    assert.equal(saveOutboxCalls, 0, "unchanged outbox should not schedule persistence on duplicate disconnect");
    gateway.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});
