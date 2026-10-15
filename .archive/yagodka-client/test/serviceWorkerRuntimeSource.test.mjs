import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("service worker runtime is disabled for Electron/native/file builds", () => {
  const runtime = fs.readFileSync(path.join(root, "src/helpers/pwa/serviceWorkerRuntime.ts"), "utf8");
  const register = fs.readFileSync(path.join(root, "src/helpers/pwa/registerServiceWorker.ts"), "utf8");
  assert.match(runtime, /yagodkaDesktop/);
  assert.match(runtime, /isCapacitorNativeRuntime/);
  assert.ok(runtime.includes('protocol === "http:" || protocol === "https:"'));
  assert.ok(runtime.includes("navigator.serviceWorker.getRegistrations()"));
  assert.ok(register.includes("unregisterServiceWorkersForUnsupportedRuntime"));
});

test("service worker inline media streams stay inline in generated PWA output", () => {
  const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  const buildPwa = fs.readFileSync(path.join(root, "scripts/build_pwa.mjs"), "utf8");
  for (const source of [sw, buildPwa]) {
    assert.match(source, /searchParams\.get\("inline"\)/);
    assert.match(source, /inline \? "inline" : "attachment"/);
    assert.match(source, /PWA_MEDIA_SOURCE_REGISTER/);
    assert.match(source, /MEDIA_PROXY_PATH_RE/);
    assert.match(source, /Content-Range/);
    assert.match(source, /upstreamHeaders\.set\(name, value\)/);
  }
});
