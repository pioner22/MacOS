import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper(entryPoint) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entryPoint)],
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
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("searchQueryFilters: extracts text, from and hashtags and preserves them for chat pivot", async () => {
  const { mod, cleanup } = await loadHelper("src/helpers/search/searchQueryFilters.ts");
  try {
    const filters = mod.extractSearchQueryFilters("hello from:@alice #news #urgent");
    assert.deepEqual(filters, {
      text: "hello",
      from: "@alice",
      hashtags: ["news", "urgent"],
    });
    assert.equal(mod.buildPivotSearchQuery(filters), "hello from:@alice #news #urgent");
  } finally {
    await cleanup();
  }
});

test("searchQueryFilters: supports Russian alias от: and lowercases hashtags", async () => {
  const { mod, cleanup } = await loadHelper("src/helpers/search/searchQueryFilters.ts");
  try {
    const filters = mod.extractSearchQueryFilters("тест от:Иван #Срочно");
    assert.deepEqual(filters, {
      text: "тест",
      from: "Иван",
      hashtags: ["срочно"],
    });
    assert.equal(mod.buildPivotSearchQuery(filters), "тест from:Иван #срочно");
  } finally {
    await cleanup();
  }
});
