import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile app frame: boot/auth/main share one root frame state", async () => {
  const html = await readFile(path.resolve("index.html"), "utf8");
  const createLayout = await readFile(path.resolve("src/components/layout/createLayout.ts"), "utf8");
  const renderApp = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  const lateWiring = await readFile(path.resolve("src/app/bootstrap/installLateWiring.ts"), "utf8");
  const baseCss = await readFile(path.resolve("src/scss/base.css"), "utf8");

  assert.match(html, /<html lang="ru" class="app-frame-booting">/);
  assert.match(html, /id="app" class="app-frame app-frame-booting"/);
  assert.match(createLayout, /root\.classList\.add\("app-frame"\)/);
  assert.match(createLayout, /root,/);
  assert.match(renderApp, /layout\.root\?\.classList\.toggle\("app-frame-auth",\s*fullScreenActive\)/);
  assert.match(renderApp, /layout\.root\?\.classList\.toggle\("app-frame-main",\s*!fullScreenActive\)/);
  assert.match(lateWiring, /root\.classList\.remove\("app-frame-booting"\)/);
  assert.match(lateWiring, /document\.documentElement\.classList\.remove\("app-frame-booting"\)/);
  assert.doesNotMatch(baseCss, /#app\.app-frame\s*>\s*\.boot\s*{[^}]*position:\s*relative;/s);
  assert.match(baseCss, /#app\.app-frame\s*>\s*\.boot\s*{[^}]*z-index:\s*3;/s);
});

