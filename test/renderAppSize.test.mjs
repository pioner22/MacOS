import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const MAX_LINES = 1400;

test("renderApp.ts: size gate (keep extracting helpers)", async () => {
  const url = new URL("../src/app/renderApp.ts", import.meta.url);
  const txt = await readFile(url, "utf8");
  const lines = txt.trimEnd().split(/\r?\n/).length;
  assert.ok(lines <= MAX_LINES, `renderApp.ts too large: ${lines} lines (max ${MAX_LINES}). Extract helpers instead of growing this file.`);
});
