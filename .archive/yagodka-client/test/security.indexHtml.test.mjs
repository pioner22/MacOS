import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("security: index.html без inline <script> (CSP script-src 'self')", async () => {
  const htmlPath = path.resolve("index.html");
  const html = await readFile(htmlPath, "utf8");

  const inline = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = String(m[1] || "");
    const body = String(m[2] || "");
    const hasSrc = /\bsrc\s*=\s*["'][^"']+["']/i.test(attrs);
    if (hasSrc) continue;
    if (body.trim().length === 0) continue;
    inline.push({ attrs: attrs.trim().slice(0, 120), body: body.trim().slice(0, 120) });
  }

  assert.equal(inline.length, 0, `Найдены inline <script> в index.html: ${JSON.stringify(inline)}`);
});

test("entry boot screen: strict corporate surface without animated layout shifts", async () => {
  const html = await readFile(path.resolve("index.html"), "utf8");

  assert.match(html, /Corporate Messenger/);
  assert.match(html, /Проверяем версию клиента/);
  assert.match(html, /<html lang="ru" class="app-frame-booting">/);
  assert.match(html, /<div id="app" class="app-frame app-frame-booting">/);
  assert.match(html, /<meta name="theme-color" content="#eaf5f0" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="default" \/>/);
  assert.doesNotMatch(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(html, /--app-host-canvas-bg:\s*#eaf5f0;/);
  assert.match(html, /--app-frame-bg:\s*var\(--app-host-canvas-bg\);/);
  assert.match(html, /html\.app-frame-booting,\s*html\.app-frame-booting body\s*{[^}]*--app-host-canvas-bg:\s*#eaf5f0;/s);
  assert.match(html, /--app-shell-bottom-spill:\s*0px;/);
  assert.doesNotMatch(html, /--app-frame-bg:\s*#0d1117;/);
  assert.match(html, /background:\s*var\(--app-frame-bg,\s*var\(--body-bg,\s*var\(--app-bg,\s*#eaf5f0\)\)\);/);
  assert.match(html, /background-color:\s*var\(--app-host-canvas-bg\);/);
  assert.match(html, /#app\s*{[^}]*position:\s*fixed;[^}]*top:\s*0;[^}]*right:\s*0;[^}]*left:\s*0;[^}]*bottom:\s*auto;[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
  assert.doesNotMatch(html, /bottom:\s*calc\(-1 \* var\(--app-shell-bottom-spill/);
  assert.match(html, /\.boot-frame\s*{[^}]*border-radius:\s*8px;/s);
  assert.match(html, /\.boot\.boot-out\s*{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s);
  assert.doesNotMatch(html, /@keyframes\s+boot-/);
  assert.doesNotMatch(html, /animation:\s*boot-/);
  assert.doesNotMatch(html, /filter:\s*blur/);
  assert.doesNotMatch(html, /transform:\s*scale/);
});

test("entry boot recovery loads before app bundle", async () => {
  const html = await readFile(path.resolve("index.html"), "utf8");
  const bootIndex = html.indexOf('src="/boot.js"');
  const appIndex = html.indexOf('src="/src/index.ts"');

  assert.ok(bootIndex > -1, "boot.js script is missing");
  assert.ok(appIndex > -1, "app entry script is missing");
  assert.ok(bootIndex < appIndex, "boot.js must load before the app entry");
  assert.match(html, /<script\s+defer\s+src="\/boot\.js"><\/script>/);
  assert.doesNotMatch(html, /<script\s+type="module"\s+src="\/boot\.js"><\/script>/);
});

test("PWA manifest uses light auth-safe-area launch background", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("public/manifest.webmanifest"), "utf8"));

  assert.equal(manifest.background_color, "#eaf5f0");
  assert.equal(manifest.theme_color, "#eaf5f0");
});
