import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadAppShellProjection() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/navigation/appShellProjection.ts")],
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

test("appShellProjection: main dm chat derives title/back/menu/call flags from one shell contract", async () => {
  const helper = await loadAppShellProjection();
  try {
    const shell = helper.buildAppShellProjection({
      page: "main",
      selected: { kind: "dm", id: "u-1" },
      profiles: { "u-1": { display_name: "Алиса", handle: "alice" } },
      groups: [],
      boards: [],
      authed: true,
      authMode: "login",
      conn: "connected",
      modal: null,
    });
    assert.equal(shell.pageTitle, "Чат с: Алиса");
    assert.equal(shell.navAction, "chat-back");
    assert.equal(shell.showCallActions, true);
    assert.equal(shell.showChatMenu, true);
    assert.equal(shell.showAuthButton, false);
    assert.equal(shell.canLogout, true);
  } finally {
    await helper.cleanup();
  }
});

test("appShellProjection: profile/search/files/menu flags are centralized for shell surfaces", async () => {
  const helper = await loadAppShellProjection();
  try {
    const profileShell = helper.buildAppShellProjection({
      page: "profile",
      selected: null,
      profiles: {},
      groups: [],
      boards: [],
      authed: false,
      authMode: "login",
      conn: "connected",
      modal: null,
    });
    assert.equal(profileShell.profileAreaOpen, true);
    assert.equal(profileShell.navAction, "nav-back");
    assert.equal(profileShell.canLogin, true);
    assert.equal(profileShell.isFilesPage, false);

    const filesShell = helper.buildAppShellProjection({
      page: "files",
      selected: null,
      profiles: {},
      groups: [],
      boards: [],
      authed: false,
      authMode: "auto",
      conn: "connected",
      modal: null,
    });
    assert.equal(filesShell.isFilesPage, true);
    assert.equal(filesShell.showAuthButton, false);
    assert.equal(filesShell.pageTitle, "Файлы");
  } finally {
    await helper.cleanup();
  }
});
