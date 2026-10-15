import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadInstall() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/ui/appViewport.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.installAppViewportHeightVar !== "function") throw new Error("export missing");
    return { fn: mod.installAppViewportHeightVar, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("css viewport: #app поддерживает JS override через --app-vh", async () => {
  const css = await readFile(path.resolve("src/scss/base.css"), "utf8");
  assert.match(css, /--app-frame-vh:\s*var\(--app-vh\)\s*;/);
  assert.match(css, /height:\s*var\(--app-vh\)\s*;/);
  assert.match(css, /min-height:\s*var\(--app-vh\)\s*;/);
});

test("viewport diagnostics: W-0946 logged-in frame overlay is real-phone focused", async () => {
  const source = await readFile(path.resolve("src/helpers/ui/appViewport.ts"), "utf8");
  assert.match(source, /W0946_AUTO_FRAME_DIAGNOSTICS\s*=\s*false/);
  assert.match(source, /loggedInMobileFrameDiagnosticsAutoEnabled\(keyboard\)/);
  assert.match(source, /document\.querySelector\("\.grid"\)/);
  assert.match(source, /document\.querySelector\("\.overlay\.overlay-viewer"\)/);
  assert.match(source, /W0946-FRAME-DIAG/);
  assert.match(source, /elementFromPoint/);
  assert.match(source, /app-frame-diagnostic-panel/);
  assert.match(source, /data-app-diagnostic-mode/);
  assert.match(source, /data-app-diagnostic-target/);
});

test("viewport var: installAppViewportHeightVar использует innerHeight по умолчанию (без document)", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };
    let rafCb = null;

    const vvListeners = new Map();
    const windowListeners = new Map();

    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: {
        height: 642.2,
        addEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          list.push(cb);
          vvListeners.set(type, list);
        },
        removeEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          vvListeners.set(
            type,
            list.filter((x) => x !== cb)
          );
        },
      },
      requestAnimationFrame(cb) {
        rafCb = cb;
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        list.push(cb);
        windowListeners.set(type, list);
      },
      removeEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        windowListeners.set(
          type,
          list.filter((x) => x !== cb)
        );
      },
    };

    globalThis.document = { activeElement: null, documentElement: { clientHeight: 700 } };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.get("--app-frame-vh"), "700px");
    assert.equal(style._props.get("--vh"), "7px");
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--app-frame-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(rafCb !== null, true);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: installAppViewportHeightVar предпочитает innerHeight (visual viewport) над clientHeight", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    globalThis.document = { documentElement: { clientHeight: 740 } };
    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: { height: 690.2, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
      location: { href: "https://yagodka.org/web/" },
      localStorage: { getItem: (key) => (key === "yagodka_bottom_diagnostics" ? "1" : null) },
      sessionStorage: { getItem: () => null },
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.get("--app-frame-vh"), "700px");
    assert.equal(style._props.get("--vh"), "7px");
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--app-frame-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: держит последнюю стабильную высоту при обнулении innerHeight", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    const windowListeners = new Map();
    const vvListeners = new Map();

    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: {
        height: 680,
        addEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          list.push(cb);
          vvListeners.set(type, list);
        },
        removeEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          vvListeners.set(
            type,
            list.filter((x) => x !== cb)
          );
        },
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        list.push(cb);
        windowListeners.set(type, list);
      },
      removeEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        windowListeners.set(
          type,
          list.filter((x) => x !== cb)
        );
      },
    };
    globalThis.document = { documentElement: { clientHeight: 700 } };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.get("--app-frame-vh"), "700px");

    globalThis.window.innerHeight = 0;
    globalThis.window.visualViewport.height = 0;
    globalThis.document.documentElement.clientHeight = 0;
    for (const cb of windowListeners.get("resize") || []) cb();

    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.get("--app-frame-vh"), "700px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--app-frame-vh"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: fallback использует screen.height при нулевой высоте viewport", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    const windowListeners = new Map();
    const vvListeners = new Map();

    globalThis.window = {
      innerHeight: 0,
      outerHeight: 0,
      screen: { height: 812, availHeight: 812 },
      visualViewport: {
        height: 0,
        addEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          list.push(cb);
          vvListeners.set(type, list);
        },
        removeEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          vvListeners.set(
            type,
            list.filter((x) => x !== cb)
          );
        },
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        list.push(cb);
        windowListeners.set(type, list);
      },
      removeEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        windowListeners.set(
          type,
          list.filter((x) => x !== cb)
        );
      },
    };
    globalThis.document = { documentElement: { clientHeight: 0 } };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "812px");
    assert.equal(style._props.get("--app-frame-vh"), "812px");

    cleanup();
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: iOS PWA: держит screen gap в frame height отдельно от --app-vh", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: { clientHeight: 810 } };
    globalThis.window = {
      innerHeight: 810,
      screen: { height: 844 },
      visualViewport: { height: 808.2, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
      location: { href: "https://yagodka.org/web/" },
      localStorage: { getItem: (key) => (key === "yagodka_bottom_diagnostics" ? "1" : null) },
      sessionStorage: { getItem: () => null },
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "810px");
    assert.equal(style._props.get("--app-frame-vh"), "844px");
    assert.equal(style._props.get("--vh"), "8.1px");
    assert.equal(style._props.get("--app-gap-bottom"), "34px");
    assert.equal(style._props.get("--app-layout-gap-bottom"), "34px");
    assert.equal(style._props.get("--safe-bottom-pad"), "34px");
    assert.equal(style._props.has("--safe-bottom-raw"), false);

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--app-frame-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--app-gap-bottom"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: iOS PWA: большой physical bottom gap не зажимается safe-area", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const rootAttrs = new Map();
    const bodyAttrs = new Map();
    const docClasses = new Set();
    const makeAttrTarget = (attrs, extra = {}) => ({
      ...extra,
      setAttribute(k, v) {
        attrs.set(String(k), String(v));
      },
      removeAttribute(k) {
        attrs.delete(String(k));
      },
    });
    const root = makeAttrTarget(rootAttrs, { style });
    const docEl = makeAttrTarget(new Map(), {
      clientHeight: 810,
      style,
      classList: {
        add(name) {
          docClasses.add(String(name));
        },
        remove(name) {
          docClasses.delete(String(name));
        },
        toggle(name, value) {
          const key = String(name);
          if (value) docClasses.add(key);
          else docClasses.delete(key);
        },
      },
    });
    const body = makeAttrTarget(bodyAttrs);

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: docEl, body };
    globalThis.window = {
      innerHeight: 810,
      screen: { height: 900, availHeight: 900 },
      outerHeight: 900,
      visualViewport: { height: 808.2, addEventListener() {}, removeEventListener() {} },
      getComputedStyle() {
        return { getPropertyValue: () => "34px" };
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
      location: { href: "https://yagodka.org/web/" },
      localStorage: { getItem: (key) => (key === "yagodka_bottom_diagnostics" ? "1" : null) },
      sessionStorage: { getItem: () => null },
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "810px");
    assert.equal(style._props.get("--app-frame-vh"), "900px");
    assert.equal(style._props.get("--vh"), "8.1px");
    assert.equal(style._props.get("--app-gap-bottom"), "90px");
    assert.equal(style._props.has("--app-shell-bottom-spill"), false);
    assert.equal(style._props.get("--safe-bottom-pad"), "34px");
    assert.equal(rootAttrs.get("data-viewport-diagnostic"), "1");
    assert.equal(rootAttrs.get("data-app-frame-vh"), "900");
    assert.equal(rootAttrs.get("data-app-gap-bottom"), "90");
    assert.equal(rootAttrs.get("data-app-layout-gap-bottom"), "90");
    assert.equal(rootAttrs.get("data-app-keyboard"), "0");
    assert.equal(rootAttrs.get("data-app-shell-spill"), "0");
    assert.equal(bodyAttrs.get("data-app-gap-bottom"), "90");
    assert.equal(docClasses.has("app-shell-physical-bottom"), true);

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--app-frame-vh"), false);
    assert.equal(style._props.has("--app-gap-bottom"), false);
    assert.equal(style._props.has("--app-shell-bottom-spill"), false);
    assert.equal(rootAttrs.has("data-app-gap-bottom"), false);
    assert.equal(rootAttrs.has("data-app-frame-vh"), false);
    assert.equal(rootAttrs.has("data-app-layout-gap-bottom"), false);
    assert.equal(rootAttrs.has("data-app-keyboard"), false);
    assert.equal(rootAttrs.has("data-app-shell-spill"), false);
    assert.equal(bodyAttrs.has("data-app-gap-bottom"), false);
    assert.equal(docClasses.has("app-shell-physical-bottom"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: iOS PWA: rounded-screen physical gap до 180px растягивает frame height без роста --app-vh", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const rootAttrs = new Map();
    const docClasses = new Set();
    const root = {
      style,
      setAttribute(k, v) {
        rootAttrs.set(String(k), String(v));
      },
      removeAttribute(k) {
        rootAttrs.delete(String(k));
      },
    };
    const docEl = {
      clientHeight: 810,
      style,
      classList: {
        add(name) {
          docClasses.add(String(name));
        },
        remove(name) {
          docClasses.delete(String(name));
        },
        toggle(name, value) {
          const key = String(name);
          if (value) docClasses.add(key);
          else docClasses.delete(key);
        },
      },
    };

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: docEl, body: { setAttribute() {}, removeAttribute() {} } };
    globalThis.window = {
      innerHeight: 810,
      screen: { height: 956, availHeight: 956 },
      outerHeight: 956,
      visualViewport: { height: 810, addEventListener() {}, removeEventListener() {} },
      getComputedStyle() {
        return { getPropertyValue: () => "34px" };
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
      location: { href: "https://yagodka.org/web/" },
      localStorage: { getItem: (key) => (key === "yagodka_bottom_diagnostics" ? "1" : null) },
      sessionStorage: { getItem: () => null },
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "810px");
    assert.equal(style._props.get("--app-frame-vh"), "956px");
    assert.equal(style._props.get("--vh"), "8.1px");
    assert.equal(style._props.get("--app-gap-bottom"), "146px");
    assert.equal(style._props.get("--app-layout-gap-bottom"), "146px");
    assert.equal(style._props.get("--safe-bottom-pad"), "34px");
    assert.equal(rootAttrs.get("data-app-gap-bottom"), "146");
    assert.equal(rootAttrs.get("data-app-frame-vh"), "956");
    assert.equal(rootAttrs.get("data-app-layout-gap-bottom"), "146");
    assert.equal(rootAttrs.get("data-app-keyboard"), "0");
    assert.equal(docClasses.has("app-shell-physical-bottom"), true);

    cleanup();
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: iOS PWA: physical bottom gap не считается клавиатурой при активном поле", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const rootAttrs = new Map();
    const root = {
      style,
      setAttribute(k, v) {
        rootAttrs.set(String(k), String(v));
      },
      removeAttribute(k) {
        rootAttrs.delete(String(k));
      },
    };
    const active = { tagName: "INPUT", isContentEditable: false };

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { activeElement: active, documentElement: { clientHeight: 894 } };
    globalThis.window = {
      innerHeight: 894,
      screen: { height: 956, availHeight: 956 },
      outerHeight: 956,
      visualViewport: { height: 894, addEventListener() {}, removeEventListener() {} },
      getComputedStyle() {
        return { getPropertyValue: () => "0px" };
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
      location: { href: "https://yagodka.org/web/" },
      localStorage: { getItem: (key) => (key === "yagodka_bottom_diagnostics" ? "1" : null) },
      sessionStorage: { getItem: () => null },
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "894px");
    assert.equal(style._props.get("--app-frame-vh"), "956px");
    assert.equal(style._props.get("--vh"), "8.94px");
    assert.equal(style._props.get("--app-gap-bottom"), "62px");
    assert.equal(style._props.get("--app-layout-gap-bottom"), "62px");
    assert.equal(style._props.has("--app-shell-bottom-spill"), false);
    assert.equal(style._props.get("--safe-bottom-pad"), "34px");
    assert.equal(style._props.has("--safe-bottom-raw"), false);
    assert.equal(style._props.has("--app-vv-bottom"), false);
    assert.equal(rootAttrs.get("data-app-gap-bottom"), "62");
    assert.equal(rootAttrs.get("data-app-frame-vh"), "956");
    assert.equal(rootAttrs.get("data-app-layout-gap-bottom"), "62");
    assert.equal(rootAttrs.get("data-app-keyboard"), "0");
    assert.equal(rootAttrs.get("data-app-shell-spill"), "0");

    cleanup();
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: iOS PWA: keyboard keeps debug diagnostics but removes layout gap", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const rootAttrs = new Map();
    const root = {
      style,
      setAttribute(k, v) {
        rootAttrs.set(String(k), String(v));
      },
      removeAttribute(k) {
        rootAttrs.delete(String(k));
      },
    };
    const active = { tagName: "TEXTAREA", isContentEditable: false };

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { activeElement: active, documentElement: { clientHeight: 810 } };
    globalThis.window = {
      innerHeight: 810,
      screen: { height: 844, availHeight: 844 },
      outerHeight: 844,
      visualViewport: { height: 390, addEventListener() {}, removeEventListener() {} },
      getComputedStyle() {
        return { getPropertyValue: () => "34px" };
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
      location: { href: "https://yagodka.org/web/" },
      localStorage: { getItem: (key) => (key === "yagodka_bottom_diagnostics" ? "1" : null) },
      sessionStorage: { getItem: () => null },
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "390px");
    assert.equal(style._props.get("--app-frame-vh"), "390px");
    assert.equal(style._props.get("--vh"), "3.9px");
    assert.equal(style._props.get("--app-gap-bottom"), "34px");
    assert.equal(style._props.get("--app-layout-gap-bottom"), "0px");
    assert.equal(style._props.has("--app-shell-bottom-spill"), false);
    assert.equal(style._props.get("--safe-bottom-pad"), "0px");
    assert.equal(style._props.get("--safe-bottom-raw"), "0px");
    assert.equal(style._props.get("--app-vv-bottom"), "386px");
    assert.equal(rootAttrs.get("data-app-gap-bottom"), "34");
    assert.equal(rootAttrs.get("data-app-frame-vh"), "390");
    assert.equal(rootAttrs.get("data-app-layout-gap-bottom"), "0");
    assert.equal(rootAttrs.get("data-app-keyboard"), "1");
    assert.equal(rootAttrs.get("data-app-shell-spill"), "0");

    cleanup();
    assert.equal(style._props.has("--app-frame-vh"), false);
    assert.equal(style._props.has("--app-layout-gap-bottom"), false);
    assert.equal(style._props.has("--app-shell-bottom-spill"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: iOS PWA: fallback safe-area inset тоже остаётся отдельным gap", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: { clientHeight: 810 } };
    globalThis.window = {
      innerHeight: 810,
      screen: { height: 0 },
      visualViewport: { height: 808.2, addEventListener() {}, removeEventListener() {} },
      getComputedStyle() {
        return { getPropertyValue: () => "34px" };
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "810px");
    assert.equal(style._props.get("--app-frame-vh"), "844px");
    assert.equal(style._props.get("--vh"), "8.1px");
    assert.equal(style._props.get("--app-gap-bottom"), "34px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--app-frame-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--app-gap-bottom"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: iOS PWA: safe-area fallback owns physical bottom when screen slack is zero", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const rootAttrs = new Map();
    const docClasses = new Set();
    const root = {
      style,
      setAttribute(k, v) {
        rootAttrs.set(String(k), String(v));
      },
      removeAttribute(k) {
        rootAttrs.delete(String(k));
      },
    };
    const docEl = {
      clientHeight: 810,
      style,
      classList: {
        add(name) {
          docClasses.add(String(name));
        },
        remove(name) {
          docClasses.delete(String(name));
        },
        toggle(name, value) {
          const key = String(name);
          if (value) docClasses.add(key);
          else docClasses.delete(key);
        },
      },
    };

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: docEl, body: { setAttribute() {}, removeAttribute() {} } };
    globalThis.window = {
      innerHeight: 810,
      screen: { height: 810, availHeight: 810 },
      outerHeight: 810,
      visualViewport: { height: 808.2, addEventListener() {}, removeEventListener() {} },
      getComputedStyle() {
        return { getPropertyValue: () => "34px" };
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
      location: { href: "https://yagodka.org/web/" },
      localStorage: { getItem: (key) => (key === "yagodka_bottom_diagnostics" ? "1" : null) },
      sessionStorage: { getItem: () => null },
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "810px");
    assert.equal(style._props.get("--app-frame-vh"), "844px");
    assert.equal(style._props.get("--vh"), "8.1px");
    assert.equal(style._props.get("--app-gap-bottom"), "34px");
    assert.equal(style._props.get("--app-layout-gap-bottom"), "34px");
    assert.equal(style._props.get("--safe-bottom-pad"), "34px");
    assert.equal(rootAttrs.get("data-app-frame-vh"), "844");
    assert.equal(rootAttrs.get("data-app-gap-bottom"), "34");
    assert.equal(rootAttrs.get("data-app-layout-gap-bottom"), "34");
    assert.equal(docClasses.has("app-shell-physical-bottom"), true);

    cleanup();
    assert.equal(style._props.has("--app-frame-vh"), false);
    assert.equal(style._props.has("--app-gap-bottom"), false);
    assert.equal(docClasses.has("app-shell-physical-bottom"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: installAppViewportHeightVar игнорирует screen.height на не-iOS", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "", maxTouchPoints: 0 },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: { clientHeight: 700 } };
    globalThis.window = {
      innerHeight: 700,
      screen: { height: 780 },
      visualViewport: { height: 690.2, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.get("--vh"), "7px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: installAppViewportHeightVar переключается на visualViewport при большой разнице (клавиатура)", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };
    let rafCb = null;

    const vvListeners = new Map();
    const windowListeners = new Map();

    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: {
        height: 390.2,
        addEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          list.push(cb);
          vvListeners.set(type, list);
        },
        removeEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          vvListeners.set(
            type,
            list.filter((x) => x !== cb)
          );
        },
      },
      requestAnimationFrame(cb) {
        rafCb = cb;
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        list.push(cb);
        windowListeners.set(type, list);
      },
      removeEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        windowListeners.set(
          type,
          list.filter((x) => x !== cb)
        );
      },
    };

    // Ensure it doesn't crash without document.
    const active = { tagName: "TEXTAREA", isContentEditable: false };
    globalThis.document = { activeElement: active, documentElement: { clientHeight: 700 } };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "390px");
    assert.equal(style._props.get("--vh"), "3.9px");
    assert.equal(style._props.get("--safe-bottom-pad"), "0px");
    assert.equal(style._props.get("--safe-bottom-raw"), "0px");
    assert.equal(style._props.get("--app-vv-bottom"), "310px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);
    assert.equal(style._props.has("--app-vv-bottom"), false);
    assert.equal(rafCb !== null, true);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: iOS keyboard resize+offset не завышает --app-vv-bottom (без зазора у композера)", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    const vvListeners = new Map();
    const windowListeners = new Map();
    const rafQueue = [];
    const active = { tagName: "TEXTAREA", isContentEditable: false };

    globalThis.document = { activeElement: null, documentElement: { clientHeight: 700 } };
    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: {
        height: 700,
        offsetTop: 0,
        addEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          list.push(cb);
          vvListeners.set(type, list);
        },
        removeEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          vvListeners.set(
            type,
            list.filter((x) => x !== cb)
          );
        },
      },
      requestAnimationFrame(cb) {
        rafQueue.push(cb);
        return rafQueue.length;
      },
      cancelAnimationFrame() {},
      addEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        list.push(cb);
        windowListeners.set(type, list);
      },
      removeEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        windowListeners.set(
          type,
          list.filter((x) => x !== cb)
        );
      },
    };

    const cleanup = helper.fn(root);
    while (rafQueue.length) rafQueue.shift()();
    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.has("--app-vv-bottom"), false);

    // Simulate a tricky iOS case: keyboard opens, layout viewport shrinks to vvHeight but vvTop shifts (>0).
    globalThis.document.activeElement = active;
    globalThis.document.documentElement.clientHeight = 390;
    globalThis.window.innerHeight = 390;
    globalThis.window.visualViewport.height = 390;
    globalThis.window.visualViewport.offsetTop = 10;

    const resizeListeners = windowListeners.get("resize") || [];
    for (const cb of resizeListeners) cb();
    while (rafQueue.length) rafQueue.shift()();

    assert.equal(style._props.get("--app-vh"), "390px");
    assert.equal(style._props.get("--safe-bottom-pad"), "0px");
    // Important: do NOT set a huge --app-vv-bottom here, otherwise the app height collapses
    // and the composer floats above the keyboard with a visible gap.
    assert.equal(style._props.has("--app-vv-bottom"), false);

    cleanup();
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: при фокусе на input/textarea переключается на visualViewport при меньшей разнице", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    const active = { tagName: "TEXTAREA", isContentEditable: false };
    globalThis.document = { activeElement: active, documentElement: { clientHeight: 700 } };
    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: { height: 642.2, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "642px");
    assert.equal(style._props.get("--vh"), "6.42px");
    assert.equal(style._props.get("--safe-bottom-pad"), "0px");
    assert.equal(style._props.get("--safe-bottom-raw"), "0px");
    assert.equal(style._props.get("--app-vv-bottom"), "58px");
    cleanup();
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: guard against tiny heights (avoid layout collapse)", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    globalThis.document = {
      activeElement: { tagName: "TEXTAREA" },
      documentElement: { clientHeight: 700 },
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: { height: 1, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "700px");
    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: учитывает visualViewport.offsetTop, чтобы не было чёрной полосы/прыжка композера", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };

    const vvListeners = new Map();
    globalThis.window = {
      innerHeight: 844,
      screen: { height: 0 },
      visualViewport: {
        height: 520.2,
        offsetTop: 120.1,
        addEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          list.push(cb);
          vvListeners.set(type, list);
        },
        removeEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          vvListeners.set(
            type,
            list.filter((x) => x !== cb)
          );
        },
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const active = { tagName: "TEXTAREA", isContentEditable: false };
    globalThis.document = { activeElement: active, documentElement: { clientHeight: 844 } };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "520px");
    assert.equal(style._props.get("--vh"), "5.2px");
    assert.equal(style._props.get("--safe-bottom-pad"), "0px");
    assert.equal(style._props.get("--safe-bottom-raw"), "0px");
    assert.equal(style._props.get("--app-vv-top"), "120px");
    assert.equal(style._props.get("--app-vv-bottom"), "204px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);
    assert.equal(style._props.has("--app-vv-top"), false);
    assert.equal(style._props.has("--app-vv-bottom"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});
