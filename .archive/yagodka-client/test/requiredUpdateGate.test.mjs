import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadGate(appVersion = "0.1.809") {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/bootstrap/requiredUpdateGate.ts")],
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
        "import.meta.env.DEV": "false",
      },
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.runRequiredUpdateGate !== "function") throw new Error("runRequiredUpdateGate export missing");
    return {
      parseBuildIdFromServiceWorker: mod.parseBuildIdFromServiceWorker,
      isRequiredUpdateNeeded: mod.isRequiredUpdateNeeded,
      runRequiredUpdateGate: mod.runRequiredUpdateGate,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function makeStorage(initial = []) {
  const data = new Map(initial);
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
    dump() {
      return new Map(data);
    },
  };
}

function makeElement(tag = "div") {
  return {
    tag,
    className: "",
    textContent: "",
    type: "",
    style: {},
    children: [],
    attrs: {},
    setAttribute(key, value) {
      this.attrs[String(key)] = String(value);
    },
    addEventListener() {},
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = [...items];
    },
  };
}

function collectText(el) {
  const parts = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.textContent) parts.push(String(node.textContent));
    for (const child of node.children || []) walk(child);
  };
  walk(el);
  return parts.join(" ");
}

async function withBrowserStubs(fn) {
  const prev = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
    fetch: globalThis.fetch,
  };
  try {
    return await fn();
  } finally {
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
    globalThis.fetch = prev.fetch;
  }
}

test("requiredUpdateGate: parses BUILD_ID and compares only known full build hashes", async () => {
  const gate = await loadGate("0.1.810");
  try {
    assert.equal(gate.parseBuildIdFromServiceWorker('const BUILD_ID = "0.1.810-abcdef123456";'), "0.1.810-abcdef123456");
    assert.equal(gate.isRequiredUpdateNeeded("0.1.809-a3f3e6e46bee", "0.1.810-abcdef123456"), true);
    assert.equal(gate.isRequiredUpdateNeeded("0.1.810", "0.1.810-abcdef123456"), false);
    assert.equal(gate.isRequiredUpdateNeeded("0.1.810-111111111111", "0.1.810-abcdef123456"), true);
  } finally {
    await gate.cleanup();
  }
});

test("requiredUpdateGate: current version stores live build and lets app mount", async () => {
  const gate = await loadGate("0.1.810");
  await withBrowserStubs(async () => {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage,
        sessionStorage,
        location: { href: "https://yagodka.org/web/" },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: { createElement: makeElement }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => 'const BUILD_ID = "0.1.810-abcdef123456";' });

    const root = makeElement("div");
    const result = await gate.runRequiredUpdateGate(root);
    assert.deepEqual(result, { blocked: false, liveBuildId: "0.1.810-abcdef123456", reason: "current" });
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), "0.1.810-abcdef123456");
    assert.equal(root.children.length, 0);
  });
  await gate.cleanup();
});

test("requiredUpdateGate: current hashed bundle ignores stale stored build from same version", async () => {
  const gate = await loadGate("0.1.810-abcdef123456");
  await withBrowserStubs(async () => {
    const localStorage = makeStorage([["yagodka_active_build_id_v1", "0.1.810-111111111111"]]);
    const sessionStorage = makeStorage();
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage,
        sessionStorage,
        location: { href: "https://yagodka.org/web/" },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: { createElement: makeElement }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => 'const BUILD_ID = "0.1.810-abcdef123456";' });

    const root = makeElement("div");
    const result = await gate.runRequiredUpdateGate(root);
    assert.deepEqual(result, { blocked: false, liveBuildId: "0.1.810-abcdef123456", reason: "current" });
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), "0.1.810-abcdef123456");
    assert.equal(sessionStorage.getItem("yagodka_required_update_gate_bypass_v1"), null);
    assert.equal(root.children.length, 0);
  });
  await gate.cleanup();
});

test("requiredUpdateGate: opens current app and updates stale PWA in background", async () => {
  const gate = await loadGate("0.1.809");
  await withBrowserStubs(async () => {
    const localStorage = makeStorage([["yagodka_active_build_id_v1", "0.1.809-a3f3e6e46bee"]]);
    const sessionStorage = makeStorage();
    const replaced = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage,
        sessionStorage,
        location: {
          href: "https://yagodka.org/web/?room=1",
          replace(url) {
            replaced.push(String(url));
          },
          reload() {
            replaced.push("reload");
          },
        },
        setTimeout(fn, ms) {
          if (Number(ms) <= 900) {
            fn();
            return 1;
          }
          return globalThis.setTimeout(fn, ms);
        },
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: { createElement: makeElement }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => 'const BUILD_ID = "0.1.810-abcdef123456";' });

    const root = makeElement("div");
    const result = await gate.runRequiredUpdateGate(root);
    assert.equal(result.blocked, false);
    assert.equal(result.liveBuildId, "0.1.810-abcdef123456");
    assert.equal(result.reason, "update_required");
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), "0.1.809-a3f3e6e46bee");
    assert.equal(sessionStorage.getItem("yagodka_updating"), null);
    assert.equal(sessionStorage.getItem("yagodka_force_recover"), null);
    assert.equal(root.children.length, 0);
    assert.equal(replaced.length, 0);
    assert.equal(sessionStorage.getItem("yagodka_required_update_gate_bypass_v1"), null);
    assert.match(sessionStorage.getItem("yagodka_pending_pwa_build_v1"), /0\.1\.810-abcdef123456/);
  });
  await gate.cleanup();
});

