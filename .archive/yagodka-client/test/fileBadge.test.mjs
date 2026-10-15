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

test("fileBadge: определяет kind/label по mime/ext", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/files/fileBadge.ts");
  try {
    assert.equal(typeof mod.fileBadge, "function");

    const byMime = mod.fileBadge("whatever.bin", "image/png");
    assert.equal(byMime.kind, "image");
    assert.equal(byMime.label, "IMG");

    const pdf = mod.fileBadge("report.pdf");
    assert.equal(pdf.kind, "pdf");
    assert.equal(pdf.label, "PDF");

    const doc = mod.fileBadge("note.docx");
    assert.equal(doc.kind, "doc");
    assert.equal(doc.label, "DOCX");

    const longExt = mod.fileBadge("data.superlongext");
    assert.equal(longExt.kind, "other");
    assert.equal(longExt.label, "SUPE");
  } finally {
    await cleanup();
  }
});

test("fileBadge: hue детерминирован и в диапазоне 0..359", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/files/fileBadge.ts");
  try {
    const a = mod.fileBadge("a.png", "image/png");
    const b = mod.fileBadge("a.png", "image/png");
    assert.equal(a.hue, b.hue);
    assert.ok(Number.isInteger(a.hue));
    assert.ok(a.hue >= 0 && a.hue < 360);
  } finally {
    await cleanup();
  }
});

