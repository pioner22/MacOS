import test from "node:test";
import assert from "node:assert/strict";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

test(".hidden forces display:none", async () => {
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(css, /\.hidden\s*\{[\s\S]*?display:\s*none\s*!important\s*;[\s\S]*?\}/);
});
