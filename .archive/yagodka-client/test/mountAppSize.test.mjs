import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const MAX_LINES = 1900;

test("mountApp.ts: size gate (keep extracting features)", async () => {
  const url = new URL("../src/app/mountApp.ts", import.meta.url);
  const txt = await readFile(url, "utf8");
  const lines = txt.trimEnd().split(/\r?\n/).length;
  assert.ok(lines <= MAX_LINES, `mountApp.ts too large: ${lines} lines (max ${MAX_LINES}). Extract features instead of growing this file.`);
});
