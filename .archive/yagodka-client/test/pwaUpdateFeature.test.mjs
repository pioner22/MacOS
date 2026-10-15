import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature(appVersion = "0.1.810") {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/pwa/pwaUpdateFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
      define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __ANDROID_APP_VERSION_NAME__: JSON.stringify("1.0.20"),
        __ANDROID_APP_VERSION_CODE__: "21",
      },
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createPwaUpdateFeature !== "function") throw new Error("createPwaUpdateFeature export missing");
    return { createPwaUpdateFeature: mod.createPwaUpdateFeature, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function makeStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      listeners.set(
        type,
        arr.filter((x) => x !== fn)
      );
    },
    dispatchEvent(event) {
      const arr = listeners.get(String(event.type)) || [];
      for (const fn of arr.slice()) fn(event);
      return true;
    },
  };
}

test("pwaUpdateFeature: update reload clears browser session carry before navigation", async () => {
  const src = await readFile(path.resolve("src/app/features/pwa/pwaUpdateFeature.ts"), "utf8");
  assert.match(src, /stashSessionTokenForReload/);
  assert.match(src, /stashSessionTokenForReload\(reason \|\| "pwa_update"\)/);
  assert.match(src, /stashSessionTokenForReload\(`pwa_reset:\$\{reason \|\| "unknown"\}`\)/);
});

