import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadBootstrap() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/files/fileTransferBootstrap.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.isBlockingFileDownloadState !== "function") throw new Error("isBlockingFileDownloadState export missing");
    return { isBlockingFileDownloadState: mod.isBlockingFileDownloadState, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("fileTransferBootstrap: complete transfer without url does not block media re-hydration", async () => {
  const helper = await loadBootstrap();
  try {
    const activeDownloads = new Map([["file-live", { fileId: "file-live" }]]);
    assert.equal(helper.isBlockingFileDownloadState("file-live", activeDownloads, null), true);
    assert.equal(helper.isBlockingFileDownloadState("file-1", new Map(), { status: "downloading", url: null }), true);
    assert.equal(helper.isBlockingFileDownloadState("file-2", new Map(), { status: "complete", url: "blob:ok" }), true);
    assert.equal(helper.isBlockingFileDownloadState("file-3", new Map(), { status: "complete", url: null }), false);
    assert.equal(helper.isBlockingFileDownloadState("file-4", new Map(), { status: "uploaded", url: null }), false);
  } finally {
    await helper.cleanup();
  }
});
