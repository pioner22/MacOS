import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadBoardPost() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/boards/boardPost.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.parseBoardPost !== "function") throw new Error("parseBoardPost export missing");
    return { parseBoardPost: mod.parseBoardPost, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("boardPost: распознаёт changelog-блоки по заголовку", async () => {
  const { parseBoardPost, cleanup } = await loadBoardPost();
  try {
    const text = `## Добавлено\n- пункт 1\n• пункт 2\n\nОбычный текст`;
    const nodes = parseBoardPost(text);
    assert.equal(nodes[0]?.kind, "changelog");
    assert.equal(nodes[0]?.changelogKind, "added");
    assert.deepEqual(nodes[0]?.items, ["пункт 1", "пункт 2"]);
    assert.equal(nodes[1]?.kind, "paragraph");
    assert.deepEqual(nodes[1]?.lines, ["Обычный текст"]);
  } finally {
    await cleanup();
  }
});

test("boardPost: оставляет обычные заголовки как heading", async () => {
  const { parseBoardPost, cleanup } = await loadBoardPost();
  try {
    const nodes = parseBoardPost(`# Заголовок\n\nТекст`);
    assert.deepEqual(nodes, [
      { kind: "heading", level: 1, text: "Заголовок" },
      { kind: "paragraph", lines: ["Текст"] },
    ]);
  } finally {
    await cleanup();
  }
});

test("boardPost: поддерживает маркеры вида ##+ / ##^ / ##! / ##? с произвольным заголовком", async () => {
  const { parseBoardPost, cleanup } = await loadBoardPost();
  try {
    const text = `##+ Релиз 1.2\n- пункт\n\n##^ Оптимизация\n• быстрее`;
    const nodes = parseBoardPost(text);
    assert.equal(nodes[0]?.kind, "changelog");
    assert.equal(nodes[0]?.changelogKind, "added");
    assert.equal(nodes[0]?.title, "Релиз 1.2");

    assert.equal(nodes[1]?.kind, "changelog");
    assert.equal(nodes[1]?.changelogKind, "improved");
    assert.equal(nodes[1]?.title, "Оптимизация");
  } finally {
    await cleanup();
  }
});
