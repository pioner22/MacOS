import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/files/previewAutoFetchFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    for (const key of ["resolveVisiblePreviewFetchPlan", "isTerminalPreviewTransferError"]) {
      if (typeof mod[key] !== "function") throw new Error(`${key} export missing`);
    }
    return {
      resolveVisiblePreviewFetchPlan: mod.resolveVisiblePreviewFetchPlan,
      hasTrustedRuntimeUrl: mod.hasTrustedRuntimeUrl,
      isTerminalPreviewTransferError: mod.isTerminalPreviewTransferError,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("previewAutoFetchFeature: visible visual previews request silent thumb hydration", async () => {
  const helper = await loadFeature();
  try {
    assert.deepEqual(
      helper.resolveVisiblePreviewFetchPlan({
        fileKind: "image",
        devicePrefetchAllowed: false,
        shouldBackgroundPrefetch: false,
      }),
      { prefetch: false, priority: "high" }
    );
    assert.deepEqual(
      helper.resolveVisiblePreviewFetchPlan({
        fileKind: "video",
        devicePrefetchAllowed: true,
        shouldBackgroundPrefetch: true,
      }),
      { prefetch: false, priority: "high" }
    );
    assert.deepEqual(
      helper.resolveVisiblePreviewFetchPlan({
        fileKind: "audio",
        devicePrefetchAllowed: true,
        shouldBackgroundPrefetch: true,
      }),
      { prefetch: false, priority: "high" }
    );
    assert.equal(helper.hasTrustedRuntimeUrl("https://yagodka.org/files/fid", false), true);
    assert.equal(helper.hasTrustedRuntimeUrl("blob:test", false), true);
    assert.equal(helper.hasTrustedRuntimeUrl("https://yagodka.org/files/fid", true), false);
    assert.equal(helper.hasTrustedRuntimeUrl("blob:test", true), true);
    assert.equal(helper.isTerminalPreviewTransferError({ status: "error" }), true);
    assert.equal(helper.isTerminalPreviewTransferError({ status: "downloading" }), false);
    assert.equal(helper.isTerminalPreviewTransferError(null), false);
  } finally {
    await helper.cleanup();
  }
});

test("previewAutoFetchFeature: history audio nodes stay in visible hydration scan", async () => {
  const src = await readFile(path.resolve("src/app/features/files/previewAutoFetchFeature.ts"), "utf8");
  assert.match(src, /querySelectorAll\("\[data-file-kind='audio'\]\[data-file-id\]"\)/);
  assert.match(src, /for\s*\(const node of Array\.from\(audioNodes\)\)\s*\{[\s\S]*?fileKind:\s*"audio"/);
  assert.match(src, /for\s*\(const node of Array\.from\(audioNodes\)\)\s*\{[\s\S]*?kind:\s*"audio"/);
  assert.match(src, /for\s*\(const node of Array\.from\(audioNodes\)\)\s*\{[\s\S]*?node\.getAttribute\("data-msg-idx"\)/);
});

test("previewAutoFetchFeature: loaded media clears stale placeholder strip", async () => {
  const src = await readFile(path.resolve("src/app/features/files/previewAutoFetchFeature.ts"), "utf8");
  assert.match(src, /function\s+clearPreviewPlaceholder/);
  assert.match(src, /node\.querySelector\("img\.chat-file-img,\s*video\.chat-file-video"\)/);
  assert.match(src, /if\s*\(!mediaFailed\s*&&\s*\(img instanceof HTMLImageElement \|\| video instanceof HTMLVideoElement\)\)\s*\{[\s\S]*?clearPreviewPlaceholder\(node\)/);
});
