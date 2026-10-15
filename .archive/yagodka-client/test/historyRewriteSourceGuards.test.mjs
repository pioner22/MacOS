import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("history rewrite source guards: renderChat delegates line-building to historyRenderSurface", async () => {
  const src = await readFile(path.resolve("src/components/chat/renderChat.ts"), "utf8");
  assert.match(src, /buildHistoryRenderSurface/);
  const helper = await readFile(path.resolve("src/components/chat/historyRenderSurface.ts"), "utf8");
  assert.match(helper, /buildHistoryLayoutBlocks/);
  assert.match(helper, /renderDeferredAlbumLine/);
});

test("history rewrite source guards: chatHostDeferredEvents delegates media hydration to dedicated runtime", async () => {
  const src = await readFile(path.resolve("src/app/features/navigation/chatHostDeferredEvents.ts"), "utf8");
  assert.match(src, /createHistoryMediaHydrationRuntime/);
  const helper = await readFile(path.resolve("src/app/features/history/historyMediaHydrationRuntime.ts"), "utf8");
  assert.match(helper, /resolveStablePreviewAspectRatio/);
  assert.match(helper, /syncExistingMediaState/);
});
