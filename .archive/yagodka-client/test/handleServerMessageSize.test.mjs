import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const MAX_LINES = 1500;

test("handleServerMessage.ts: size gate (keep extracting domains)", async () => {
  const url = new URL("../src/app/handleServerMessage.ts", import.meta.url);
  const txt = await readFile(url, "utf8");
  const lines = txt.trimEnd().split(/\r?\n/).length;
  assert.ok(
    lines <= MAX_LINES,
    `handleServerMessage.ts too large: ${lines} lines (max ${MAX_LINES}). Extract routing domains instead of growing this file.`
  );
});
