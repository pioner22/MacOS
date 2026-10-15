import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/bootstrap/lazyImportRecovery.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.isLikelyStaleLazyImportError !== "function") {
      throw new Error("isLikelyStaleLazyImportError export missing");
    }
    if (typeof mod.recoverFromLazyImportError !== "function") {
      throw new Error("recoverFromLazyImportError export missing");
    }
    if (typeof mod.__registerPwaReloadBlockerForTest !== "function") {
      throw new Error("lazyImportRecovery test reload blocker hook missing");
    }
    return {
      isLikelyStaleLazyImportError: mod.isLikelyStaleLazyImportError,
      recoverFromLazyImportError: mod.recoverFromLazyImportError,
      registerPwaReloadBlocker: mod.__registerPwaReloadBlockerForTest,
      clearPwaReloadBlockers: mod.__clearPwaReloadBlockersForTest,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("lazyImportRecovery: recognizes stale chunk-load errors", async () => {
  const helper = await loadHelper();
  try {
    assert.equal(
      helper.isLikelyStaleLazyImportError(new Error("Failed to fetch dynamically imported module: https://yagodka.org/web/assets/app-nav-deferred-old.js")),
      true
    );
    assert.equal(helper.isLikelyStaleLazyImportError({ name: "ChunkLoadError", message: "Loading chunk 7 failed." }), true);
    assert.equal(helper.isLikelyStaleLazyImportError(new Error("boom")), false);
  } finally {
    await helper.cleanup();
  }
});

test("lazyImportRecovery: triggers one controlled reload for stale lazy chunk failures", async () => {
  const helper = await loadHelper();
  const prev = {
    window: globalThis.window,
    sessionStorage: globalThis.sessionStorage,
    CustomEvent: globalThis.CustomEvent,
  };
  const session = new Map();
  const replaced = [];
  const dispatched = [];
  class CustomEventStub extends Event {
    constructor(type, init = {}) {
      super(type);
      this.detail = init.detail;
    }
  }
  globalThis.CustomEvent = CustomEventStub;
  globalThis.sessionStorage = {
    getItem(key) {
      return session.has(key) ? session.get(key) : null;
    },
    setItem(key, value) {
      session.set(String(key), String(value));
    },
  };
  globalThis.window = {
    location: {
      href: "https://yagodka.org/web/",
      replace(url) {
        replaced.push(String(url));
      },
      reload() {
        replaced.push("reload");
      },
    },
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    },
  };

  try {
    const first = helper.recoverFromLazyImportError(
      new Error("Failed to fetch dynamically imported module: https://yagodka.org/web/assets/app-chat-host-deferred-old.js"),
      "chat_surface_media"
    );
    assert.equal(first, true);
    assert.deepEqual(replaced, ["https://yagodka.org/web/"]);
    assert.equal(session.get("yagodka_lazy_import_recover_v1"), "1");
    assert.ok(Number(session.get("yagodka_lazy_import_recover_at_v1")) > 0);
    assert.ok(dispatched.includes("yagodka:pwa-sw-error"));

    const second = helper.recoverFromLazyImportError(
      new Error("Failed to fetch dynamically imported module: https://yagodka.org/web/assets/app-chat-host-deferred-old.js"),
      "chat_surface_media"
    );
    assert.equal(second, false);
    assert.deepEqual(replaced, ["https://yagodka.org/web/"]);
  } finally {
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prev.sessionStorage;
    if (prev.CustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = prev.CustomEvent;
    await helper.cleanup();
  }
});

test("lazyImportRecovery: ignores legacy recovered flag after boot flags are gone", async () => {
  const helper = await loadHelper();
  const prev = {
    window: globalThis.window,
    sessionStorage: globalThis.sessionStorage,
    CustomEvent: globalThis.CustomEvent,
  };
  const session = new Map([["yagodka_lazy_import_recover_v1", "1"]]);
  const replaced = [];
  class CustomEventStub extends Event {
    constructor(type, init = {}) {
      super(type);
      this.detail = init.detail;
    }
  }
  globalThis.CustomEvent = CustomEventStub;
  globalThis.sessionStorage = {
    getItem(key) {
      return session.has(key) ? session.get(key) : null;
    },
    setItem(key, value) {
      session.set(String(key), String(value));
    },
    removeItem(key) {
      session.delete(String(key));
    },
  };
  globalThis.window = {
    location: {
      href: "https://yagodka.org/web/",
      replace(url) {
        replaced.push(String(url));
      },
      reload() {
        replaced.push("reload");
      },
    },
    addEventListener() {},
    dispatchEvent() {
      return true;
    },
  };

  try {
    const recovered = helper.recoverFromLazyImportError(
      new Error("Failed to fetch dynamically imported module: https://yagodka.org/web/assets/page-profile-old.js"),
      "page_profile"
    );
    assert.equal(recovered, true);
    assert.deepEqual(replaced, ["https://yagodka.org/web/"]);
    assert.equal(session.get("yagodka_lazy_import_recover_v1"), "1");
    assert.ok(Number(session.get("yagodka_lazy_import_recover_at_v1")) > 0);
  } finally {
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prev.sessionStorage;
    if (prev.CustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = prev.CustomEvent;
    await helper.cleanup();
  }
});

test("lazyImportRecovery: does not force reload while PWA stability hold is active", async () => {
  const helper = await loadHelper();
  const prev = {
    window: globalThis.window,
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
    CustomEvent: globalThis.CustomEvent,
  };
  const session = new Map();
  const local = new Map();
  const replaced = [];
  class CustomEventStub extends Event {
    constructor(type, init = {}) {
      super(type);
      this.detail = init.detail;
    }
  }
  globalThis.CustomEvent = CustomEventStub;
  globalThis.sessionStorage = {
    getItem(key) {
      return session.has(key) ? session.get(key) : null;
    },
    setItem(key, value) {
      session.set(String(key), String(value));
    },
    removeItem(key) {
      session.delete(String(key));
    },
  };
  globalThis.localStorage = {
    getItem(key) {
      return local.has(key) ? local.get(key) : null;
    },
    setItem(key, value) {
      local.set(String(key), String(value));
    },
    removeItem(key) {
      local.delete(String(key));
    },
  };
  local.set(
    "yagodka_pwa_stability_hold_v1",
    JSON.stringify({ kind: "media_preview_failed", ts: Date.now(), until: Date.now() + 60_000 })
  );
  globalThis.window = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    location: {
      href: "https://yagodka.org/web/",
      replace(url) {
        replaced.push(String(url));
      },
      reload() {
        replaced.push("reload");
      },
    },
    dispatchEvent() {
      return true;
    },
  };

  try {
    const recovered = helper.recoverFromLazyImportError(
      new Error("Failed to fetch dynamically imported module: https://yagodka.org/web/assets/app-chat-host-deferred-old.js"),
      "chat_surface_media"
    );
    assert.equal(recovered, false);
    assert.deepEqual(replaced, []);
  } finally {
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prev.sessionStorage;
    if (prev.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev.localStorage;
    if (prev.CustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = prev.CustomEvent;
    await helper.cleanup();
  }
});

test("lazyImportRecovery: does not force reload while reload blockers are active", async () => {
  const helper = await loadHelper();
  const prev = {
    window: globalThis.window,
    sessionStorage: globalThis.sessionStorage,
    CustomEvent: globalThis.CustomEvent,
  };
  const session = new Map();
  const replaced = [];
  class CustomEventStub extends Event {
    constructor(type, init = {}) {
      super(type);
      this.detail = init.detail;
    }
  }
  globalThis.CustomEvent = CustomEventStub;
  globalThis.sessionStorage = {
    getItem(key) {
      return session.has(key) ? session.get(key) : null;
    },
    setItem(key, value) {
      session.set(String(key), String(value));
    },
  };
  globalThis.window = {
    location: {
      href: "https://yagodka.org/web/",
      replace(url) {
        replaced.push(String(url));
      },
      reload() {
        replaced.push("reload");
      },
    },
    dispatchEvent() {
      return true;
    },
  };

  try {
    helper.registerPwaReloadBlocker("file_get", () => true);
    const recovered = helper.recoverFromLazyImportError(
      new Error("Failed to fetch dynamically imported module: https://yagodka.org/web/assets/chat-media-surface-old.js"),
      "chat_surface_media"
    );
    assert.equal(recovered, false);
    assert.deepEqual(replaced, []);
    assert.equal(session.get("yagodka_lazy_import_recover_v1"), undefined);
  } finally {
    helper.clearPwaReloadBlockers();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prev.sessionStorage;
    if (prev.CustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = prev.CustomEvent;
    await helper.cleanup();
  }
});

test("lazy import recovery is wired into page and album deferred imports", async () => {
  const indexSrc = await readFile("src/index.ts", "utf8");
  const renderAppSrc = await readFile("src/app/renderApp.ts", "utf8");
  const mediaRuntimeSrc = await readFile("src/components/chat/chatDeferredMediaRuntime.ts", "utf8");

  assert.match(indexSrc, /recoverFromLazyImportError/);
  assert.match(indexSrc, /"app_mount"/);
  assert.match(renderAppSrc, /recoverFromLazyImportError/);
  assert.match(renderAppSrc, /`page_\$\{page\}`/);
  assert.match(renderAppSrc, /"page_help"/);
  assert.match(renderAppSrc, /"right_panel"/);
  assert.match(mediaRuntimeSrc, /recoverFromLazyImportError/);
  assert.match(mediaRuntimeSrc, /"chat_deferred_media"/);
  assert.match(mediaRuntimeSrc, /Обновляем приложение/);
});