test("mobile app frame: auth stays inside fixed shell instead of owning viewport", async () => {
  const css = await readFile(path.resolve("src/scss/modal.part01-auth.css"), "utf8");

  assert.doesNotMatch(css, /html\.is-ios\.has-auth-pages\s*{[^}]*position:\s*static;/s);
  assert.doesNotMatch(css, /html\.has-auth-pages\s+#app\s*{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s);
  assert.doesNotMatch(css, /\.overlay\.overlay-auth\s*{[^}]*position:\s*fixed;/s);
  assert.match(css, /html\.is-ios\.has-auth-pages\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
  assert.match(css, /html\.has-auth-pages\s+#app\s*{[^}]*height:\s*var\(--auth-viewport-min\);[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.overlay\.overlay-auth\s*{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /#auth-pages\.auth-entry-page\s+>\s+\.auth-entry-scroll\s*{[^}]*height:\s*100%;[^}]*overflow-y:\s*hidden;/s);
});

test("mobile app frame: contact list owns the full fixed mobile frame without a footer row slide", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");

  assert.match(css, /html\s+#app\s*>\s*\.app\s*\{[\s\S]*?--app-row-footer:\s*0px;/);
  assert.match(css, /:root\[data-skin\]\s*\{[\s\S]*?--app-row-footer:\s*0px;/);
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?bottom:\s*auto;[\s\S]*?height:\s*var\(--app-logged-frame-vh\);[\s\S]*?min-height:\s*var\(--app-logged-frame-vh\);[\s\S]*?max-height:\s*none;/
  );
  assert.match(
    css,
    /html\s+#app\s*>\s*\.app\s*\{[\s\S]*?display:\s*block;[\s\S]*?height:\s*100%;/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\),[\s\S]*?html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?--app-logged-frame-vh:\s*max\([^}]*var\(--app-frame-vh,\s*var\(--app-vh\)\)[^}]*calc\(var\(--app-vh\)\s*\+\s*var\(--app-physical-bottom-pad\)\)/
  );
  assert.match(css, /--app-frame-bottom-inset:\s*var\(--app-logged-bottom-fill\);/);
  assert.match(css, /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\):has\(\.sidebar\.sidebar-mobile-open\)/);
  assert.match(
    css,
    /\.grid\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*100%;[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(
    css,
    /\.hdr\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?z-index:\s*34;[\s\S]*?min-height:\s*var\(--mobile-header-overlay-h\);/
  );
  assert.match(
    css,
    /\.sidebar\s*\{[\s\S]*?display:\s*block;[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?width:\s*100vw;[\s\S]*?transform:\s*none;[\s\S]*?visibility:\s*hidden;/
  );
  assert.match(
    css,
    /\.sidebar\.sidebar-mobile-open\s*\{[\s\S]*?transform:\s*none;[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/
  );
  assert.match(css, /--mobile-bottom-nav-h:\s*calc\(var\(--mobile-bottom-nav-row-h\)\s*\+\s*var\(--mobile-bottom-nav-fill\)\);/);
  assert.match(css, /--mobile-bottom-nav-scroll-pad:\s*calc\(var\(--mobile-bottom-nav-h\)\s*\+\s*24px\);/);
  assert.match(css, /--mobile-bottom-nav-bottom-offset:\s*0px;/);
  assert.match(css, /--mobile-bottom-nav-glass-bg:\s*rgba\(24,\s*24,\s*32,\s*0\.58\);/);
  assert.match(css, /--mobile-bottom-nav-active-bg:\s*rgba\(255,\s*255,\s*255,\s*0\.16\);/);
  assert.match(css, /\.sidebar-mobile-sticky\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?min-height:\s*var\(--mobile-sidebar-sticky-h\);[\s\S]*?align-items:\s*flex-end;/);
  assert.match(css, /\.sidebar-mobile-sticky\s*\{[\s\S]*?padding:\s*calc\(env\(safe-area-inset-top\)\s*\+\s*6px\)\s+10px\s+8px;/);
  assert.match(css, /\.sidebar-mobile-bottom\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?bottom:\s*var\(--mobile-bottom-nav-bottom-offset\);[\s\S]*?height:\s*var\(--mobile-bottom-nav-row-h\);/);
  assert.match(css, /\.sidebar-mobile-bottom\s*\{[\s\S]*?align-items:\s*flex-end;/);
  assert.match(css, /\.sidebar-mobile-bottom\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?flex:\s*0\s+0\s+calc\(100%\s*-\s*24px\);[\s\S]*?width:\s*calc\(100%\s*-\s*24px\);[\s\S]*?max-width:\s*372px;/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?height:\s*56px;[\s\S]*?border-radius:\s*999px;/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?background:\s*var\(--mobile-bottom-nav-glass-bg\);[\s\S]*?backdrop-filter:\s*blur\(28px\)\s+saturate\(1\.22\);/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s+\.sidebar-tab-active\s*\{[\s\S]*?background:\s*var\(--mobile-bottom-nav-active-bg\);/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s+\.sidebar-tab\s*\{[\s\S]*?height:\s*100%;[\s\S]*?padding-inline:\s*2px;[\s\S]*?font-size:\s*11px;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /html\.env-os-android\s+\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s+\.sidebar-tab\s*\{[\s\S]*?font-size:\s*11px;/);
  assert.match(css, /\.sidebar-bottom-dock:not\(\.sidebar-mobile-bottom\)\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /\.sidebar-body\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?height:\s*auto;[\s\S]*?padding-top:\s*var\(--mobile-sidebar-sticky-h\);[\s\S]*?padding-bottom:\s*var\(--mobile-bottom-nav-scroll-pad\);/);
  assert.match(css, /\.sidebar-body\s*>\s*\.chatlist::after\s*\{[\s\S]*?height:\s*calc\(var\(--mobile-bottom-nav-h\)\s*\+\s*12px\);[\s\S]*?min-height:\s*96px;/);
  assert.match(css, /\.sidebar\[data-sidebar-tab="menu"\]\s+\.sidebar-body\s*\{[\s\S]*?padding-top:\s*var\(--mobile-sidebar-menu-sticky-h\);/);
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.sidebar\s*\{[\s\S]*?--mobile-bottom-nav-fill:\s*var\(--app-logged-bottom-fill\);[\s\S]*?--mobile-bottom-nav-bottom-offset:\s*var\(--app-logged-bottom-fill\);/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.sidebar-body\s*\{[\s\S]*?padding-bottom:\s*var\(--mobile-bottom-nav-scroll-pad\);/
  );
  assert.match(css, /\.footer\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?min-height:\s*0;/);
  const appShellBlock =
    css.match(/html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{(?<body>[^}]*)\}/)?.groups
      ?.body || "";
  const appFrameBlock =
    css.match(/html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*>\s*\.app\s*\{(?<body>[^}]*)\}/)
      ?.groups?.body || "";
  assert.doesNotMatch(appShellBlock, /height:\s*var\(--app-logged-frame-vh\);/);
  assert.doesNotMatch(appFrameBlock, /height:\s*var\(--app-logged-frame-vh\);/);
});
