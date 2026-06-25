import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("history visual boundaries: history render surface uses explicit group geometry helper", async () => {
  const src = await readFile(path.resolve("src/components/chat/historyRenderSurface.ts"), "utf8");
  assert.match(src, /applyHistoryGroupGeometry/);
  const helper = await readFile(path.resolve("src/components/chat/historyGroupGeometry.ts"), "utf8");
  assert.match(helper, /data-msg-group-role/);
});

test("history visual boundaries: CSS tightens stacked grouped messages", async () => {
  const css = await readFile(path.resolve("src/scss/components.part02.css"), "utf8");
  assert.match(css, /--msg-group-stack-gap:\s*3px/);
  assert.match(css, /\.msg\.msg-group-middle,\s*[\r\n]+\s*\.msg\.msg-group-end\s*\{/);
  assert.match(css, /margin-top:\s*calc\(var\(--msg-group-stack-gap,\s*3px\)\s*-\s*var\(--chat-line-gap\)\)/);
});
