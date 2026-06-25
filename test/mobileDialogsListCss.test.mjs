import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

test("mobile dialogs list: сепараторы, column-tail и online-dot", async () => {
  const responsive = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(responsive, /@media\s*\(max-width:\s*600px\)\s*and\s*\(pointer:\s*coarse\)\s*\{/);
  assert.match(responsive, /\.sidebar\s+\.row\s*\{[\s\S]*?border-bottom:/);
  assert.match(responsive, /\.sidebar\s+\.row-tail\s*\{[\s\S]*?flex-direction:\s*column/);

  const components = await readCssWithImports("src/scss/components.css");
  assert.match(components, /\.row\[data-online="1"\]\s+\.avatar::after\s*\{/);
});
