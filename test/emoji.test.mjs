import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadModule(entry) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entry)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("insertTextAtSelection: вставляет эмодзи в курсор и возвращает каретку", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/ui/emoji.ts");
  try {
    const { insertTextAtSelection } = mod;

    const insert = "🙂";
    const r1 = insertTextAtSelection({ value: "hi", selectionStart: 2, selectionEnd: 2, insertText: insert });
    assert.equal(r1.value, `hi${insert}`);
    assert.equal(r1.caret, "hi".length + insert.length);

    const r2 = insertTextAtSelection({ value: "hello", selectionStart: 1, selectionEnd: 4, insertText: insert });
    assert.equal(r2.value, `h${insert}o`);
    assert.equal(r2.caret, 1 + insert.length);
  } finally {
    await cleanup();
  }
});

test("updateEmojiRecents: дедуплицирует, поднимает в начало, обрезает по лимиту", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/ui/emoji.ts");
  try {
    const { updateEmojiRecents } = mod;
    assert.deepEqual(updateEmojiRecents([], "🙂", 3), ["🙂"]);
    assert.deepEqual(updateEmojiRecents(["🙂"], "🙂", 3), ["🙂"]);
    assert.deepEqual(updateEmojiRecents(["🙂", "😀"], "😀", 3), ["😀", "🙂"]);
    assert.deepEqual(updateEmojiRecents(["1", "2", "3"], "4", 3), ["4", "1", "2"]);
  } finally {
    await cleanup();
  }
});

test("mergeEmojiPalette: объединяет recents + base без дублей", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/ui/emoji.ts");
  try {
    const { mergeEmojiPalette } = mod;
    assert.deepEqual(mergeEmojiPalette(["🙂", "😀"], ["😀", "🔥"]), ["🙂", "😀", "🔥"]);
  } finally {
    await cleanup();
  }
});

