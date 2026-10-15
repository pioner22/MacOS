import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadSidebarState() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/sidebar/sidebarState.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { ...mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("sidebarState: cache snapshot переводит sidebar layer в loaded/cache с reconcilePending", async () => {
  const helper = await loadSidebarState();
  try {
    const next = helper.applySidebarFolderSnapshot(
      {
        mobileSidebarTab: "contacts",
        sidebarFolderId: "all",
        sidebarQuery: "",
        sidebarArchiveOpen: true,
        chatFolders: [],
        sidebarSync: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
      },
      { v: 1, active: "f_team", folders: [{ id: "f_team", title: "Команда", include: ["dm:222"], exclude: [] }] },
      { source: "cache", reconcilePending: true }
    );
    assert.equal(next.sidebarFolderId, "f_team");
    assert.equal(next.chatFolders.length, 1);
    assert.equal(next.sidebarSync.loaded, true);
    assert.equal(next.sidebarSync.source, "cache");
    assert.equal(next.sidebarSync.reconcilePending, true);
  } finally {
    await helper.cleanup();
  }
});

test("sidebarState: local tab/query/archive mutations проходят через единый owner", async () => {
  const helper = await loadSidebarState();
  try {
    let next = {
      mobileSidebarTab: "contacts",
      sidebarFolderId: "all",
      sidebarQuery: "",
      sidebarArchiveOpen: true,
      chatFolders: [],
      sidebarSync: { loaded: true, source: "server", reconcilePending: false, lastServerAt: 1, lastLocalAt: null },
    };
    next = helper.setMobileSidebarTabValue(next, "groups");
    next = helper.setSidebarQueryValue(next, "alpha");
    next = helper.setSidebarArchiveOpenValue(next, false);
    assert.equal(next.mobileSidebarTab, "groups");
    assert.equal(next.sidebarQuery, "alpha");
    assert.equal(next.sidebarArchiveOpen, false);
    assert.equal(next.sidebarSync.source, "server");
    assert.equal(typeof next.sidebarSync.lastLocalAt, "number");
  } finally {
    await helper.cleanup();
  }
});

test("sidebarState: mobile tab normalization сводит legacy/raw values к canonical tabs", async () => {
  const helper = await loadSidebarState();
  try {
    assert.equal(helper.normalizeMobileSidebarTab("contacts"), "contacts");
    assert.equal(helper.normalizeMobileSidebarTab("groups"), "groups");
    assert.equal(helper.normalizeMobileSidebarTab("boards"), "boards");
    assert.equal(helper.normalizeMobileSidebarTab("menu"), "menu");
    assert.equal(helper.normalizeMobileSidebarTab("chats"), "contacts");
    assert.equal(helper.normalizeMobileSidebarTab("weird"), "contacts");
  } finally {
    await helper.cleanup();
  }
});
