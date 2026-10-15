import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/navigation/deviceCaps.ts")],
      outfile,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createDeviceCaps !== "function") throw new Error("missing export: createDeviceCaps");
    return {
      createDeviceCaps: mod.createDeviceCaps,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function installRuntime(opts = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const matches = new Set(opts.matches || []);
  const nav = {
    userAgent: opts.userAgent || "Mozilla/5.0 (X11; Linux x86_64)",
    hardwareConcurrency: opts.hardwareConcurrency ?? 8,
    deviceMemory: opts.deviceMemory ?? 8,
    maxTouchPoints: opts.maxTouchPoints ?? 0,
    standalone: Boolean(opts.standalone),
    connection: opts.connection || {},
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: nav,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: (query) => ({ matches: matches.has(String(query)), media: String(query) }),
    },
  });
  return () => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  };
}

test("deviceCaps: iOS blocks background history prefetch budgets", async () => {
  const { createDeviceCaps, cleanup } = await loadHelper();
  const restore = installRuntime({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)",
    maxTouchPoints: 5,
    hardwareConcurrency: 6,
    deviceMemory: 6,
    matches: ["(pointer: coarse)", "(any-pointer: coarse)", "(hover: none)"],
  });
  try {
    const caps = createDeviceCaps();
    assert.equal(caps.prefetchAllowed, false);
    assert.equal(caps.historyWarmupConcurrency, 1);
    assert.equal(caps.historyWarmupQueueMax, 8);
    assert.equal(caps.historyPrefetchLimit, 80);
    assert.equal(caps.historyWarmupLimit, 80);
    assert.equal(caps.historyWarmupDelayMs, 700);
  } finally {
    restore();
    await cleanup();
  }
});

test("deviceCaps: desktop keeps background prefetch when Save-Data is off", async () => {
  const { createDeviceCaps, cleanup } = await loadHelper();
  const restore = installRuntime();
  try {
    const caps = createDeviceCaps();
    assert.equal(caps.prefetchAllowed, true);
    assert.equal(caps.historyWarmupConcurrency > 1, true);
    assert.equal(caps.historyWarmupQueueMax >= 60, true);
  } finally {
    restore();
    await cleanup();
  }
});
