import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile pages: убираем дубли заголовка и page-hint (Esc/Enter подсказки)", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s+and\s+\(pointer:\s*coarse\)\s*\{/);
  assert.match(css, /\.page\s+\.chat-title\s*\{\s*display:\s*none\s*;/);
  assert.match(css, /\.page-hint\s*\{\s*display:\s*none\s*;/);
});

