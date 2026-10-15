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
      entryPoints: [path.resolve("src/app/features/navigation/pageSetDispatchFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createPageSetDispatchFeature !== "function") {
      throw new Error("createPageSetDispatchFeature export missing");
    }
    return { createPageSetDispatchFeature: mod.createPageSetDispatchFeature, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("pageSetDispatchFeature: profile page refreshes only profile data", async () => {
  const { createPageSetDispatchFeature, cleanup } = await loadFeature();
  try {
    const sent = [];
    const pages = [];
    const feature = createPageSetDispatchFeature({
      store: {
        get() {
          return { authed: true, conn: "connected" };
        },
      },
      setPage(page) {
        pages.push(page);
      },
      send(payload) {
        sent.push(payload);
      },
    });

    feature.handleSetPage("profile");

    assert.deepEqual(pages, ["profile"]);
    assert.deepEqual(sent, [{ type: "profile_get" }]);
  } finally {
    await cleanup();
  }
});

test("pageSetDispatchFeature: sessions page requests sessions snapshot", async () => {
  const { createPageSetDispatchFeature, cleanup } = await loadFeature();
  try {
    const sent = [];
    const pages = [];
    const feature = createPageSetDispatchFeature({
      store: {
        get() {
          return { authed: true, conn: "connected" };
        },
      },
      setPage(page) {
        pages.push(page);
      },
      send(payload) {
        sent.push(payload);
      },
    });

    feature.handleSetPage("sessions");

    assert.deepEqual(pages, ["sessions"]);
    assert.deepEqual(sent, [{ type: "sessions_list" }]);
  } finally {
    await cleanup();
  }
});
