import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/files/mediaKind.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    const required = ["normalizeFileName", "resolveMediaKind", "isImageLikeFile", "isVideoLikeFile", "isAudioLikeFile", "isMediaLikeFile"];
    for (const key of required) {
      if (typeof mod[key] !== "function") throw new Error(`mediaKind export missing: ${key}`);
    }
    return {
      normalizeFileName: mod.normalizeFileName,
      resolveMediaKind: mod.resolveMediaKind,
      isImageLikeFile: mod.isImageLikeFile,
      isVideoLikeFile: mod.isVideoLikeFile,
      isAudioLikeFile: mod.isAudioLikeFile,
      isMediaLikeFile: mod.isMediaLikeFile,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

test("mediaKind: classify respects mime, extension and iOS IMG_*.MP4 naming", async () => {
  const helper = await loadHelpers();
  try {
    assert.equal(helper.normalizeFileName(" https://x/y/IMG_3383.MP4?dl=1 "), "img_3383.mp4");
    assert.equal(helper.resolveMediaKind("IMG_3383.MP4", "video/mp4"), "video");
    assert.equal(helper.resolveMediaKind("IMG_3383.MP4", null), "video");
    assert.equal(helper.isImageLikeFile("IMG_3383.MP4", null), false);
    assert.equal(helper.isVideoLikeFile("IMG_3383.MP4", null), true);
    assert.equal(helper.resolveMediaKind("voice_note_1", null), "audio");
    assert.equal(helper.isAudioLikeFile("clip.ogg", "audio/ogg"), true);
    assert.equal(helper.isMediaLikeFile("archive.bin", null), false);
  } finally {
    await helper.cleanup();
  }
});
