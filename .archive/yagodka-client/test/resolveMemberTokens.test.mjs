import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadResolveMemberTokens() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/members/resolveMemberTokens.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.resolveMemberTokensForSubmit !== "function") {
      throw new Error("resolveMemberTokens exports missing");
    }
    return {
      resolveMemberTokensForSubmit: mod.resolveMemberTokensForSubmit,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("resolveMemberTokensForSubmit: pending/invalid/missing_handles и успешное разрешение", async () => {
  const { resolveMemberTokensForSubmit, cleanup } = await loadResolveMemberTokens();
  try {
    const status = new Map();
    const handleToId = new Map();

    assert.deepEqual(resolveMemberTokensForSubmit({ tokens: [], statusByToken: status, handleToId }), { ok: true, members: [] });

    assert.deepEqual(resolveMemberTokensForSubmit({ tokens: ["854-432-319"], statusByToken: status, handleToId }), {
      ok: false,
      reason: "pending",
      pending: ["854-432-319"],
    });

    assert.deepEqual(resolveMemberTokensForSubmit({ tokens: ["12-3"], statusByToken: status, handleToId }), {
      ok: false,
      reason: "invalid",
      invalid: ["12-3"],
    });

    status.set("854-432-319", "ok");
    assert.deepEqual(resolveMemberTokensForSubmit({ tokens: ["854-432-319", "854-432-319"], statusByToken: status, handleToId }), {
      ok: true,
      members: ["854-432-319"],
    });

    status.set("@test_9", "warn");
    assert.deepEqual(resolveMemberTokensForSubmit({ tokens: ["@test_9"], statusByToken: status, handleToId }), {
      ok: false,
      reason: "missing_handles",
      missing: ["@test_9"],
    });

    handleToId.set("@test_9", "111-222-333");
    assert.deepEqual(resolveMemberTokensForSubmit({ tokens: ["@test_9", "854-432-319"], statusByToken: status, handleToId }), {
      ok: true,
      members: ["111-222-333", "854-432-319"],
    });
  } finally {
    await cleanup();
  }
});

