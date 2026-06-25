import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/navigation/chatHostDeferredEvents.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.resolveStablePreviewAspectRatio !== "function") {
      throw new Error("resolveStablePreviewAspectRatio export missing");
    }
    if (typeof mod.didPreviewGeometryChange !== "function") {
      throw new Error("didPreviewGeometryChange export missing");
    }
    return {
      resolveStablePreviewAspectRatio: mod.resolveStablePreviewAspectRatio,
      didPreviewGeometryChange: mod.didPreviewGeometryChange,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("chatHostDeferredEvents: inline video keeps existing preview ratio on metadata load", async () => {
  const { resolveStablePreviewAspectRatio, cleanup } = await loadHelper();
  try {
    assert.equal(
      resolveStablePreviewAspectRatio({
        currentAspectRatio: "108 / 192",
        nextRatio: 1920 / 1080,
        fileKind: "video",
        sourceTagName: "video",
      }),
      108 / 192
    );

    assert.equal(
      resolveStablePreviewAspectRatio({
        currentAspectRatio: "0.5625",
        nextRatio: 16 / 9,
        fileKind: "video",
        sourceTagName: "video",
      }),
      0.5625
    );
  } finally {
    await cleanup();
  }
});

test("chatHostDeferredEvents: stable inline video metadata does not request late geometry resize", async () => {
  const { didPreviewGeometryChange, cleanup } = await loadHelper();
  try {
    assert.equal(
      didPreviewGeometryChange({
        currentAspectRatio: "108 / 192",
        nextRatio: 1920 / 1080,
        fileKind: "video",
        sourceTagName: "video",
      }),
      false
    );

    assert.equal(
      didPreviewGeometryChange({
        currentAspectRatio: "0.5625",
        nextRatio: 16 / 9,
        fileKind: "video",
        sourceTagName: "video",
      }),
      false
    );
  } finally {
    await cleanup();
  }
});

test("chatHostDeferredEvents: visible media keeps existing ratio and empty previews adopt measured ratio", async () => {
  const { resolveStablePreviewAspectRatio, didPreviewGeometryChange, cleanup } = await loadHelper();
  try {
    assert.equal(
      resolveStablePreviewAspectRatio({
        currentAspectRatio: "0.5625",
        nextRatio: 4 / 3,
        fileKind: "image",
        sourceTagName: "img",
      }),
      0.5625
    );

    assert.equal(
      resolveStablePreviewAspectRatio({
        currentAspectRatio: "",
        nextRatio: 16 / 9,
        fileKind: "video",
        sourceTagName: "video",
      }),
      16 / 9
    );

    assert.equal(
      didPreviewGeometryChange({
        currentAspectRatio: "0.5625",
        nextRatio: 4 / 3,
        fileKind: "image",
        sourceTagName: "img",
      }),
      false
    );

    assert.equal(
      didPreviewGeometryChange({
        currentAspectRatio: "",
        nextRatio: 16 / 9,
        fileKind: "video",
        sourceTagName: "video",
      }),
      true
    );
  } finally {
    await cleanup();
  }
});