test("requiredUpdateGate: repeated stale build still opens without automatic reload loop", async () => {
  const gate = await loadGate("0.1.809");
  await withBrowserStubs(async () => {
    const liveBuildId = "0.1.810-abcdef123456";
    const guard = JSON.stringify({ buildId: liveBuildId, tries: 3, ts: Date.now() });
    const localStorage = makeStorage([["yagodka_required_update_gate_v1", guard]]);
    const sessionStorage = makeStorage([["yagodka_required_update_gate_v1", guard]]);
    const replaced = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage,
        sessionStorage,
        location: {
          href: "https://yagodka.org/web/",
          replace(url) {
            replaced.push(String(url));
          },
          reload() {
            replaced.push("reload");
          },
        },
        setTimeout(fn, ms) {
          if (Number(ms) === 900) {
            fn();
            return 1;
          }
          return globalThis.setTimeout(fn, ms);
        },
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: { createElement: makeElement }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => `const BUILD_ID = "${liveBuildId}";` });

    const root = makeElement("div");
    const result = await gate.runRequiredUpdateGate(root);
    assert.equal(result.blocked, false);
    assert.equal(result.reason, "update_required");
    assert.equal(replaced.length, 0);
    assert.equal(root.children.length, 0);
    assert.equal(sessionStorage.getItem("yagodka_required_update_gate_bypass_v1"), null);
    assert.match(sessionStorage.getItem("yagodka_pending_pwa_build_v1"), /0\.1\.810-abcdef123456/);
  });
  await gate.cleanup();
});

test("requiredUpdateGate: hard timeout opens app when live build probe hangs", async () => {
  const gate = await loadGate("0.1.810");
  await withBrowserStubs(async () => {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage,
        sessionStorage,
        location: { href: "https://yagodka.org/web/" },
        setTimeout(fn) {
          fn();
          return 1;
        },
        clearTimeout() {},
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: makeElement,
        documentElement: { classList: { add() {}, remove() {} } },
        body: { classList: { add() {}, remove() {} } },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    globalThis.fetch = async () => new Promise(() => {});

    const root = makeElement("div");
    const result = await gate.runRequiredUpdateGate(root);
    assert.deepEqual(result, { blocked: false, liveBuildId: "", reason: "fetch_failed" });
    assert.equal(root.children.length, 0);
  });
  await gate.cleanup();
});

test("requiredUpdateGate: session bypass opens current bundle without another reload", async () => {
  const gate = await loadGate("0.1.809");
  await withBrowserStubs(async () => {
    const liveBuildId = "0.1.810-abcdef123456";
    const localStorage = makeStorage();
    const sessionStorage = makeStorage([
      ["yagodka_required_update_gate_bypass_v1", JSON.stringify({ buildId: liveBuildId, ts: Date.now() })],
    ]);
    const replaced = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage,
        sessionStorage,
        history: { state: null, replaceState() {} },
        location: {
          href: "https://yagodka.org/web/?__yg_continue=1",
          replace(url) {
            replaced.push(String(url));
          },
          reload() {
            replaced.push("reload");
          },
        },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { createElement: makeElement, title: "Yagodka" },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => `const BUILD_ID = "${liveBuildId}";` });

    const root = makeElement("div");
    const result = await gate.runRequiredUpdateGate(root);
    assert.deepEqual(result, { blocked: false, liveBuildId, reason: "reload_failed" });
    assert.equal(replaced.length, 0);
    assert.equal(root.children.length, 0);
  });
  await gate.cleanup();
});

test("requiredUpdateGate: current boot removes one-shot update/reset query params", async () => {
  const gate = await loadGate("0.1.810");
  await withBrowserStubs(async () => {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const replaced = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage,
        sessionStorage,
        history: {
          state: { ok: true },
          replaceState(state, title, url) {
            replaced.push({ state, title, url: String(url) });
          },
        },
        location: { href: "https://yagodka.org/web/?__pwa_reset=1780405479877&__yg_update=42&room=1" },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { createElement: makeElement, title: "Yagodka" },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => 'const BUILD_ID = "0.1.810-abcdef123456";' });

    const root = makeElement("div");
    const result = await gate.runRequiredUpdateGate(root);
    assert.equal(result.blocked, false);
    assert.equal(replaced.length, 1);
    assert.equal(replaced[0].url, "https://yagodka.org/web/?room=1");
  });
  await gate.cleanup();
});

