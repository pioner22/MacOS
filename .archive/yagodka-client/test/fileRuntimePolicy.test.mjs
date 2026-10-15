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
      entryPoints: [path.resolve("src/app/features/files/fileRuntimePolicy.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    const required = [
      "canDrainFileRuntime",
      "canQueueFilePrefetch",
      "canDrainFilePrefetch",
      "resolveFileGetEnqueuePolicy",
      "isFileRuntimeDocumentVisible",
    ];
    for (const key of required) {
      if (typeof mod[key] !== "function") throw new Error(`missing export: ${key}`);
    }
    return {
      canDrainFileRuntime: mod.canDrainFileRuntime,
      canQueueFilePrefetch: mod.canQueueFilePrefetch,
      canDrainFilePrefetch: mod.canDrainFilePrefetch,
      resolveFileGetEnqueuePolicy: mod.resolveFileGetEnqueuePolicy,
      isFileRuntimeDocumentVisible: mod.isFileRuntimeDocumentVisible,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("fileRuntimePolicy: prefetch visibility/leader decisions are centralized", async () => {
  const { canDrainFileRuntime, canQueueFilePrefetch, canDrainFilePrefetch, resolveFileGetEnqueuePolicy, cleanup } =
    await loadHelper();
  try {
    assert.equal(canDrainFileRuntime({ authed: true, conn: "connected" }), true);
    assert.equal(canDrainFileRuntime({ authed: false, conn: "connected" }), false);
    assert.equal(canQueueFilePrefetch({ prefetchAllowed: true, doc: { visibilityState: "visible" } }), true);
    assert.equal(canQueueFilePrefetch({ prefetchAllowed: true, doc: { visibilityState: "hidden" } }), false);
    assert.equal(
      canDrainFilePrefetch(
        { authed: true, conn: "connected", netLeader: true },
        { prefetchAllowed: true, requireLeader: true, doc: { visibilityState: "visible" } }
      ),
      true
    );
    assert.equal(
      canDrainFilePrefetch(
        { authed: true, conn: "connected", netLeader: false },
        { prefetchAllowed: true, requireLeader: true, doc: { visibilityState: "visible" } }
      ),
      false
    );

    assert.deepEqual(
      resolveFileGetEnqueuePolicy({
        priority: "prefetch",
        silent: true,
        prefetchAllowed: true,
        state: { netLeader: false },
        doc: { visibilityState: "visible" },
      }),
      { allow: false, reason: "not_leader" }
    );
    assert.deepEqual(
      resolveFileGetEnqueuePolicy({
        priority: "prefetch",
        silent: false,
        prefetchAllowed: false,
        state: { netLeader: true },
        doc: { visibilityState: "visible" },
      }),
      { allow: false, reason: "prefetch_blocked" }
    );
    assert.deepEqual(
      resolveFileGetEnqueuePolicy({
        priority: "high",
        silent: true,
        prefetchAllowed: false,
        state: { netLeader: false },
        doc: { visibilityState: "hidden" },
      }),
      { allow: true, reason: null }
    );
  } finally {
    await cleanup();
  }
});
