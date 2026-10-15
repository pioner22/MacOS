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
      entryPoints: [path.resolve("src/helpers/auth/preserveAuthModalInputs.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.preserveAuthModalInputs !== "function") throw new Error("preserveAuthModalInputs export missing");
    return { preserveAuthModalInputs: mod.preserveAuthModalInputs, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function field(value) {
  return { value: String(value) };
}

test("preserveAuthModalInputs: не перетирает предзаполненный ID при первом открытии", async () => {
  const helper = await loadHelper();
  try {
    const idEl = field("854-432-319");
    const pwEl = field("");
    helper.preserveAuthModalInputs({
      hadAuthModal: false,
      prev: { id: "", pw: "x", pw1: "y", pw2: "z" },
      next: { idEl, pwEl, pw1El: null, pw2El: null },
    });
    assert.equal(idEl.value, "854-432-319");
    assert.equal(pwEl.value, "");
  } finally {
    await helper.cleanup();
  }
});

test("preserveAuthModalInputs: сохраняет введённые значения при ре-рендере", async () => {
  const helper = await loadHelper();
  try {
    const idEl = field("854-432-319");
    const pwEl = field("");
    helper.preserveAuthModalInputs({
      hadAuthModal: true,
      prev: { id: "111-222-333", pw: "secret", pw1: "", pw2: "" },
      next: { idEl, pwEl, pw1El: null, pw2El: null },
    });
    assert.equal(idEl.value, "111-222-333");
    assert.equal(pwEl.value, "secret");
  } finally {
    await helper.cleanup();
  }
});

