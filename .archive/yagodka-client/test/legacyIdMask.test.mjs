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

test("formatLegacyIdForInput: группирует цифры 3-3-3 (и 3-2 для коротких)", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/id/legacyIdMask.ts");
  try {
    const { formatLegacyIdForInput } = mod;
    assert.equal(formatLegacyIdForInput(""), "");
    assert.equal(formatLegacyIdForInput("1"), "1");
    assert.equal(formatLegacyIdForInput("123"), "123");
    assert.equal(formatLegacyIdForInput("1234"), "123-4");
    assert.equal(formatLegacyIdForInput("12345"), "123-45");
    assert.equal(formatLegacyIdForInput("123456"), "123-456");
    assert.equal(formatLegacyIdForInput("123456789"), "123-456-789");
    assert.equal(formatLegacyIdForInput(" 123 456 789 "), "123-456-789");
    assert.equal(formatLegacyIdForInput("u-deadbeef"), "u-deadbeef");
  } finally {
    await cleanup();
  }
});

test("applyLegacyIdMask: сохраняет позицию курсора по количеству введённых цифр", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/id/legacyIdMask.ts");
  try {
    const { applyLegacyIdMask } = mod;
    const input = {
      value: "1234",
      selectionStart: 4,
      selectionEnd: 4,
      setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
    };
    applyLegacyIdMask(input);
    assert.equal(input.value, "123-4");
    assert.equal(input.selectionStart, 5);
    assert.equal(input.selectionEnd, 5);
  } finally {
    await cleanup();
  }
});