test("pwaUpdateFeature: manual update has watchdog and bounded reset operations", async () => {
  const src = await readFile(path.resolve("src/app/features/pwa/pwaUpdateFeature.ts"), "utf8");
  assert.match(src, /PWA_FORCE_WATCHDOG_MS\s*=\s*12_000/);
  assert.match(src, /PWA_RESET_STEP_TIMEOUT_MS\s*=\s*4_500/);
  assert.match(src, /manual_force_watchdog_timeout/);
  assert.match(src, /Проверка обновления уже выполняется/);
  assert.match(src, /withTimeout\(navigator\.serviceWorker\.getRegistrations\(\),\s*PWA_RESET_STEP_TIMEOUT_MS/);
  assert.match(src, /withTimeout\(caches\.keys\(\),\s*PWA_RESET_STEP_TIMEOUT_MS/);
});

test("pwaUpdateFeature: PWA prompt is allowed to preempt auth, welcome and update modals", async () => {
  const src = await readFile(path.resolve("src/app/features/pwa/pwaUpdateFeature.ts"), "utf8");
  assert.match(src, /const\s+shouldOpenPwaUpdatePrompt\s*=\s*\(st:\s*AppState\):\s*boolean\s*=>\s*\{/);
  assert.match(src, /kind\s*===\s*"auth"/);
  assert.match(src, /kind\s*===\s*"welcome"/);
  assert.match(src, /kind\s*===\s*"update"/);
  assert.match(src, /kind\s*===\s*"pwa_update"/);
});

test("pwaUpdateFeature: новый BUILD_ID не подменяет clientVersion до реального reload", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/" },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => 'const BUILD_ID = "0.1.792-abcdef123456";' });

    const sendCalls = [];
    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: (payload) => sendCalls.push(payload),
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    windowStub.dispatchEvent(new CustomEventStub("yagodka:pwa-build", { detail: { buildId: "0.1.792-abcdef123456" } }));

    assert.equal(store.state.clientVersion, "0.1.791-27ef803b5f72");
    assert.equal(store.state.updateLatest, "0.1.792-abcdef123456");
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), null);
    assert.equal(sendCalls.length, 0);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: active foreground session discovers a newer live sw build", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const windowTarget = makeEventTarget();
    const documentTarget = makeEventTarget();
    const scheduled = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout(fn, ms) {
        const id = scheduled.length + 1;
        scheduled.push({ id, fn, ms, cleared: false });
        return id;
      },
      clearTimeout(id) {
        const item = scheduled.find((timer) => timer.id === id);
        if (item) item.cleared = true;
      },
    };
    const documentStub = {
      ...documentTarget,
      visibilityState: "visible",
      activeElement: null,
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "location", { value: windowStub.location, configurable: true, writable: true });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      const buildId = fetchCalls === 1 ? "0.1.927-4bd24aed1adc" : "0.1.928-foreground";
      return { ok: true, text: async () => `const BUILD_ID = "${buildId}";` };
    };

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.927-4bd24aed1adc",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    await new Promise((resolve) => setImmediate(resolve));
    const startupTimer = scheduled.find((timer) => timer.ms === 12_000 && !timer.cleared);
    assert.ok(startupTimer, "expected foreground startup timer");
    startupTimer.fn();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(store.state.updateLatest, "0.1.928-foreground");
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.match(localStorage.getItem("yagodka_pending_pwa_build_v1") || "", /0\.1\.928-foreground/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: pending prompt opens after another modal closes", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const windowTarget = makeEventTarget();
    const documentTarget = makeEventTarget();
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    const documentStub = {
      ...documentTarget,
      visibilityState: "visible",
      activeElement: null,
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "location", { value: windowStub.location, configurable: true, writable: true });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const listeners = new Set();
    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.927-4bd24aed1adc",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: { kind: "file_viewer", fileId: "photo-1", msgIdx: 0 },
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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
        for (const fn of [...listeners]) fn();
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    windowStub.dispatchEvent(new CustomEventStub("yagodka:pwa-build", { detail: { buildId: "0.1.928-modal-restore" } }));

    assert.equal(store.state.updateLatest, "0.1.928-modal-restore");
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.equal(store.state.modal.kind, "file_viewer");

    store.set({ modal: null });

    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.match(store.state.status, /Получено обновление веб-клиента/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: already visible manual prompt scheduling is idempotent", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const helper = await loadFeature();
  try {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const windowStub = {
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });

    const initialState = {
      authed: true,
      conn: "connected",
      selfId: "111",
      clientVersion: "0.1.927-4bd24aed1adc",
      updateLatest: "0.1.928-loop-guard",
      pwaUpdateAvailable: true,
      pwaUpdate: {
        stage: "available",
        buildId: "0.1.928-loop-guard",
        message: "Получено обновление веб-клиента",
        detail: "Можно обновить сейчас или отложить до перезапуска. Подключение к серверу продолжит работать.",
        progress: 16,
        error: null,
        userDecision: "pending",
        updatedAt: Date.now(),
      },
      status: "Получено обновление веб-клиента. Откройте обновление вручную, когда приложение не используется.",
      fileTransfers: [],
      historyLoading: {},
      modal: { kind: "pwa_update" },
      editing: null,
      replyDraft: null,
      forwardDraft: null,
      chatSelection: null,
    };
    const store = {
      state: initialState,
      notifications: 0,
      get() {
        return this.state;
      },
      set(patch) {
        const prev = this.state;
        const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
        if (Object.is(next, prev)) return;
        this.state = next;
        this.notifications += 1;
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    feature.scheduleAutoApplyPwaUpdate();

    assert.equal(store.notifications, 0);
    assert.equal(store.state, initialState);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: active full BUILD_ID is treated as current and does not auto-reload", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/" },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });

    const sendCalls = [];
    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.810-9cefc391f20b",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: (payload) => sendCalls.push(payload),
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    windowStub.dispatchEvent(new CustomEventStub("yagodka:pwa-build", { detail: { buildId: "0.1.810-9cefc391f20b" } }));

    assert.equal(store.state.updateLatest, null);
    assert.equal(store.state.pwaUpdateAvailable, false);
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), "0.1.810-9cefc391f20b");
    assert.equal(pendingTimers.length, 0);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].version, "0.1.810-9cefc391f20b");
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: same-version sw update event is verified before showing prompt", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature("0.1.810");
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => 'const BUILD_ID = "0.1.810-abcdef123456";' });

    const sendCalls = [];
    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.810",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: (payload) => sendCalls.push(payload),
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    windowStub.dispatchEvent(new EventStub("yagodka:pwa-update"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(store.state.clientVersion, "0.1.810-abcdef123456");
    assert.equal(store.state.updateLatest, null);
    assert.equal(store.state.pwaUpdateAvailable, false);
    assert.equal(store.state.modal, null);
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), "0.1.810-abcdef123456");
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].version, "0.1.810-abcdef123456");
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: standalone PWA keeps updates manual and does not auto-reload", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const helper = await loadFeature();
  try {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const windowStub = {
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/" },
      matchMedia(query) {
        return { matches: String(query).includes("display-mode: standalone") };
      },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    feature.scheduleAutoApplyPwaUpdate(1);
    assert.equal(pendingTimers.length, 0);
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.match(store.state.status, /Откройте обновление вручную/);
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), null);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: pending build from startup gate opens manual update prompt", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    sessionStorage.setItem("yagodka_pending_pwa_build_v1", JSON.stringify({ buildId: "0.1.792-abcdef123456", ts: Date.now() }));
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { serviceWorker: { getRegistration: async () => null, ready: Promise.resolve(null) } },
      configurable: true,
      writable: true,
    });
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(store.state.updateLatest, "0.1.792-abcdef123456");
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.match(store.state.status, /Можно обновить сейчас или позже/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: pending manual update does not block connection readiness", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const windowStub = {
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const store = {
      state: {
        authed: true,
        conn: "disconnected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        pwaUpdate: {
          stage: "available",
          buildId: "0.1.792-abcdef123456",
          message: "Доступно обновление веб-клиента",
          detail: "Нажмите «Обновить», когда будет удобно.",
          progress: 16,
          error: null,
          userDecision: "pending",
          updatedAt: Date.now(),
        },
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: { kind: "pwa_update" },
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    const readiness = await feature.whenClientReadyForConnection();

    assert.equal(readiness.connect, true);
    assert.equal(readiness.reason, "update_pending_nonblocking");
    assert.equal(readiness.buildId, "0.1.792-abcdef123456");
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: stale active update stage falls back to a nonblocking manual prompt", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const windowStub = {
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const store = {
      state: {
        authed: true,
        conn: "disconnected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        pwaUpdate: {
          stage: "applying",
          buildId: "0.1.792-abcdef123456",
          message: "Применяем обновление веб-клиента",
          detail: "",
          progress: 74,
          error: null,
          userDecision: "accepted",
          updatedAt: Date.now(),
        },
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: { kind: "pwa_update" },
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    const readiness = await feature.whenClientReadyForConnection();

    assert.equal(readiness.connect, true);
    assert.equal(readiness.reason, "update_busy_nonblocking");
    assert.equal(readiness.buildId, "0.1.792-abcdef123456");
    assert.equal(readiness.stage, "applying");
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.equal(store.state.pwaUpdate.stage, "available");
    assert.equal(store.state.pwaUpdate.userDecision, "pending");
    assert.match(store.state.pwaUpdate.detail, /отложить до перезапуска/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: deferred manual update stays deferred and does not reopen prompt", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const helper = await loadFeature();
  try {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const windowStub = {
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        pwaUpdate: {
          stage: "available",
          buildId: "0.1.792-abcdef123456",
          message: "Получено обновление веб-клиента",
          detail: "Можно обновить сейчас или позже.",
          progress: 16,
          error: null,
          userDecision: "pending",
          updatedAt: Date.now(),
        },
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: { kind: "pwa_update" },
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    feature.deferPwaUpdate();
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.equal(store.state.modal, null);
    assert.equal(store.state.pwaUpdate.stage, "available");
    assert.equal(store.state.pwaUpdate.userDecision, "later");
    assert.match(store.state.status, /отложено до перезапуска/);

    feature.scheduleAutoApplyPwaUpdate(1);
    assert.equal(pendingTimers.length, 0);
    assert.equal(store.state.modal, null);
    assert.equal(store.state.pwaUpdate.userDecision, "later");
    assert.match(store.state.status, /отложено до перезапуска/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: manual update does not blind-reload when new build is not confirmed", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const replaceCalls = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: {
        href: "https://yagodka.org/web/",
        protocol: "https:",
        replace(url) {
          replaceCalls.push(String(url));
        },
        reload() {
          replaceCalls.push("reload");
        },
      },
      setTimeout(fn) {
        fn();
        return 1;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    const reg = {
      waiting: null,
      active: { postMessage() {} },
      installing: null,
      update: async () => new Promise(() => {}),
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => reg,
          ready: Promise.resolve(reg),
          addEventListener() {},
          removeEventListener() {},
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "location", { value: windowStub.location, configurable: true, writable: true });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: { kind: "pwa_update" },
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    await feature.applyPwaUpdateNow({ mode: "manual" });

    assert.deepEqual(replaceCalls, []);
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.match(store.state.status, /Не удалось проверить загрузку обновления/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: media stability hold keeps update manual without auto-apply timer", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const replaceCalls = [];
    localStorage.setItem(
      "yagodka_pwa_stability_hold_v1",
      JSON.stringify({ kind: "media_preview_failed", ts: Date.now(), until: Date.now() + 60_000 })
    );
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: {
        href: "https://yagodka.org/web/",
        replace(url) {
          replaceCalls.push(String(url));
        },
        reload() {
          replaceCalls.push("reload");
        },
      },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    feature.scheduleAutoApplyPwaUpdate(1);
    assert.equal(pendingTimers.length, 0);
    assert.deepEqual(replaceCalls, []);
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.match(store.state.status, /Откройте обновление вручную/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: manual update resets stale waiting worker after confirmed build", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const replaceCalls = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: {
        href: "https://yagodka.org/web/",
        protocol: "https:",
        replace(url) {
          replaceCalls.push(String(url));
        },
        reload() {
          replaceCalls.push("reload");
        },
      },
      setTimeout(fn) {
        fn();
        return 1;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    const waitingWorker = {
      state: "installed",
      postMessage() {},
      addEventListener() {},
      removeEventListener() {},
    };
    const swRegistration = {
      waiting: waitingWorker,
      active: null,
      installing: null,
      unregister: async () => true,
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: null,
          addEventListener() {},
          removeEventListener() {},
          getRegistration: async () => swRegistration,
          getRegistrations: async () => [swRegistration],
          ready: Promise.resolve(swRegistration),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "location", { value: windowStub.location, configurable: true, writable: true });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => 'const BUILD_ID = "0.1.792-abcdef123456";' });

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: { kind: "pwa_update" },
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    await feature.applyPwaUpdateNow({ mode: "manual" });

    assert.equal(replaceCalls.length, 1);
    assert.match(replaceCalls[0], /__pwa_reset=/);
    assert.match(store.state.status, /Сбрасываем зависшее PWA обновление/);
    assert.equal(sessionStorage.getItem("yagodka_updating"), "1");
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: pending file activity keeps update manual without auto-apply timer", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const replaceCalls = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: {
        href: "https://yagodka.org/web/",
        protocol: "https:",
        replace(url) {
          replaceCalls.push(String(url));
        },
        reload() {
          replaceCalls.push("reload");
        },
      },
      setTimeout(fn, _ms) {
        if (Number(_ms) >= 8000) {
          queueMicrotask(fn);
          return 999;
        }
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    const swStateListeners = [];
    const controllerChangeListeners = [];
    const waitingWorker = {
      state: "installed",
      postMessage() {
        queueMicrotask(() => {
          this.state = "activated";
          for (const fn of swStateListeners.slice()) fn();
          for (const fn of controllerChangeListeners.slice()) fn();
        });
      },
      addEventListener(type, fn) {
        if (type === "statechange") swStateListeners.push(fn);
      },
      removeEventListener(type, fn) {
        if (type !== "statechange") return;
        const idx = swStateListeners.indexOf(fn);
        if (idx >= 0) swStateListeners.splice(idx, 1);
      },
    };
    const swRegistration = { waiting: waitingWorker, active: null, installing: null };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          addEventListener(type, fn) {
            if (type === "controllerchange") controllerChangeListeners.push(fn);
          },
          removeEventListener(type, fn) {
            if (type !== "controllerchange") return;
            const idx = controllerChangeListeners.indexOf(fn);
            if (idx >= 0) controllerChangeListeners.splice(idx, 1);
          },
          getRegistration: async () => swRegistration,
          ready: Promise.resolve(swRegistration),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "location", { value: windowStub.location, configurable: true, writable: true });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
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

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => true,
    });

    feature.scheduleAutoApplyPwaUpdate(1);
    assert.equal(pendingTimers.length, 0);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(replaceCalls, []);
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.match(store.state.status, /Откройте обновление вручную/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    await helper.cleanup();
  }
});
