import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const MAX_LINES = 850;

test("renderChat.ts: size gate (keep extracting chat surfaces)", async () => {
  const url = new URL("../src/components/chat/renderChat.ts", import.meta.url);
  const txt = await readFile(url, "utf8");
  const lines = txt.trimEnd().split(/\r?\n/).length;
  assert.ok(lines <= MAX_LINES, `renderChat.ts too large: ${lines} lines (max ${MAX_LINES}). Extract chat surfaces instead of growing this file.`);
});
