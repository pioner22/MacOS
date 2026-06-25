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
    getItem: (key) => (data.has(key) ? data.get(key) : null),
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

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/pwa/buildIdStore.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.loadActiveBuildId !== "function" || typeof mod.storeActiveBuildId !== "function") {
      throw new Error("buildIdStore exports missing");
    }
    return {
      loadActiveBuildId: mod.loadActiveBuildId,
      storeActiveBuildId: mod.storeActiveBuildId,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("buildIdStore: хранит активный buildId и возвращает его для той же версии", async () => {
  const helper = await loadHelper();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    assert.equal(helper.loadActiveBuildId("0.1.99"), "0.1.99");
    localStorage.setItem("yagodka_active_build_id_v1", "0.1.99-abcdef123456");
    assert.equal(helper.loadActiveBuildId("0.1.99"), "0.1.99-abcdef123456");
    assert.equal(helper.loadActiveBuildId("0.1.99-abcdef123456"), "0.1.99-abcdef123456");
    localStorage.setItem("yagodka_active_build_id_v1", "0.1.99-abcdef123456");
    assert.equal(helper.loadActiveBuildId("0.1.99-fedcba654321"), "0.1.99-fedcba654321");
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), null);
    localStorage.setItem("yagodka_active_build_id_v1", "0.1.99");
    assert.equal(helper.loadActiveBuildId("0.1.99-abcdef123456"), "0.1.99-abcdef123456");
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), null);
    assert.equal(helper.loadActiveBuildId("0.1.98"), "0.1.98");
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), null);

    localStorage.clear();
    helper.storeActiveBuildId("0.2.0-111111111111");
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), "0.2.0-111111111111");

    localStorage.clear();
    helper.storeActiveBuildId(" ");
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), null);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await helper.cleanup();
  }
});
