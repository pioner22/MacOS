import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadSafeUrl() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/security/safeUrl.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.safeUrl !== "function") throw new Error("safeUrl export missing");
    return { safeUrl: mod.safeUrl, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("safeUrl: разрешает только allowlist протоколов", async () => {
  const { safeUrl, cleanup } = await loadSafeUrl();
  try {
    const base = "https://yagodka.org/app/";
    assert.equal(safeUrl("https://example.com", { base, allowedProtocols: ["http:", "https:"] }), "https://example.com/");
    assert.equal(safeUrl("http://example.com/a?b=c", { base, allowedProtocols: ["http:", "https:"] }), "http://example.com/a?b=c");

    assert.equal(safeUrl("javascript:alert(1)", { base, allowedProtocols: ["http:", "https:"] }), null);
    assert.equal(safeUrl("data:text/html,<script>alert(1)</script>", { base, allowedProtocols: ["http:", "https:"] }), null);
    assert.equal(safeUrl("file:///etc/passwd", { base, allowedProtocols: ["http:", "https:"] }), null);

    assert.equal(safeUrl("blob:https://example.com/uuid", { base, allowedProtocols: ["http:", "https:"] }), null);
    assert.equal(safeUrl("blob:https://example.com/uuid", { base, allowedProtocols: ["http:", "https:", "blob:"] }), "blob:https://example.com/uuid");
  } finally {
    await cleanup();
  }
});

test("safeUrl: резолвит относительные URL через base", async () => {
  const { safeUrl, cleanup } = await loadSafeUrl();
  try {
    const base = "https://yagodka.org/app/index.html";
    assert.equal(safeUrl("/files/1", { base, allowedProtocols: ["http:", "https:"] }), "https://yagodka.org/files/1");
    assert.equal(safeUrl("files/1", { base, allowedProtocols: ["http:", "https:"] }), "https://yagodka.org/app/files/1");
  } finally {
    await cleanup();
  }
});

