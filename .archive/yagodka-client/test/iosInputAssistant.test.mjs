import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadIosInputAssistant() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/ui/iosInputAssistant.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.applyIosInputAssistantWorkaround !== "function" || typeof mod.isIOS !== "function" || typeof mod.isStandaloneDisplayMode !== "function") {
      throw new Error("iosInputAssistant exports missing");
    }
    return {
      applyIosInputAssistantWorkaround: mod.applyIosInputAssistantWorkaround,
      isIOS: mod.isIOS,
      isStandaloneDisplayMode: mod.isStandaloneDisplayMode,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function withGlobals(stubs, run) {
  const prevDesc = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  };
  if ("navigator" in stubs) Object.defineProperty(globalThis, "navigator", { value: stubs.navigator, configurable: true });
  if ("window" in stubs) Object.defineProperty(globalThis, "window", { value: stubs.window, configurable: true });
  try {
    return run();
  } finally {
    if (prevDesc.navigator) Object.defineProperty(globalThis, "navigator", prevDesc.navigator);
    else delete globalThis.navigator;
    if (prevDesc.window) Object.defineProperty(globalThis, "window", prevDesc.window);
    else delete globalThis.window;
  }
}

function mkEl() {
  const attrs = new Map();
  return {
    attrs,
    setAttribute(k, v) {
      attrs.set(String(k), String(v));
    },
    getAttribute(k) {
      return attrs.get(String(k)) ?? null;
    },
  };
}

test("iosInputAssistant: isIOS распознаёт iPhone и iPadOS", async () => {
  const helper = await loadIosInputAssistant();
  try {
    withGlobals(
      {
        navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 0 },
        window: { matchMedia: () => ({ matches: false }) },
      },
      () => assert.equal(helper.isIOS(), true)
    );

    withGlobals(
      {
        navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", maxTouchPoints: 5 },
        window: { matchMedia: () => ({ matches: false }) },
      },
      () => assert.equal(helper.isIOS(), true)
    );
  } finally {
    await helper.cleanup();
  }
});

test("iosInputAssistant: apply* включает autocorrect/spellcheck только в iOS standalone", async () => {
  const helper = await loadIosInputAssistant();
  try {
    // Not iOS -> no-op
    withGlobals(
      {
        navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", standalone: true, maxTouchPoints: 0 },
        window: { matchMedia: () => ({ matches: true }) },
      },
      () => {
        const el = mkEl();
        helper.applyIosInputAssistantWorkaround(el);
        assert.equal(el.getAttribute("autocorrect"), null);
        assert.equal(el.getAttribute("spellcheck"), null);
      }
    );

    // iOS but not standalone -> no-op
    withGlobals(
      {
        navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", standalone: false, maxTouchPoints: 0 },
        window: { matchMedia: () => ({ matches: false }) },
      },
      () => {
        assert.equal(helper.isStandaloneDisplayMode(), false);
        const el = mkEl();
        helper.applyIosInputAssistantWorkaround(el);
        assert.equal(el.getAttribute("autocorrect"), null);
      }
    );

    // iOS + standalone -> applies
    withGlobals(
      {
        navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", standalone: true, maxTouchPoints: 0 },
        window: { matchMedia: () => ({ matches: false }) },
      },
      () => {
        assert.equal(helper.isStandaloneDisplayMode(), true);
        const el = mkEl();
        helper.applyIosInputAssistantWorkaround(el);
        assert.equal(el.getAttribute("autocorrect"), "on");
        assert.equal(el.getAttribute("spellcheck"), "true");
        assert.equal(el.getAttribute("autocapitalize"), "sentences");
      }
    );
  } finally {
    await helper.cleanup();
  }
});
