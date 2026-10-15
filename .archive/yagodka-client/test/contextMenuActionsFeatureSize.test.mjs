import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const MAX_LINES = 1350;

test("contextMenuActionsFeature.ts: size gate (keep extracting menu actions)", async () => {
  const url = new URL("../src/app/features/contextMenu/contextMenuActionsFeature.ts", import.meta.url);
  const txt = await readFile(url, "utf8");
  const lines = txt.trimEnd().split(/\r?\n/).length;
  assert.ok(
    lines <= MAX_LINES,
    `contextMenuActionsFeature.ts too large: ${lines} lines (max ${MAX_LINES}). Extract menu action modules instead of growing this file.`
  );
});
