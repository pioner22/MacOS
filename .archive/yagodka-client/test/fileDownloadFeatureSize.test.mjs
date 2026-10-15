import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

test("fileDownloadFeature.ts: size gate (keep HTTP runtime extracted)", async () => {
  const src = await readFile(path.resolve("src/app/features/files/fileDownloadFeature.ts"), "utf8");
  const lines = src.split("\n").length;
  assert.ok(lines <= 900, `fileDownloadFeature.ts should stay <= 900 lines, got ${lines}`);
});
