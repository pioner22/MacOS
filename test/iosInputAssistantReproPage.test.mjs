import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("repro: iOS input assistant page присутствует и содержит viewport-fit=cover", async () => {
  const html = await readFile(path.resolve("public/repro/ios-input-assistant.html"), "utf8");
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<textarea[^>]*id=\"ta\"/);
  assert.match(html, /contenteditable=\"true\"/);
});

