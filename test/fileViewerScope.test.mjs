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
      entryPoints: [path.resolve("src/helpers/chat/fileViewerScope.ts")],
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

function mediaMsg(id, ts, opts = {}) {
  return {
    id,
    ts,
    kind: opts.kind || "in",
    from: opts.from || "u1",
    room: opts.room || "",
    text: opts.text ?? "[file]",
    attachment: {
      kind: "file",
      fileId: opts.fileId || `f-${id}`,
      name: opts.name || `photo-${id}.jpg`,
      mime: opts.mime || "image/jpeg",
    },
  };
}

test("fileViewerScope: unrelated neighboring media collapse to single scope", async () => {
  const { mod, cleanup } = await loadHelper();
  try {
    const msgs = [
      mediaMsg(1, 100, { text: "caption before" }),
      mediaMsg(2, 1000),
      mediaMsg(3, 2000, { text: "caption after" }),
    ];
    const scope = mod.resolveViewerSourceScope(msgs, 1);
    assert.deepEqual(scope, {
      kind: "single",
      indices: [1],
      prevIdx: null,
      nextIdx: null,
    });
  } finally {
    await cleanup();
  }
});

test("fileViewerScope: grouped album keeps rail/navigation inside the album only", async () => {
  const { mod, cleanup } = await loadHelper();
  try {
    const msgs = [
      mediaMsg(1, 100),
      mediaMsg(2, 130),
      mediaMsg(3, 160),
      mediaMsg(4, 600, { text: "separate media" }),
    ];
    const scope = mod.resolveViewerSourceScope(msgs, 1);
    assert.deepEqual(scope, {
      kind: "album",
      indices: [0, 1, 2],
      prevIdx: 0,
      nextIdx: 2,
    });
  } finally {
    await cleanup();
  }
});

test("fileViewerScope: sameFileViewerContext matches the active viewer and ignores unrelated contexts", async () => {
  const { mod, cleanup } = await loadHelper();
  try {
    assert.equal(
      mod.sameFileViewerContext(
        { kind: "file_viewer", fileId: "file-1", chatKey: "dm:u1", msgIdx: 7 },
        { fileId: "file-1", chatKey: "dm:u2", msgIdx: 9 }
      ),
      true
    );
    assert.equal(
      mod.sameFileViewerContext(
        { kind: "file_viewer", fileId: null, chatKey: "dm:u1", msgIdx: 7 },
        { fileId: null, chatKey: "dm:u1", msgIdx: 7 }
      ),
      true
    );
    assert.equal(
      mod.sameFileViewerContext(
        { kind: "file_viewer", fileId: "file-1", chatKey: "dm:u1", msgIdx: 7 },
        { fileId: "file-2", chatKey: "dm:u1", msgIdx: 8 }
      ),
      false
    );
  } finally {
    await cleanup();
  }
});

test("fileViewerScope: shouldApplyPendingFileViewerResult upgrades same viewer and does not hijack another modal", async () => {
  const { mod, cleanup } = await loadHelper();
  try {
    assert.equal(
      mod.shouldApplyPendingFileViewerResult(null, {
        fileId: "file-1",
        chatKey: "dm:u1",
        msgIdx: 7,
      }),
      true
    );
    assert.equal(
      mod.shouldApplyPendingFileViewerResult(
        { kind: "file_viewer", fileId: "file-1", chatKey: "dm:u1", msgIdx: 7 },
        { fileId: "file-1", chatKey: "dm:u1", msgIdx: 7 }
      ),
      true
    );
    assert.equal(
      mod.shouldApplyPendingFileViewerResult(
        { kind: "file_viewer", fileId: "file-2", chatKey: "dm:u2", msgIdx: 9 },
        { fileId: "file-1", chatKey: "dm:u1", msgIdx: 7 }
      ),
      false
    );
    assert.equal(
      mod.shouldApplyPendingFileViewerResult(
        { kind: "context_menu", chatKey: "dm:u1", msgIdx: 7 },
        { fileId: "file-1", chatKey: "dm:u1", msgIdx: 7 }
      ),
      false
    );
  } finally {
    await cleanup();
  }
});
