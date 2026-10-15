import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

function stubDom({ hidden = false, focused = true } = {}) {
  const prev = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    BroadcastChannel: Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel"),
  };
  const localStorage = mkStorage();
  const doc = {
    visibilityState: hidden ? "hidden" : "visible",
    hasFocus: () => Boolean(focused),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const win = {
    addEventListener: () => {},
    removeEventListener: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  };
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
  Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });

  return {
    localStorage,
    document: doc,
    cleanup: () => {
      if (prev.window) Object.defineProperty(globalThis, "window", prev.window);
      else delete globalThis.window;
      if (prev.document) Object.defineProperty(globalThis, "document", prev.document);
      else delete globalThis.document;
      if (prev.localStorage) Object.defineProperty(globalThis, "localStorage", prev.localStorage);
      else delete globalThis.localStorage;
      if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
      else delete globalThis.navigator;
      if (prev.BroadcastChannel) Object.defineProperty(globalThis, "BroadcastChannel", prev.BroadcastChannel);
      else delete globalThis.BroadcastChannel;
    },
  };
}

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/notify/tabNotifier.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.TabNotifier !== "function") {
      throw new Error("tabNotifier exports missing");
    }
    return {
      TabNotifier: mod.TabNotifier,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("TabNotifier: toast — only focused+visible + dedup", async () => {
  const helper = await loadHelper();
  const stubs = stubDom({ hidden: false, focused: true });
  try {
    const notifier = new helper.TabNotifier("tab-1");
    notifier.install();
    assert.equal(notifier.shouldShowToast("file_offer:dm:1:f-1"), true);
    assert.equal(notifier.shouldShowToast("file_offer:dm:1:f-1"), false);

    stubs.document.hasFocus = () => false;
    assert.equal(notifier.shouldShowToast("file_offer:dm:1:f-2"), false);

    stubs.document.visibilityState = "hidden";
    stubs.document.hasFocus = () => true;
    assert.equal(notifier.shouldShowToast("file_offer:dm:1:f-3"), false);
  } finally {
    stubs.cleanup();
    await helper.cleanup();
  }
});

test("TabNotifier: system notification — only leader + all tabs hidden + dedup", async () => {
  const helper = await loadHelper();
  const stubs = stubDom({ hidden: true, focused: false });
  try {
    const notifier = new helper.TabNotifier("tab-1");
    notifier.install();
    assert.equal(notifier.shouldShowSystemNotification("message:dm:1:100"), true);
    assert.equal(notifier.shouldShowSystemNotification("message:dm:1:100"), false);
  } finally {
    stubs.cleanup();
    await helper.cleanup();
  }
});

