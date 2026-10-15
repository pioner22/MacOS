import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadInstallPrompt() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/pwa/installPrompt.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return {
      shouldOfferPwaInstall: mod.shouldOfferPwaInstall,
      markPwaInstallDismissed: mod.markPwaInstallDismissed,
      clearPwaInstallDismissed: mod.clearPwaInstallDismissed,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

class StorageStub {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    const v = this.m.get(String(k));
    return v === undefined ? null : String(v);
  }
  setItem(k, v) {
    this.m.set(String(k), String(v));
  }
  removeItem(k) {
    this.m.delete(String(k));
  }
}

test("pwa install prompt: не показываемся в standalone", async () => {
  const helper = await loadInstallPrompt();
  try {
    const storage = new StorageStub();
    assert.equal(helper.shouldOfferPwaInstall({ storage, now: 1000, isStandalone: true, cooldownMs: 123 }), false);
  } finally {
    await helper.cleanup();
  }
});

test("pwa install prompt: показываемся если не отклоняли", async () => {
  const helper = await loadInstallPrompt();
  try {
    const storage = new StorageStub();
    assert.equal(helper.shouldOfferPwaInstall({ storage, now: 1000, isStandalone: false, cooldownMs: 123 }), true);
  } finally {
    await helper.cleanup();
  }
});

test("pwa install prompt: cooldown после отклонения", async () => {
  const helper = await loadInstallPrompt();
  try {
    const storage = new StorageStub();
    helper.markPwaInstallDismissed(storage, 1000);
    assert.equal(helper.shouldOfferPwaInstall({ storage, now: 1100, isStandalone: false, cooldownMs: 200 }), false);
    assert.equal(helper.shouldOfferPwaInstall({ storage, now: 1300, isStandalone: false, cooldownMs: 200 }), true);
    helper.clearPwaInstallDismissed(storage);
    assert.equal(helper.shouldOfferPwaInstall({ storage, now: 1301, isStandalone: false, cooldownMs: 200 }), true);
  } finally {
    await helper.cleanup();
  }
});
