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
      entryPoints: [path.resolve("src/helpers/ui/environmentAgent.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.detectEnvironment !== "function") {
      throw new Error("detectEnvironment export missing");
    }
    return { detectEnvironment: mod.detectEnvironment, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("environmentAgent: iPhone Safari", async () => {
  const helper = await loadHelper();
  try {
    const env = helper.detectEnvironment({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
      innerWidth: 390,
      innerHeight: 844,
      pointerCoarse: true,
      hoverNone: true,
    });
    assert.equal(env.os, "ios");
    assert.equal(env.browser, "safari");
    assert.equal(env.engine, "webkit");
    assert.equal(env.device, "mobile");
  } finally {
    await helper.cleanup();
  }
});

test("environmentAgent: Android Chrome", async () => {
  const helper = await loadHelper();
  try {
    const env = helper.detectEnvironment({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
      innerWidth: 412,
      innerHeight: 915,
      pointerCoarse: true,
      hoverNone: true,
    });
    assert.equal(env.os, "android");
    assert.equal(env.browser, "chrome");
    assert.equal(env.engine, "chromium");
    assert.equal(env.device, "mobile");
  } finally {
    await helper.cleanup();
  }
});

test("environmentAgent: Windows Edge", async () => {
  const helper = await loadHelper();
  try {
    const env = helper.detectEnvironment({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      platform: "Win32",
      maxTouchPoints: 0,
      innerWidth: 1440,
      innerHeight: 900,
      pointerCoarse: false,
      hoverNone: false,
    });
    assert.equal(env.os, "windows");
    assert.equal(env.browser, "edge");
    assert.equal(env.engine, "chromium");
    assert.equal(env.device, "desktop");
  } finally {
    await helper.cleanup();
  }
});

test("environmentAgent: iPadOS Safari", async () => {
  const helper = await loadHelper();
  try {
    const env = helper.detectEnvironment({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "MacIntel",
      maxTouchPoints: 5,
      innerWidth: 1024,
      innerHeight: 1366,
      pointerCoarse: true,
      hoverNone: true,
    });
    assert.equal(env.os, "ios");
    assert.equal(env.browser, "safari");
    assert.equal(env.engine, "webkit");
    assert.equal(env.device, "tablet");
  } finally {
    await helper.cleanup();
  }
});
