import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile: suppress iOS native callout on long-press message text (use our context menu)", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /@media\s*\(pointer:\s*coarse\)\s*\{/);
  assert.match(css, /\.msg-text[\s\S]*?-webkit-touch-callout:\s*none\s*;/);
  assert.match(css, /\.msg-text[\s\S]*?user-select:\s*none\s*;/);
});
