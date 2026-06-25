import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.resolve("src/pages/help/createHelpPage.ts");

test("help page: changelog не автодогружается через IntersectionObserver (не должен крашить PWA/Chrome)", async () => {
  const txt = await readFile(FILE, "utf8");
  assert.equal(/\bIntersectionObserver\b/.test(txt), false);
});

