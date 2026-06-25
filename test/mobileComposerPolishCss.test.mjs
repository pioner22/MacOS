import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile composer: Telegram-like бар (blur) и более плотный input", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s+and\s+\(pointer:\s*coarse\)\s*\{/);
  assert.match(css, /--composer-input-font-weight:\s*500\s*;/);
  assert.match(css, /\.input-wrap\s*\{[\s\S]*?--composer-bottom-edge-pad:\s*max\(/);
  assert.match(css, /\.input-wrap\s*\{[\s\S]*?backdrop-filter:\s*blur\(10px\)\s*;/);
  assert.match(css, /\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*var\(--composer-bottom-edge-pad\)\s*;/);
  assert.match(css, /\.composer-field\s*\.input\s*\{[\s\S]*?padding:\s*var\(--composer-input-pad-y\)\s+13px\s*;/);
});

test("mobile composer: iOS override keeps composer compact above the bottom edge", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /html\.is-ios\s+\.input-wrap\s*\{[\s\S]*?--composer-bottom-edge-pad:\s*max\(var\(--composer-pad-y\),\s*var\(--app-bottom-live-pad\)\)\s*;/);
  assert.doesNotMatch(css, /html\.is-ios\s+\.input-wrap\s*\{[\s\S]*?--composer-bottom-edge-pad:\s*max\(var\(--composer-pad-y\),\s*var\(--app-bottom-inset\)\)\s*;/);
  assert.match(css, /html\.is-ios\s+\.input-wrap\s*\{[\s\S]*?padding-top:\s*calc\(var\(--composer-pad-y\)\s*\*\s*0\.75\)\s*;/);
  assert.match(css, /html\.is-ios\s+\.input-wrap\s*\{[\s\S]*?background:\s*var\(--composer-bg\)\s*;/);
});

test("mobile composer: iOS fixed frame uses compact live pad in no-keyboard shell", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.input-wrap\s*\{[\s\S]*?--composer-bottom-edge-pad:\s*max\(var\(--composer-pad-y\),\s*var\(--app-bottom-live-pad\),\s*var\(--app-logged-bottom-fill\)\)\s*;/
  );
  assert.doesNotMatch(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.input-wrap\s*\{[\s\S]*?--composer-bottom-edge-pad:\s*max\(var\(--composer-pad-y\),\s*var\(--app-physical-bottom-pad\)\)\s*;/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.input-wrap\s*\{[\s\S]*?--mobile-composer-bottom-offset:\s*5px;[\s\S]*?bottom:\s*var\(--mobile-composer-bottom-offset\)\s*;/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.input-wrap::before\s*\{[\s\S]*?display:\s*none;[\s\S]*?height:\s*0\s*;/
  );
  assert.doesNotMatch(css, /bottom:\s*calc\(0px\s*-\s*var\(--app-layout-gap-bottom/);
});

test("mobile composer: Android native shell gets stable bars and touch tabs", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /html\.env-os-android\s+\.hdr\s*\{[\s\S]*?min-height:\s*56px\s*;/);
  assert.match(css, /html\.env-os-android\s+\.input-wrap\s*\{[\s\S]*?--composer-bottom-edge-pad:\s*max\(8px,\s*var\(--app-bottom-live-pad\)\)\s*;/);
  assert.match(css, /html\.env-os-android\s+\.input-wrap\s*\{[\s\S]*?backdrop-filter:\s*blur\(12px\)\s*;/);
  assert.match(css, /html\.env-os-android\s+\.composer-field\s*\{[\s\S]*?border-width:\s*1px\s*;/);
  assert.match(css, /html\.env-os-android\s+\.sidebar-tabs\.sidebar-tabs-mobile\s+\.sidebar-tab\s*\{[\s\S]*?min-height:\s*46px\s*;/);
});

test("mobile messenger reference polish: patterned chat, floating composer actions and input pill", async () => {
  const [css, skinCss] = await Promise.all([
    readFile(path.resolve("src/scss/responsive.css"), "utf8"),
    readFile(path.resolve("public/skins/yagodka-modern.css"), "utf8"),
  ]);
  assert.match(skinCss, /html\[data-skin="yagodka-modern"\]\s+\.chat\s*\{[\s\S]*radial-gradient\(circle at 18px 24px/);
  assert.doesNotMatch(skinCss, /html\[data-skin="yagodka-modern"\]\s+\.chat\s*\{[\s\S]*linear-gradient\(90deg,[\s\S]*42px 42px/);
  assert.match(css, /\.composer-field\s*\{[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
  assert.match(css, /\.composer-field\s+\.input\s*\{[\s\S]*background:\s*var\(--composer-field-bg\);[\s\S]*border-radius:\s*999px;/);
  assert.match(css, /\.composer-field\s+\.btn\.composer-action\s*\{[\s\S]*border-radius:\s*999px;[\s\S]*background:/);
  assert.match(css, /\.composer-field\s+\.btn\.composer-action:active\s*\{[\s\S]*?filter:\s*brightness\(1\.1\);/);
});
