import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.resolve("src/app/mountApp.ts");

test("file offers: не ставим header/status в «Входящий файл…» (чтобы не залипало)", async () => {
  const txt = await readFile(FILE, "utf8");
  assert.equal(/status\\s*:\\s*[`'\\\"]Входящий файл/.test(txt), false);
});

