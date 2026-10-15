import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("mobile: scroll containers используют -webkit-overflow-scrolling: touch (iOS inertia)", async () => {
  const css = await readFile(new URL("../src/scss/layout.css", import.meta.url), "utf8");
  const hits = css.split("-webkit-overflow-scrolling: touch;").length - 1;
  assert.ok(hits >= 2, "expected at least two -webkit-overflow-scrolling: touch; declarations");
});

