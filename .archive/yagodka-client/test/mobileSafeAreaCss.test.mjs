import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile safe-area: mobile fullscreen overrides win against skins", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{/);
  assert.match(css, /#app\s*\{[\s\S]*?--app-outer-pad:\s*0px;/);
  assert.match(css, /#app\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /#app\s*\{[\s\S]*?inset:\s*0\s*;/);
  assert.match(css, /#app\s*\{[\s\S]*?height:\s*var\(--app-vh\)\s*;/);
  assert.match(css, /#app\s*\{[\s\S]*?overflow:\s*hidden\s*;/);
  assert.match(css, /app-vv-offset\s+#app\s*\{[\s\S]*?top:\s*var\(--app-vv-top,\s*0px\)\s*;/);
  assert.match(css, /app-vv-offset\s+#app\s*\{[\s\S]*?bottom:\s*var\(--app-vv-bottom,\s*0px\)\s*;/);
  assert.match(css, /app-vv-offset\s+#app\s*\{[\s\S]*?height:\s*auto\s*;/);
  assert.match(css, /#app\s*>\s*\.app\s*\{[\s\S]*?--app-row-footer:\s*0px;/);
});

test("mobile safe-area: composer bottom padding avoids extra gap", async () => {
  const css = await readFile(path.resolve("src/scss/layout.css"), "utf8");
  assert.match(css, /\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*max\b/);
  assert.match(css, /padding-bottom:\s*max\([^;]*--app-bottom-live-pad/);
  assert.doesNotMatch(css, /\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*max\([^;]*--app-bottom-inset/);
});

test("mobile safe-area: one bottom inset owns safe-area and PWA gap", async () => {
  const css = await readFile(path.resolve("src/scss/base.css"), "utf8");
  const responsiveCss = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /--safe-bottom-pad:\s*clamp\(\s*0px\s*,\s*env\(safe-area-inset-bottom\)\s*,\s*44px\s*\)\s*;/);
  assert.match(css, /--app-layout-gap-bottom:\s*var\(--app-gap-bottom\)\s*;/);
  assert.match(css, /--app-shell-bottom-spill:\s*0px\s*;/);
  assert.match(css, /--app-bottom-inset:\s*max\(var\(--safe-bottom-pad\),\s*var\(--app-layout-gap-bottom,\s*var\(--app-gap-bottom,\s*0px\)\)\)\s*;/);
  assert.match(css, /--app-physical-bottom-pad:\s*var\(--app-bottom-inset\)\s*;/);
  assert.match(css, /--app-bottom-live-pad:\s*clamp\(8px,\s*calc\(var\(--app-bottom-inset\)\s*-\s*22px\),\s*16px\)\s*;/);
  assert.match(css, /--app-frame-bottom-inset:\s*0px\s*;/);
  assert.match(css, /--safe-bottom-layout-pad:\s*var\(--app-bottom-live-pad\)\s*;/);
  assert.match(css, /--app-frame-bg:\s*var\(--app-bg\)\s*;/);
  assert.match(css, /--app-host-canvas-bg:\s*var\(--safe-area-bg,\s*var\(--app-frame-bg,\s*var\(--app-bg\)\)\)\s*;/);
  assert.match(css, /background-color:\s*var\(--app-host-canvas-bg,\s*var\(--safe-area-bg,\s*var\(--app-frame-bg,\s*#eaf5f0\)\)\)\s*;/);
  assert.match(css, /html\.app-frame-booting,\s*html\.app-frame-booting body\s*\{[\s\S]*?--app-host-canvas-bg:\s*#eaf5f0;/);
  assert.match(css, /#app\.app-frame::after\s*\{[\s\S]*?background:\s*var\(--app-frame-safe-bg,/);
  assert.match(css, /#app\.app-frame::after\s*\{[\s\S]*?height:\s*var\(--app-frame-bottom-inset\)/);
  assert.match(responsiveCss, /html,\s*body\s*\{[\s\S]*?--safe-area-bg:\s*var\(--composer-bg\);[\s\S]*?--app-host-canvas-bg:\s*var\(--safe-area-bg\);/);
  assert.match(responsiveCss, /html\.sidebar-mobile-open,\s*html\.sidebar-mobile-open body\s*\{[\s\S]*?--safe-area-bg:\s*var\(--sidebar-bg\);/);
  assert.doesNotMatch(css, /--safe-bottom-layout-pad:\s*max\(0px,\s*calc\(var\(--safe-bottom-pad\)\s*-\s*var\(--app-gap-bottom/);
});

test("mobile safe-area: diagnostic markers are debug-gated and expose every bottom layer", async () => {
  const baseCss = await readFile(path.resolve("src/scss/base.css"), "utf8");
  const responsiveCss = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  const authCss = await readFile(path.resolve("src/scss/modal.part01-auth.css"), "utf8");
  assert.match(baseCss, /data-viewport-diagnostic="1"/);
  assert.match(baseCss, /\.app-frame-diagnostic-panel\s*\{/);
  assert.match(baseCss, /pointer-events:\s*none;/);
  assert.match(authCss, /body\[data-viewport-diagnostic="1"\][\s\S]*AUTH-SCROLL-END/);
  assert.match(responsiveCss, /body\[data-viewport-diagnostic="1"\]\s+\.sidebar-body::after[\s\S]*SIDEBAR-SCROLL-END/);
  assert.match(responsiveCss, /body\[data-viewport-diagnostic="1"\]\s+\.input-wrap::after[\s\S]*CHAT-COMPOSER-BOTTOM/);
  assert.match(baseCss, /PHYSICAL-BOTTOM/);
  assert.match(baseCss, /APP-FRAME-BOTTOM/);
  assert.match(authCss, /AUTH-SCROLL-END/);
  assert.match(responsiveCss, /SIDEBAR-SCROLL-END/);
  assert.match(responsiveCss, /CHAT-COMPOSER-BOTTOM/);
});

test("mobile safe-area: physical bottom gap and viewer surface paint the host canvas", async () => {
  const baseCss = await readFile(path.resolve("src/scss/base.css"), "utf8");
  const polishCss = await readFile(path.resolve("src/scss/polish.css"), "utf8");
  const viewportSrc = await readFile(path.resolve("src/helpers/ui/appViewport.ts"), "utf8");
  const modalSurfaceSrc = await readFile(path.resolve("src/app/features/navigation/modalSurface.ts"), "utf8");

  assert.match(viewportSrc, /const physicalBottom = !keyboard && gap >= 1;/);
  assert.match(baseCss, /html\.app-shell-physical-bottom:not\(\.kbd-open\):not\(\.has-auth-pages\)\s*\{[\s\S]*?--app-frame-bottom-inset:\s*max\(var\(--app-gap-bottom,\s*0px\),\s*var\(--safe-bottom-pad,\s*0px\)\);/);
  assert.match(modalSurfaceSrc, /viewer-surface-open/);
  assert.match(polishCss, /html\.viewer-surface-open,[\s\S]*?html\.viewer-surface-open body::after\s*\{[\s\S]*?--app-host-canvas-bg:\s*#000;/);
  assert.match(polishCss, /html\.viewer-surface-open \.overlay\.overlay-viewer,[\s\S]*?\.viewer-rail\s*\{[\s\S]*?background:\s*#000;/);
  assert.match(polishCss, /html\.app-shell-physical-bottom:not\(\.kbd-open\):not\(\.has-auth-pages\) body::after\s*\{[\s\S]*?height:\s*max\(var\(--app-frame-bottom-inset,\s*0px\),\s*var\(--app-gap-bottom,\s*0px\),\s*var\(--safe-bottom-pad,\s*0px\)\);/);
  assert.match(polishCss, /html\.viewer-surface-open::after\s*\{[\s\S]*?height:\s*max\(var\(--app-frame-bottom-inset,\s*0px\),\s*var\(--app-gap-bottom,\s*0px\),\s*var\(--safe-bottom-pad,\s*0px\),\s*env\(safe-area-inset-bottom\)\);[\s\S]*?z-index:\s*79;/);
});

test("mobile safe-area: pages have bottom padding for home indicator", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /\.page\s*\{[\s\S]*?padding-bottom:\s*calc\(\s*var\(--sp-4\)\s*\+\s*var\(--safe-bottom-layout-pad\)\s*\)\s*;/);
});

test("mobile safe-area: profile pages paint the physical bottom without a white footer", async () => {
  const renderAppSrc = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  const css = await readFile(path.resolve("src/scss/polish.css"), "utf8");

  assert.match(renderAppSrc, /const profileSurfaceActive = state\.page === "profile" \|\| state\.page === "sessions";/);
  assert.match(renderAppSrc, /document\.documentElement\.classList\.toggle\("has-profile-surface",\s*profileSurfaceActive\)/);
  assert.match(renderAppSrc, /document\.body\.classList\.toggle\("has-profile-surface",\s*profileSurfaceActive\)/);
  assert.match(css, /W-1037:\s*profile page owns mobile bottom canvas/);
  assert.match(
    css,
    /html\.has-profile-surface:not\(\.has-auth-pages\),[\s\S]*?html\.has-profile-surface:not\(\.has-auth-pages\)\s+body,[\s\S]*?html\.has-profile-surface:not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?--safe-area-bg:\s*var\(--profile-surface-bg\);[\s\S]*?--app-host-canvas-bg:\s*var\(--profile-surface-bg\);/
  );
  assert.match(
    css,
    /html\.has-profile-surface:not\(\.has-auth-pages\)\s+body::after,[\s\S]*?html\.has-profile-surface:not\(\.has-auth-pages\)\s+#app\.app-frame::after\s*\{[\s\S]*?background:\s*var\(--profile-surface-bg\);/
  );
  assert.match(
    css,
    /html\.has-profile-surface:not\(\.has-auth-pages\)\s+\.chat\.chat-page,[\s\S]*?html\.has-profile-surface:not\(\.has-auth-pages\)\s+\.chat\.chat-page\s+\.chat-host,[\s\S]*?html\.has-profile-surface:not\(\.has-auth-pages\)\s+\.chat\.chat-page\s+\.page\.page-profile\s*\{[\s\S]*?background-color:\s*var\(--profile-surface-bg\);/
  );
});

test("mobile safe-area: profile pages reserve bottom scroll clearance", async () => {
  const css = await readFile(path.resolve("src/scss/polish.css"), "utf8");

  assert.match(css, /W-1038:\s*profile pages keep the last card above the mobile bottom well/);
  assert.match(
    css,
    /--profile-bottom-clearance:\s*max\(\s*104px\s*,\s*var\(--app-frame-bottom-inset,\s*0px\),\s*var\(--app-bottom-inset,\s*0px\),\s*var\(--safe-bottom-pad,\s*0px\),\s*env\(safe-area-inset-bottom\)\s*\)\s*;/
  );
  assert.match(
    css,
    /html\.has-profile-surface:not\(\.has-auth-pages\)\s+\.chat\.chat-page\s+\.chat-host\s*\{[\s\S]*?scroll-padding-bottom:\s*var\(--profile-bottom-clearance\);/
  );
  assert.match(
    css,
    /html\.has-profile-surface:not\(\.has-auth-pages\)\s+\.chat\.chat-page\s+\.page\.page-profile,[\s\S]*?html\.has-profile-surface:not\(\.has-auth-pages\)\s+\.chat\.chat-page\s+\.page\.page-sessions\s*\{[\s\S]*?padding-bottom:\s*calc\(12px\s*\+\s*var\(--profile-bottom-clearance\)\)\s*;/
  );
});

test("mobile safe-area: iOS standalone fixed frame owns shell while viewer stays visual", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /--app-logged-frame-vh:\s*max\(/);
  assert.match(css, /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app/);
  assert.match(css, /calc\(var\(--app-frame-vh,\s*var\(--app-vh\)\)\s*-\s*var\(--app-vh,\s*100dvh\)\)/);
  assert.match(css, /--app-frame-bottom-inset:\s*var\(--app-logged-bottom-fill\);/);
  assert.match(css, /--mobile-header-overlay-h:\s*calc\(env\(safe-area-inset-top\)\s*\+\s*96px\);/);
  assert.match(css, /--mobile-sidebar-sticky-h:\s*calc\(env\(safe-area-inset-top\)\s*\+\s*72px\);/);
  assert.match(css, /--mobile-bottom-nav-fill:\s*var\(--app-bottom-live-pad\);/);
  assert.match(css, /--mobile-bottom-nav-row-h:\s*74px;/);
  assert.match(css, /--mobile-bottom-nav-h:\s*calc\(var\(--mobile-bottom-nav-row-h\)\s*\+\s*var\(--mobile-bottom-nav-fill\)\);/);
  assert.match(css, /--mobile-bottom-nav-scroll-pad:\s*calc\(var\(--mobile-bottom-nav-h\)\s*\+\s*24px\);/);
  assert.match(css, /\.sidebar-body\s*>\s*\.chatlist::after\s*\{[\s\S]*?height:\s*calc\(var\(--mobile-bottom-nav-h\)\s*\+\s*12px\);[\s\S]*?min-height:\s*96px;/);
  assert.match(css, /--mobile-bottom-nav-bottom-offset:\s*0px;/);
  assert.match(css, /--mobile-bottom-nav-glass-bg:\s*rgba\(24,\s*24,\s*32,\s*0\.58\);/);
  assert.match(css, /--mobile-bottom-nav-glass-border:\s*rgba\(255,\s*255,\s*255,\s*0\.14\);/);
  assert.match(css, /--mobile-composer-bottom-offset:\s*5px;/);
  assert.match(css, /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?bottom:\s*auto;/);
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?height:\s*var\(--app-logged-frame-vh\);[\s\S]*?min-height:\s*var\(--app-logged-frame-vh\);/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\),[\s\S]*?html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?--app-logged-frame-vh:\s*max\(/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?max-height:\s*none;/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*>\s*\.app\s*\{[\s\S]*?height:\s*100%;[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.grid,[\s\S]*?html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.sidebar\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.input-wrap\s*\{[\s\S]*?--mobile-composer-bottom-offset:\s*5px;[\s\S]*?--composer-bottom-edge-pad:\s*max\(var\(--composer-pad-y\),\s*var\(--app-bottom-live-pad\),\s*var\(--app-logged-bottom-fill\)\);[\s\S]*?bottom:\s*var\(--mobile-composer-bottom-offset\);/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.input-wrap::before\s*\{[\s\S]*?display:\s*none;[\s\S]*?bottom:\s*0;[\s\S]*?height:\s*0;/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.sidebar\s*\{[\s\S]*?--mobile-bottom-nav-fill:\s*var\(--app-logged-bottom-fill\);[\s\S]*?--mobile-bottom-nav-bottom-offset:\s*var\(--app-logged-bottom-fill\);/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.sidebar-body\s*\{[\s\S]*?margin-bottom:\s*0;[\s\S]*?padding-bottom:\s*var\(--mobile-bottom-nav-scroll-pad\);/
  );
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?background:/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?flex:\s*0\s+0\s+calc\(100%\s*-\s*24px\);[\s\S]*?width:\s*calc\(100%\s*-\s*24px\);[\s\S]*?max-width:\s*372px;/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?background:\s*var\(--mobile-bottom-nav-glass-bg\);[\s\S]*?backdrop-filter:\s*blur\(28px\)\s+saturate\(1\.22\);/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s+\.sidebar-tab-active\s*\{[\s\S]*?background:\s*var\(--mobile-bottom-nav-active-bg\);/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s+\.sidebar-tab\s*\{[\s\S]*?padding-inline:\s*2px;/);
  assert.match(css, /\.sidebar-mobile-bottom\s*\{[\s\S]*?bottom:\s*var\(--mobile-bottom-nav-bottom-offset\);[\s\S]*?height:\s*var\(--mobile-bottom-nav-row-h\);/);
  assert.match(css, /\.sidebar-mobile-bottom\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(css, /\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /html\.env-os-android\s+\.sidebar-tabs\.sidebar-tabs-mobile\.sidebar-tabs-bottom-nav\s+\.sidebar-tab\s*\{[\s\S]*?font-size:\s*11px;/);
  assert.match(css, /\.sidebar-tab::before\s*\{[\s\S]*?mask:\s*var\(--sidebar-tab-icon\)\s+no-repeat\s+center\s*\/\s*contain;/);
  assert.match(css, /data-tab-icon="contacts"/);
  assert.doesNotMatch(css, /content:\s*attr\(data-tab-icon\)/);
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.overlay\.overlay-viewer\s*\{[\s\S]*?bottom:\s*auto;[\s\S]*?height:\s*var\(--app-vh\);[\s\S]*?max-height:\s*var\(--app-vh\);/
  );
  const appShellBlock =
    css.match(/html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{\s*bottom:\s*auto;(?<body>[^}]*)\}/)?.groups
      ?.body || "";
  const appFrameBlock =
    css.match(/html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*>\s*\.app\s*\{(?<body>[^}]*)\}/)
      ?.groups?.body || "";
  assert.doesNotMatch(appShellBlock, /height:\s*var\(--app-vh\);/);
  assert.match(appShellBlock, /height:\s*var\(--app-logged-frame-vh\);/);
  assert.doesNotMatch(appFrameBlock, /height:\s*var\(--app-logged-frame-vh\);/);
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.chat-col\s*\{[\s\S]*?--mobile-composer-bottom-offset:\s*5px;/
  );
  assert.doesNotMatch(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.input-wrap\s*\{[\s\S]*?--composer-bottom-edge-pad:\s*max\(var\(--composer-pad-y\),\s*var\(--app-physical-bottom-pad\)\)/
  );
  assert.doesNotMatch(css, /bottom:\s*calc\(-1 \* var\(--app-shell-bottom-spill/);
  assert.doesNotMatch(css, /bottom:\s*calc\(0px\s*-\s*var\(--app-layout-gap-bottom/);
});

test("mobile safe-area: default skin preserves the shared iOS composer inset", async () => {
  const skinCss = await readFile(path.resolve("public/skins/yagodka-modern.css"), "utf8");
  assert.match(
    skinCss,
    /html\.is-ios\[data-skin="yagodka-modern"\]\s+\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*var\(--composer-bottom-edge-pad,\s*max\(var\(--composer-pad-y\),\s*var\(--app-bottom-live-pad,\s*var\(--app-bottom-inset\)\)\)\)\s*;/
  );
  assert.doesNotMatch(skinCss, /html\.is-ios\[data-skin="yagodka-modern"\]\s+\.input-wrap\s*\{[\s\S]*env\(safe-area-inset-bottom\)/);
});

test("mobile safe-area: W-1050 contact list has bottom-nav clearance and tighter sticky search", async () => {
  const css = await readFile(path.resolve("src/scss/polish.css"), "utf8");

  assert.match(css, /W-1050:\s*mobile contact list clearance above the bottom nav/);
  assert.match(css, /--mobile-sidebar-sticky-h:\s*calc\(env\(safe-area-inset-top\)\s*\+\s*62px\);/);
  assert.match(css, /--mobile-bottom-nav-scroll-pad:\s*calc\(var\(--mobile-bottom-nav-h\)\s*\+\s*56px\);/);
  assert.match(
    css,
    /\.sidebar-mobile-sticky\s+\.sidebar-searchbar\s*\{[\s\S]*?width:\s*42px;[\s\S]*?min-height:\s*42px;/
  );
  assert.match(
    css,
    /\.sidebar-body\s*\{[\s\S]*?padding-bottom:\s*var\(--mobile-bottom-nav-scroll-pad\);[\s\S]*?scroll-padding-bottom:\s*calc\(var\(--mobile-bottom-nav-h\)\s*\+\s*40px\);/
  );
  assert.match(
    css,
    /\.sidebar-body\s*>\s*\.chatlist::after\s*\{[\s\S]*?height:\s*calc\(var\(--mobile-bottom-nav-h\)\s*\+\s*56px\);[\s\S]*?min-height:\s*132px;/
  );
});
