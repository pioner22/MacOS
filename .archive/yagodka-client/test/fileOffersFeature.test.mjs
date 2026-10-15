import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/files/fileOffersFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.shouldAutoAcceptFileOffer !== "function") throw new Error("shouldAutoAcceptFileOffer export missing");
    return {
      shouldAutoAcceptFileOffer: mod.shouldAutoAcceptFileOffer,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("fileOffersFeature: photo and video offers stay click-to-load", async () => {
  const helper = await loadFeature();
  try {
    assert.equal(helper.shouldAutoAcceptFileOffer("photo.jpg", "image/jpeg"), false);
    assert.equal(helper.shouldAutoAcceptFileOffer("clip.mp4", "video/mp4"), false);
    assert.equal(helper.shouldAutoAcceptFileOffer("IMG_3383.MP4", null), false);
    assert.equal(helper.shouldAutoAcceptFileOffer("document.pdf", "application/pdf"), true);
    assert.equal(helper.shouldAutoAcceptFileOffer("voice.ogg", "audio/ogg"), true);
  } finally {
    await helper.cleanup();
  }
});
