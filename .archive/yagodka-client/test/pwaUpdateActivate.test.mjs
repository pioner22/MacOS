import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadPwaHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/pwa/registerServiceWorker.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.activatePwaUpdate !== "function") throw new Error("activatePwaUpdate не экспортирован из бандла");
    if (typeof mod.__setUpdateRegistrationForTest !== "function") throw new Error("__setUpdateRegistrationForTest не экспортирован");
    return {
      activatePwaUpdate: mod.activatePwaUpdate,
      setReg: mod.__setUpdateRegistrationForTest,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
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
    dispatch(type) {
      const arr = listeners.get(type) || [];
      for (const fn of arr.slice()) fn();
    },
  };
}

test("activatePwaUpdate: считает успехом activated без controllerchange (iOS)", async () => {
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const { activatePwaUpdate, setReg, cleanup } = await loadPwaHelpers();
  try {
    const sw = makeEventTarget();
    const waiting = {
      state: "installed",
      ...makeEventTarget(),
      postMessage() {},
    };
    setReg({ waiting });
    Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: sw }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true, writable: true });

    const p = activatePwaUpdate();
    waiting.state = "activated";
    waiting.dispatch("statechange");
    const ok = await p;
    assert.equal(ok, true);
  } finally {
    setReg(null);
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    await cleanup();
  }
});

test("activatePwaUpdate: успех при controllerchange", async () => {
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const { activatePwaUpdate, setReg, cleanup } = await loadPwaHelpers();
  try {
    const sw = makeEventTarget();
    const waiting = {
      state: "installed",
      ...makeEventTarget(),
      postMessage() {},
    };
    setReg({ waiting });
    Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: sw }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true, writable: true });

    const p = activatePwaUpdate();
    sw.dispatch("controllerchange");
    const ok = await p;
    assert.equal(ok, true);
  } finally {
    setReg(null);
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    await cleanup();
  }
});

test("activatePwaUpdate: не зависает, если событий нет (таймаут)", async () => {
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const { activatePwaUpdate, setReg, cleanup } = await loadPwaHelpers();
  try {
    const sw = makeEventTarget();
    const waiting = {
      state: "installed",
      ...makeEventTarget(),
      postMessage() {},
    };
    setReg({ waiting });
    Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: sw }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "window", {
      value: {
      setTimeout(fn) {
        fn();
        return 1;
      },
      clearTimeout() {},
      },
      configurable: true,
      writable: true,
    });

    const ok = await activatePwaUpdate();
    assert.equal(ok, false);
  } finally {
    setReg(null);
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    await cleanup();
  }
});
