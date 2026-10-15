import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const MAX_LINES = 900;

test("renderSidebar.ts: size gate (keep extracting sidebar surfaces)", async () => {
  const url = new URL("../src/components/sidebar/renderSidebar.ts", import.meta.url);
  const txt = await readFile(url, "utf8");
  const lines = txt.trimEnd().split(/\r?\n/).length;
  assert.ok(
    lines <= MAX_LINES,
    `renderSidebar.ts too large: ${lines} lines (max ${MAX_LINES}). Extract sidebar helpers/surfaces instead of growing this file.`
  );
});
