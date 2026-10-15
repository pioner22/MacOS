import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadEnvModule() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-env-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/config/env.ts")],
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
      getGatewayUrl: mod.getGatewayUrl,
      getMeetBaseUrl: mod.getMeetBaseUrl,
      getPublicBaseUrl: mod.getPublicBaseUrl,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

function installDesktopRuntime(config) {
  const hadDesktop = Object.prototype.hasOwnProperty.call(globalThis, "yagodkaDesktop");
  const hadLocation = Object.prototype.hasOwnProperty.call(globalThis, "location");
  const previousDesktop = globalThis.yagodkaDesktop;
  const previousLocation = globalThis.location;
  Object.defineProperty(globalThis, "yagodkaDesktop", {
    value: { config },
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: {
      protocol: "file:",
      href: "file:///Applications/Yagodka.app/Contents/Resources/app.asar/dist/index.html",
      hostname: "",
      host: "",
      origin: "null",
      port: "",
    },
    configurable: true,
  });
  return () => {
    if (hadDesktop) {
      Object.defineProperty(globalThis, "yagodkaDesktop", { value: previousDesktop, configurable: true });
    } else {
      delete globalThis.yagodkaDesktop;
    }
    if (hadLocation) {
      Object.defineProperty(globalThis, "location", { value: previousLocation, configurable: true });
    } else {
      delete globalThis.location;
    }
  };
}

function installCapacitorRuntime(config = {}) {
  const hadCapacitor = Object.prototype.hasOwnProperty.call(globalThis, "Capacitor");
  const hadNative = Object.prototype.hasOwnProperty.call(globalThis, "yagodkaNative");
  const hadLocation = Object.prototype.hasOwnProperty.call(globalThis, "location");
  const previousCapacitor = globalThis.Capacitor;
  const previousNative = globalThis.yagodkaNative;
  const previousLocation = globalThis.location;
  Object.defineProperty(globalThis, "Capacitor", {
    value: {
      getPlatform: () => "android",
      isNativePlatform: () => true,
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "yagodkaNative", {
    value: { config },
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: {
      protocol: "https:",
      href: "https://localhost/index.html",
      hostname: "localhost",
      host: "localhost",
      origin: "https://localhost",
      port: "",
    },
    configurable: true,
  });
  return () => {
    if (hadCapacitor) Object.defineProperty(globalThis, "Capacitor", { value: previousCapacitor, configurable: true });
    else delete globalThis.Capacitor;
    if (hadNative) Object.defineProperty(globalThis, "yagodkaNative", { value: previousNative, configurable: true });
    else delete globalThis.yagodkaNative;
    if (hadLocation) Object.defineProperty(globalThis, "location", { value: previousLocation, configurable: true });
    else delete globalThis.location;
  };
}

test("desktop runtime config drives gateway, public base, and meet URL under file://", async () => {
  const restoreRuntime = installDesktopRuntime({
    gatewayUrl: "wss://yagodka.org/ws",
    publicBaseUrl: "https://yagodka.org/",
    meetBaseUrl: "https://meet.yagodka.org",
  });
  const { getGatewayUrl, getPublicBaseUrl, getMeetBaseUrl, cleanup } = await loadEnvModule();
  try {
    assert.equal(getGatewayUrl(), "wss://yagodka.org/ws");
    assert.equal(getPublicBaseUrl(), "https://yagodka.org/");
    assert.equal(getMeetBaseUrl(), "https://meet.yagodka.org");
  } finally {
    restoreRuntime();
    await cleanup();
  }
});

test("capacitor android runtime defaults to production endpoints under localhost WebView", async () => {
  const restoreRuntime = installCapacitorRuntime();
  const { getGatewayUrl, getPublicBaseUrl, getMeetBaseUrl, cleanup } = await loadEnvModule();
  try {
    assert.equal(getGatewayUrl(), "wss://yagodka.org/ws");
    assert.equal(getPublicBaseUrl(), "https://yagodka.org/");
    assert.equal(getMeetBaseUrl(), "https://meet.yagodka.org");
  } finally {
    restoreRuntime();
    await cleanup();
  }
});

test("capacitor native runtime accepts explicit endpoint overrides", async () => {
  const restoreRuntime = installCapacitorRuntime({
    gatewayUrl: "wss://staging.example/ws",
    publicBaseUrl: "https://staging.example/app/",
    meetBaseUrl: "https://meet.example",
  });
  const { getGatewayUrl, getPublicBaseUrl, getMeetBaseUrl, cleanup } = await loadEnvModule();
  try {
    assert.equal(getGatewayUrl(), "wss://staging.example/ws");
    assert.equal(getPublicBaseUrl(), "https://staging.example/app/");
    assert.equal(getMeetBaseUrl(), "https://meet.example");
  } finally {
    restoreRuntime();
    await cleanup();
  }
});
