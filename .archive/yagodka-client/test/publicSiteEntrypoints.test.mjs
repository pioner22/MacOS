import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const clientWebRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(clientWebRoot, "..");

function readProject(rel) {
  return fs.readFileSync(path.join(projectRoot, rel), "utf8");
}

test("public site root describes project, downloads clients, and links web client separately", () => {
  const html = readProject("cite_yagodka.org/index.html");

  assert.match(html, /<title>Ягодка — мессенджер для команды<\/title>/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.match(html, /<script src="\/assets\/js\/pwa-migration\.js"><\/script>/);
  assert.match(html, /href="\/web\/"/);
  assert.match(html, /Открыть web-версию/);
  assert.match(html, /href="\/downloads\/android\/yagodka-android-debug\.apk"/);
  assert.match(html, /href="\/downloads\/macos\/yagodka-macos-x64\.zip"/);
  assert.match(html, /href="\/downloads\/cli\/yagodka-cli-client\.tar\.gz"/);
  assert.match(html, /data-yagodka-web-version/);
  assert.match(html, /data-yagodka-android-version/);
  assert.match(html, /data-yagodka-macos-version/);
  assert.match(html, /release-strip/);
  assert.match(html, /download-version/);
  assert.match(html, /Контакты и группы/);
  assert.match(html, /Каналы/);
  assert.match(html, /Файлы и медиа/);
  assert.match(html, /href="\/pages\/status\.html"/);
  assert.match(html, /Android APK и desktop ZIP сейчас предназначены для проверки/);
  assert.doesNotMatch(html, /<div id="app">/);
  assert.doesNotMatch(html, /boot-status/);
});

test("public site support pages use current product terms and honest release status", () => {
  const files = [
    "cite_yagodka.org/pages/home.html",
    "cite_yagodka.org/pages/home.mobile.html",
    "cite_yagodka.org/pages/roadmap.html",
    "cite_yagodka.org/pages/roadmap.mobile.html",
    "cite_yagodka.org/pages/status.html",
    "cite_yagodka.org/pages/shortcuts.html",
    "cite_yagodka.org/pages/pwa.html",
    "cite_yagodka.org/pages/privacy.html",
    "cite_yagodka.org/pages/security.html",
    "cite_yagodka.org/404.html",
  ];
  const combined = files.map((file) => readProject(file)).join("\n");

  assert.doesNotMatch(combined, /Доски|доски/);
  assert.doesNotMatch(combined, /Скоро/);
  assert.doesNotMatch(combined, /© 2025/);
  assert.match(combined, /© 2026/);
  assert.match(combined, /Android debug APK/);
  assert.match(combined, /не production release/);
  assert.match(combined, /root PWA migration|PWA‑установки из корня домена/);
});

test("public root migrates old installed PWA launches to /web without redirecting normal browsers", () => {
  const rootManifest = JSON.parse(readProject("cite_yagodka.org/manifest.webmanifest"));
  const migration = readProject("cite_yagodka.org/assets/js/pwa-migration.js");
  const rootServiceWorker = readProject("cite_yagodka.org/sw.js");

  assert.equal(rootManifest.start_url, "/web/");
  assert.equal(rootManifest.scope, "/web/");
  assert.equal(rootManifest.share_target.action, "/web/share/");
  assert.match(rootManifest.icons[0].src, /^\/web\/icons\//);

  assert.match(migration, /WEB_CLIENT_PATH\s*=\s*"\/web\/"/);
  assert.match(migration, /display-mode:\s*standalone/);
  assert.match(migration, /navigator\.standalone\s*===\s*true/);
  assert.match(migration, /android-app:\/\//);
  assert.match(migration, /location\.replace\(WEB_CLIENT_PATH\)/);
  assert.match(migration, /isRootPath\(\) && isStandaloneLaunch\(\)/);

  assert.match(rootServiceWorker, /clients\.matchAll\(\{ type: "window", includeUncontrolled: true \}\)/);
  assert.match(rootServiceWorker, /client\.navigate\(targetUrl\)/);
  assert.match(rootServiceWorker, /self\.registration\.unregister/);
});

test("web-www-build keeps messenger under /web and builds public root from site source", () => {
  const makefile = readProject("makefile");
  const builder = readProject("devtools/build_public_site.py");
  const rootServiceWorker = readProject("cite_yagodka.org/sw.js");

  assert.match(makefile, /PUBLIC_SITE_ROOT \?= cite_yagodka\.org/);
  assert.match(makefile, /build_public_site\.py/);
  assert.match(makefile, /--web-dist "\$\(WEB_CLIENT_DIR\)\/dist"/);
  assert.match(makefile, /--client-android-dir "\$\(ANDROID_CLIENT_DIR\)"/);
  assert.match(makefile, /--client-macos-dir "\$\(MACOS_CLIENT_DIR\)"/);
  assert.doesNotMatch(makefile, /dist\/" "\$\(WWW_ROOT\)\/"/);
  assert.match(builder, /android\/yagodka-android-debug\.apk/);
  assert.match(builder, /macos\/yagodka-macos-x64\.zip/);
  assert.match(builder, /cli\/yagodka-cli-client\.tar\.gz/);
  assert.match(builder, /desktop-updates/);
  assert.match(builder, /latest-mac\.yml/);
  assert.match(builder, /parse_web_build_id/);
  assert.match(builder, /patch_version_placeholders/);
  assert.match(builder, /web_version/);
  assert.match(rootServiceWorker, /legacy root-scope messenger service worker/);
  assert.match(rootServiceWorker, /self\.registration\.unregister/);
  assert.match(rootServiceWorker, /fetch\(event\.request\)/);
});

test("downloaded client builds keep production endpoints after web split", () => {
  const env = readProject("client-web/src/config/env.ts");
  const desktopMain = readProject("client-macos/desktop/main.cjs");
  const desktopPreload = readProject("client-macos/desktop/preload.cjs");
  const cliClient = readProject("client-cli/bin/client.py");
  const distClient = readProject("server/dist/client.py");

  assert.match(env, /DEFAULT_NATIVE_GATEWAY_URL\s*=\s*"wss:\/\/yagodka\.org\/ws"/);
  assert.match(env, /DEFAULT_NATIVE_PUBLIC_BASE_URL\s*=\s*"https:\/\/yagodka\.org\/"/);
  assert.match(env, /DEFAULT_NATIVE_MEET_BASE_URL\s*=\s*"https:\/\/meet\.yagodka\.org"/);
  assert.match(desktopMain, /DEFAULT_GATEWAY_URL\s*=\s*"wss:\/\/yagodka\.org\/ws"/);
  assert.match(desktopMain, /DEFAULT_PUBLIC_BASE_URL\s*=\s*"https:\/\/yagodka\.org\/"/);
  assert.match(desktopMain, /DEFAULT_UPDATE_FEED_URL\s*=\s*"https:\/\/yagodka\.org\/desktop-updates\/mac\/"/);
  assert.match(desktopPreload, /DEFAULT_GATEWAY_URL\s*=\s*"wss:\/\/yagodka\.org\/ws"/);
  assert.match(cliClient, /DEFAULT_UPDATE_URL\s*=\s*"https:\/\/yagodka\.org:17778"/);
  assert.match(cliClient, /'yagodka\.org:7778'/);
  assert.match(distClient, /DEFAULT_UPDATE_URL\s*=\s*"https:\/\/yagodka\.org:17778"/);
  assert.match(distClient, /'yagodka\.org:7778'/);
});
