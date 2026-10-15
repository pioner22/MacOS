import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadMemberTokens() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/members/memberTokens.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.normalizeMemberToken !== "function" || typeof mod.statusForSearchResult !== "function") {
      throw new Error("memberTokens exports missing");
    }
    return {
      normalizeMemberToken: mod.normalizeMemberToken,
      statusForSearchResult: mod.statusForSearchResult,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("normalizeMemberToken: форматирует цифровой ID и отбрасывает короткие", async () => {
  const { normalizeMemberToken, cleanup } = await loadMemberTokens();
  try {
    assert.deepEqual(normalizeMemberToken(" 854432319 "), { kind: "id", value: "854-432-319", query: "854-432-319" });
    assert.equal(normalizeMemberToken("12-3")?.kind, "invalid");
  } finally {
    await cleanup();
  }
});

test("normalizeMemberToken: нормализует @handle (и без @)", async () => {
  const { normalizeMemberToken, cleanup } = await loadMemberTokens();
  try {
    assert.deepEqual(normalizeMemberToken("@TeSt_9"), { kind: "handle", value: "@test_9", query: "@test_9" });
    assert.deepEqual(normalizeMemberToken("test_9"), { kind: "handle", value: "@test_9", query: "@test_9" });
    assert.equal(normalizeMemberToken("@x")?.kind, "invalid");
  } finally {
    await cleanup();
  }
});

test("statusForSearchResult: определяет ok/warn/bad по результатам поиска", async () => {
  const { normalizeMemberToken, statusForSearchResult, cleanup } = await loadMemberTokens();
  try {
    const idTok = normalizeMemberToken("854-432-319");
    assert.equal(idTok.kind, "id");

    assert.deepEqual(statusForSearchResult(idTok, [{ id: "854-432-319", friend: true }], "group"), { status: "ok" });
    assert.deepEqual(statusForSearchResult(idTok, [{ id: "854-432-319", friend: false }], "group"), { status: "warn" });
    assert.deepEqual(statusForSearchResult(idTok, [], "board"), { status: "bad" });

    const hTok = normalizeMemberToken("@test_9");
    assert.equal(hTok.kind, "handle");
    assert.deepEqual(statusForSearchResult(hTok, [{ id: "111-222-333", friend: true }], "board"), { status: "ok", resolvedId: "111-222-333" });
    assert.deepEqual(statusForSearchResult(hTok, [{ id: "111-222-333", friend: false }], "group"), { status: "warn", resolvedId: "111-222-333" });
    assert.deepEqual(statusForSearchResult(hTok, [{ id: "b-123", board: true }], "board"), { status: "bad" });
  } finally {
    await cleanup();
  }
});
