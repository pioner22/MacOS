import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("composer tokens: font-size>=16 (iOS zoom) и системный sans для ввода", async () => {
  const css = await readFile(new URL("../src/scss/theme.css", import.meta.url), "utf8");
  assert.ok(css.includes("--composer-input-font-size: max(var(--font-size), 16px);"));
  assert.ok(css.includes("--composer-input-font-family: var(--sans);"));
});

