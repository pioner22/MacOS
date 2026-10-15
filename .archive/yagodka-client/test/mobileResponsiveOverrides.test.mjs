import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("responsive: mobile overrides остаются 'skin-proof' (data-skin и более специфичные селекторы)", async () => {
  const css = await readFile(new URL("../src/scss/responsive.css", import.meta.url), "utf8");
  assert.ok(css.includes("@media (max-width: 600px) {"), "missing base mobile media query");
  assert.ok(css.includes("html #app {"), "expected html #app selector (beats skin #app)");
  assert.ok(css.includes("html #app > .app {"), "expected html #app > .app selector");
  assert.ok(css.includes(":root[data-skin] {"), "expected :root[data-skin] token overrides (beats skin :root)");
  assert.ok(css.includes("@media (max-width: 600px) and (pointer: coarse) {"), "missing coarse pointer media query");
});

