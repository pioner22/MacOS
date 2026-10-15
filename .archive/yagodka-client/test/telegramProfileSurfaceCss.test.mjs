import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("telegram-exact profile surfaces use Telegram white in light and dark panels in dark", async () => {
  const css = await readFile(new URL("../public/skins/telegram-exact.css", import.meta.url), "utf8");

  assert.match(css, /--header-bg:\s*#ffffff\s*;/);
  assert.match(css, /--tg-profile-card-bg:\s*#ffffff\s*;/);
  assert.match(css, /--tg-profile-header-bg:\s*#ffffff\s*;/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[\s\S]*?--header-bg:\s*#17212b\s*;/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[\s\S]*?--tg-profile-card-bg:\s*#17212b\s*;/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[\s\S]*?--tg-profile-header-bg:\s*#17212b\s*;/);
});

test("telegram-exact profile selectors override shared polish layer", async () => {
  const css = await readFile(new URL("../public/skins/telegram-exact.css", import.meta.url), "utf8");

  assert.match(
    css,
    /html\[data-skin="telegram-exact"\]\.has-profile-surface:not\(\.has-auth-pages\)\s+\.hdr\s*\{[\s\S]*?background:\s*var\(--tg-profile-header-bg\);[\s\S]*?border-bottom-color:\s*var\(--tg-profile-header-border\);/
  );
  assert.match(
    css,
    /html\[data-skin="telegram-exact"\]\s+\.page\.page-profile,[\s\S]*?html\[data-skin="telegram-exact"\]\s+\.page\.page-user,[\s\S]*?html\[data-skin="telegram-exact"\]\s+\.page\.page-room\s*\{[\s\S]*?background:\s*var\(--tg-profile-page-bg\);[\s\S]*?box-shadow:\s*none;/
  );
  assert.match(
    css,
    /html\[data-skin="telegram-exact"\]\.has-profile-surface:not\(\.has-auth-pages\)\s+\.chat\.chat-page\s+\.page\.page-profile,[\s\S]*?html\[data-skin="telegram-exact"\]\.has-profile-surface:not\(\.has-auth-pages\)\s+\.chat\.chat-page\s+\.page\.page-sessions\s*\{[\s\S]*?background:\s*var\(--tg-profile-page-bg\);/
  );
  assert.match(
    css,
    /html\[data-skin="telegram-exact"\]\s+\.profile-card,[\s\S]*?html\[data-skin="telegram-exact"\]\s+\.page-card\s*\{[\s\S]*?background:\s*var\(--tg-profile-card-bg\);[\s\S]*?box-shadow:\s*none;/
  );
  assert.match(
    css,
    /html\[data-skin="telegram-exact"\]\s+\.profile-id-card\s*\{[\s\S]*?background:\s*var\(--tg-profile-id-bg\);[\s\S]*?border-color:\s*var\(--tg-profile-id-border\);/
  );
});