test("requiredUpdateGate: index waits for the gate before importing mountApp", async () => {
  const src = await readFile(path.resolve("src/index.ts"), "utf8");
  assert.match(src, /runRequiredUpdateGate\(appRoot\)/);
  assert.doesNotMatch(src, /if \(result\.blocked\) return;/);
  assert.match(src, /mountRuntime\(\)/);
});

test("requiredUpdateGate: update surface has animated taskbar and finite fallback controls", async () => {
  const css = await readFile(path.resolve("src/scss/service-surfaces.css"), "utf8");
  const gate = await readFile(path.resolve("src/app/bootstrap/requiredUpdateGate.ts"), "utf8");
  assert.match(css, /--required-update-text:\s*#14211b/);
  assert.match(css, /--required-update-bg:\s*#f7fafc/);
  assert.match(css, /html\.required-update-active/);
  assert.match(css, /\.required-update-gate__taskbar/);
  assert.match(css, /\.required-update-gate__steps/);
  assert.match(css, /\.required-update-gate__step--active::before/);
  assert.match(css, /color:\s*var\(--required-update-pending\)/);
  assert.match(css, /background:\s*#dce6e1/);
  assert.match(css, /@keyframes\s+required-update-spin/);
  assert.match(css, /@keyframes\s+required-update-bar/);
  assert.match(css, /\.required-update-gate--failed\s+\.required-update-gate__spinner/);
  assert.match(gate, /UPDATE_GATE_MIN_STEP_MS/);
  assert.match(gate, /showGateStep/);
  assert.match(gate, /writePendingPwaBuild\(liveBuildId\)/);
  assert.doesNotMatch(gate, /writeBypass\(liveBuildId\);\s*await showGateStep\(root,\s*setGateReloading\)/);
  assert.match(gate, /setGateLaunchReady/);
});

test("requiredUpdateGate: boot and service worker recovery are early and bounded", async () => {
  const boot = await readFile(path.resolve("public/boot.js"), "utf8");
  assert.match(boot, /boot-recovery/);
  assert.match(boot, /boot-recovery__version/);
  assert.match(boot, /yagodka-build-id/);
  assert.match(boot, /LEGACY_UPDATE_TEXT_RE/);
  assert.match(boot, /STALE_BOOT_BUILD_RE/);
  assert.match(boot, /Сбрасываем старый кэш приложения перед запуском новой версии/);
  assert.match(boot, /readCurrentBuildId/);
  assert.match(boot, /fetchLiveBuildId/);
  assert.match(boot, /LIVE_BUILD_TIMEOUT_MS/);
  assert.match(boot, /BOOT_RECOVERY_STEP_TIMEOUT_MS/);
  assert.match(boot, /AbortController/);
  assert.match(boot, /withTimeout\(navigator\.serviceWorker\.getRegistrations\(\),\s*BOOT_RECOVERY_STEP_TIMEOUT_MS/);
  assert.match(boot, /withTimeout\(caches\.keys\(\),\s*BOOT_RECOVERY_STEP_TIMEOUT_MS/);
  assert.match(boot, /withTimeout\(r\.unregister\(\),\s*1200/);
  assert.match(boot, /withTimeout\(caches\.delete\(k\),\s*1200/);
  assert.match(boot, /recoverStaleBootBuild/);
  assert.match(boot, /\.\/sw\.js\?boot_ts=/);
  assert.match(boot, /cache:\s*"no-store"/);
  assert.match(boot, /recoverLegacyUpdateGate/);
  assert.match(boot, /MutationObserver/);
  assert.match(boot, /Открыть приложение/);
  assert.match(boot, /Повторить обновление/);
  assert.match(boot, /__boot_recover/);
  assert.match(boot, /indexOf\("yagodka-"\)/);
  assert.match(boot, /localStorage\.removeItem\("yagodka_active_build_id_v1"\)/);

  const swBuilder = await readFile(path.resolve("scripts/build_pwa.mjs"), "utf8");
  assert.match(swBuilder, /patchIndexHtmlBuildVersion/);
  assert.match(swBuilder, /ensureEarlyBootScript/);
  assert.match(swBuilder, /<script defer src="\.\/boot\.js"><\/script>/);
  assert.match(swBuilder, /prefer network so old installed clients can escape a stale cached index/);
  assert.match(swBuilder, /fetchWithTimeout\(req,\s*NAVIGATION_NETWORK_TIMEOUT_MS\)/);
  assert.match(swBuilder, /PRECACHE_FETCH_TIMEOUT_MS/);
  assert.match(swBuilder, /Best-effort cache with per-request timeout/);
  assert.match(swBuilder, /cachedIndex/);
});
