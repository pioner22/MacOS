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
      entryPoints: [path.resolve("src/helpers/files/fileHttpAuth.ts")],
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
      liftFileHttpTokenToBearer: mod.liftFileHttpTokenToBearer,
      rememberFileHttpBearer: mod.rememberFileHttpBearer,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

function setDesktopPublicBaseUrl(publicBaseUrl) {
  const hadDesktop = Object.prototype.hasOwnProperty.call(globalThis, "yagodkaDesktop");
  const previousDesktop = globalThis.yagodkaDesktop;
  Object.defineProperty(globalThis, "yagodkaDesktop", {
    value: { config: { publicBaseUrl } },
    configurable: true,
  });
  return () => {
    if (hadDesktop) {
      Object.defineProperty(globalThis, "yagodkaDesktop", {
        value: previousDesktop,
        configurable: true,
      });
    } else {
      delete globalThis.yagodkaDesktop;
    }
  };
}

function setNativePublicBaseUrl(publicBaseUrl) {
  const hadCapacitor = Object.prototype.hasOwnProperty.call(globalThis, "Capacitor");
  const previousCapacitor = globalThis.Capacitor;
  const hadNative = Object.prototype.hasOwnProperty.call(globalThis, "yagodkaNative");
  const previousNative = globalThis.yagodkaNative;
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "Capacitor", {
    value: {
      getPlatform: () => "android",
      isNativePlatform: () => true,
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "yagodkaNative", {
    value: { config: { publicBaseUrl } },
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: { href: "https://localhost/index.html" },
    configurable: true,
  });
  return () => {
    if (hadCapacitor) {
      Object.defineProperty(globalThis, "Capacitor", {
        value: previousCapacitor,
        configurable: true,
      });
    } else {
      delete globalThis.Capacitor;
    }
    if (hadNative) {
      Object.defineProperty(globalThis, "yagodkaNative", {
        value: previousNative,
        configurable: true,
      });
    } else {
      delete globalThis.yagodkaNative;
    }
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
    else delete globalThis.location;
  };
}

test("fileHttpAuth: вычищает legacy t= из query и не поднимает его в Authorization header", async () => {
  const { liftFileHttpTokenToBearer, cleanup } = await loadHelper();
  try {
    const out = liftFileHttpTokenToBearer("/files/f123?t=abc123&x=1", { base: "https://yagodka.org/app" });
    assert.equal(out.url, "https://yagodka.org/files/f123?x=1");
    assert.deepEqual(out.headers, {});
  } finally {
    await cleanup();
  }
});

test("fileHttpAuth: file:// base использует desktop public base для bearer URL", async () => {
  const restoreDesktop = setDesktopPublicBaseUrl("https://yagodka.org/");
  const { liftFileHttpTokenToBearer, rememberFileHttpBearer, cleanup } = await loadHelper();
  try {
    const normalized = rememberFileHttpBearer("/files/f888", "desktop-secret", {
      base: "file:///Applications/Yagodka.app/Contents/Resources/app.asar/dist/index.html",
    });
    assert.equal(normalized, "https://yagodka.org/files/f888");
    const out = liftFileHttpTokenToBearer("/files/f888", {
      base: "file:///Applications/Yagodka.app/Contents/Resources/app.asar/dist/index.html",
    });
    assert.equal(out.url, "https://yagodka.org/files/f888");
    assert.deepEqual(out.headers, { Authorization: "Bearer desktop-secret" });
  } finally {
    restoreDesktop();
    await cleanup();
  }
});

test("fileHttpAuth: native https://localhost base использует public base вместо WebView origin", async () => {
  const restoreNative = setNativePublicBaseUrl("https://yagodka.org/");
  const { liftFileHttpTokenToBearer, rememberFileHttpBearer, cleanup } = await loadHelper();
  try {
    const normalized = rememberFileHttpBearer("/files/f999", "native-secret");
    assert.equal(normalized, "https://yagodka.org/files/f999");
    const out = liftFileHttpTokenToBearer("/files/f999");
    assert.equal(out.url, "https://yagodka.org/files/f999");
    assert.deepEqual(out.headers, { Authorization: "Bearer native-secret" });
  } finally {
    restoreNative();
    await cleanup();
  }
});

test("fileHttpAuth: оставляет URL без изменений если signed token отсутствует", async () => {
  const { liftFileHttpTokenToBearer, cleanup } = await loadHelper();
  try {
    const out = liftFileHttpTokenToBearer("https://yagodka.org/files/f123?x=1");
    assert.equal(out.url, "https://yagodka.org/files/f123?x=1");
    assert.deepEqual(out.headers, {});
  } finally {
    await cleanup();
  }
});

test("fileHttpAuth: подхватывает bearer из runtime-хранилища для чистого URL", async () => {
  const { liftFileHttpTokenToBearer, rememberFileHttpBearer, cleanup } = await loadHelper();
  try {
    const normalized = rememberFileHttpBearer("/files/f777", "mem-secret", { base: "https://yagodka.org/app" });
    assert.equal(normalized, "https://yagodka.org/files/f777");
    const out = liftFileHttpTokenToBearer("/files/f777", { base: "https://yagodka.org/app" });
    assert.equal(out.url, "https://yagodka.org/files/f777");
    assert.deepEqual(out.headers, { Authorization: "Bearer mem-secret" });
  } finally {
    await cleanup();
  }
});
