import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";
import { build } from "esbuild";

async function loadModalSurface() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/navigation/modalSurface.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { resolveModalPresentation: mod.resolveModalPresentation, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("file viewer: использует overlay fullscreen (а не inline modal)", async () => {
  const { resolveModalPresentation, cleanup } = await loadModalSurface();
  try {
    const presentation = resolveModalPresentation({
      authed: true,
      modal: { kind: "file_viewer", chatKey: "dm:u1", msgIdx: 1, fileId: "file-1", openedAtMs: 1000 },
    });
    assert.equal(presentation.inlineModal, false);
    assert.equal(presentation.overlaySurface, "overlay-viewer");
  } finally {
    await cleanup();
  }
});

test("file viewer: renderApp использует helper surface-model", async () => {
  const src = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  assert.match(src, /resolveModalPresentation/);
  assert.match(src, /applyOverlaySurface/);
});

test("file viewer: renderModal не пересобирает heavy host без смены modal reference", async () => {
  const src = await readFile(path.resolve("src/components/modals/renderModal.ts"), "utf8");
  assert.match(src, /const viewerChanged = latestFileViewerModal !== modal/);
  assert.match(src, /if \(viewerChanged \|\| !host\.firstElementChild\) refreshDeferredHeavyModals\(\);/);
});

test("file viewer: есть CSS для overlay-viewer + fullscreen layout", async () => {
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(css, /\.overlay\.overlay-viewer\s*\{/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\s*\{/);
});
