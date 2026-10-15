import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadModule(entry) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entry)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function mkStorage() {
  const map = new Map();
  return {
    getItem(k) {
      const v = map.get(String(k));
      return v === undefined ? null : String(v);
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
  };
}

test("avatarMonogram: понятные подписи для разных типов", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/avatar/avatarStore.ts");
  try {
    const { avatarMonogram } = mod;
    assert.equal(avatarMonogram("group", "grp-123"), "G");
    assert.equal(avatarMonogram("board", "b-123"), "B");
    assert.equal(avatarMonogram("dm", "111-222-333"), "33");
    assert.equal(avatarMonogram("dm", "u-deadbeef"), "U-");
  } finally {
    await cleanup();
  }
});

test("avatarStore: хранит rev (и очищает вместе с аватаром)", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/avatar/avatarStore.ts");
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    const { getStoredAvatarRev, storeAvatarRev, clearStoredAvatar } = mod;
    assert.equal(getStoredAvatarRev("dm", "123-456-789"), 0);
    storeAvatarRev("dm", "123-456-789", 7);
    assert.equal(getStoredAvatarRev("dm", "123-456-789"), 7);
    clearStoredAvatar("dm", "123-456-789");
    assert.equal(getStoredAvatarRev("dm", "123-456-789"), 0);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("avatarHue: стабильный диапазон 0..359", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/avatar/avatarStore.ts");
  try {
    const { avatarHue } = mod;
    const h1 = avatarHue("dm:111-222-333");
    const h2 = avatarHue("dm:111-222-333");
    const h3 = avatarHue("dm:999-000-111");
    assert.ok(Number.isInteger(h1));
    assert.ok(h1 >= 0 && h1 < 360);
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
  } finally {
    await cleanup();
  }
});

test("avatarStore: не падает при ошибках localStorage (quota/disabled)", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/avatar/avatarStore.ts");
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = {
      getItem() {
        return null;
      },
      setItem() {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      },
      removeItem() {},
    };
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    const { storeAvatar, getStoredAvatar, storeAvatarRev, getStoredAvatarRev, clearStoredAvatar } = mod;
    const dataUrl = "data:image/png;base64,AA==";

    assert.doesNotThrow(() => storeAvatar("dm", "222-222-222", dataUrl));
    assert.equal(getStoredAvatar("dm", "222-222-222"), dataUrl);

    assert.doesNotThrow(() => storeAvatarRev("dm", "222-222-222", 7));
    assert.equal(getStoredAvatarRev("dm", "222-222-222"), 7);

    clearStoredAvatar("dm", "222-222-222");
    assert.equal(getStoredAvatar("dm", "222-222-222"), null);
    assert.equal(getStoredAvatarRev("dm", "222-222-222"), 0);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("avatarStore: avatarDataUrlToUploadPayload парсит mime/base64 и режет oversized payload", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/avatar/avatarStore.ts");
  try {
    const { avatarDataUrlToUploadPayload } = mod;
    const payload = avatarDataUrlToUploadPayload("data:image/webp;base64,QUJDRA==");
    assert.equal(payload.mime, "image/webp");
    assert.equal(payload.base64, "QUJDRA==");
    assert.equal(payload.bytes, 4);

    const huge = `data:image/png;base64,${"A".repeat(70_000)}`;
    assert.throws(() => avatarDataUrlToUploadPayload(huge), /avatar_transport_too_large/);
  } finally {
    await cleanup();
  }
});
