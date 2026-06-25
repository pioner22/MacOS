import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadAutofocusPolicy() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/ui/autofocusPolicy.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.shouldAutofocusComposer !== "function") {
      throw new Error("shouldAutofocusComposer export missing");
    }
    return {
      shouldAutofocusComposer: mod.shouldAutofocusComposer,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("autofocusPolicy: shouldAutofocusComposer учитывает pointer coarse, hover/any-pointer и предыдущий фокус", async () => {
  const { shouldAutofocusComposer, cleanup } = await loadAutofocusPolicy();
  try {
    assert.equal(shouldAutofocusComposer({ coarsePointer: false, composerHadFocus: false }), true);
    assert.equal(shouldAutofocusComposer({ coarsePointer: false, composerHadFocus: true }), true);
    assert.equal(shouldAutofocusComposer({ coarsePointer: true, composerHadFocus: false }), true);
    assert.equal(shouldAutofocusComposer({ coarsePointer: true, composerHadFocus: true }), true);
    assert.equal(shouldAutofocusComposer({ coarsePointer: true, composerHadFocus: false, anyFinePointer: true }), true);
    assert.equal(shouldAutofocusComposer({ coarsePointer: true, composerHadFocus: false, hover: true }), true);
  } finally {
    await cleanup();
  }
});
