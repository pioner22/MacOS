import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadWorkaround() {
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
    if (typeof mod.applyIosInputAssistantWorkaround !== "function") {
      throw new Error("applyIosInputAssistantWorkaround export missing");
    }
    return {
      applyIosInputAssistantWorkaround: mod.applyIosInputAssistantWorkaround,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function withGlobals(next, run) {
  const prev = new Map();
  for (const [k, v] of Object.entries(next)) {
    prev.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  try {
    return run();
  } finally {
    for (const k of Object.keys(next)) {
      const d = prev.get(k);
      if (!d) delete globalThis[k];
      else Object.defineProperty(globalThis, k, d);
    }
  }
}

class TextElStub {
  constructor() {
    this._attrs = new Map();
    this.spellcheck = false;
  }
  setAttribute(name, value) {
    this._attrs.set(String(name), String(value));
  }
  getAttribute(name) {
    const v = this._attrs.get(String(name));
    return v === undefined ? null : v;
  }
}

test("iOS PWA: workaround включает autocorrect/spellcheck/autocapitalize", async () => {
  const helper = await loadWorkaround();
  try {
    const el = new TextElStub();
    withGlobals(
      {
        navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)", maxTouchPoints: 0 },
        window: {
          matchMedia: () => ({ matches: true }),
        },
      },
      () => {
        helper.applyIosInputAssistantWorkaround(el);
        assert.equal(el.getAttribute("autocorrect"), "on");
        assert.equal(el.getAttribute("spellcheck"), "true");
        assert.equal(el.getAttribute("autocapitalize"), "sentences");
        assert.equal(el.spellcheck, true);
      }
    );
  } finally {
    await helper.cleanup();
  }
});

test("iOS PWA: workaround strict отключает autocorrect/spellcheck/autocapitalize", async () => {
  const helper = await loadWorkaround();
  try {
    const el = new TextElStub();
    withGlobals(
      {
        navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)", maxTouchPoints: 0 },
        window: {
          matchMedia: () => ({ matches: true }),
        },
      },
      () => {
        helper.applyIosInputAssistantWorkaround(el, "strict");
        assert.equal(el.getAttribute("autocorrect"), "off");
        assert.equal(el.getAttribute("spellcheck"), "false");
        assert.equal(el.getAttribute("autocapitalize"), "off");
        assert.equal(el.spellcheck, false);
      }
    );
  } finally {
    await helper.cleanup();
  }
});

test("не iOS/не standalone: workaround ничего не меняет", async () => {
  const helper = await loadWorkaround();
  try {
    const el = new TextElStub();
    withGlobals(
      {
        navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", maxTouchPoints: 0 },
        window: {
          matchMedia: () => ({ matches: false }),
        },
      },
      () => {
        helper.applyIosInputAssistantWorkaround(el);
        assert.equal(el.getAttribute("autocorrect"), null);
        assert.equal(el.getAttribute("spellcheck"), null);
        assert.equal(el.getAttribute("autocapitalize"), null);
        assert.equal(el.spellcheck, false);
      }
    );
  } finally {
    await helper.cleanup();
  }
});
