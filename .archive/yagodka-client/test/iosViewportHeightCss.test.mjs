import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("css viewport: #app использует 100dvh и не форсит -webkit-fill-available на современных iOS", async () => {
  const css = await readFile(path.resolve("src/scss/base.css"), "utf8");
  assert.match(css, /#app\s*\{[\s\S]*?height:\s*100dvh;/);
  const baseAppBlock = css.match(/#app\s*\{([\s\S]*?)\n\}/);
  assert.ok(baseAppBlock, "base #app block not found");
  assert.doesNotMatch(baseAppBlock[1], /min-height:\s*-webkit-fill-available;/);
  assert.match(css, /@supports\s*\(-webkit-touch-callout:\s*none\)\s*and\s*\(not\s*\(height:\s*100dvh\)\)\s*\{/);
  assert.doesNotMatch(css, /@supports\s*\(-webkit-touch-callout:\s*none\)\s*\{[\s\S]*?height:\s*-webkit-fill-available;/);
});
