import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadAppShellState() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/navigation/appShellState.ts")],
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

test("appShellState: applyRestartAppShellState восстанавливает shell+navigation одним owner", async () => {
  const helper = await loadAppShellState();
  try {
    const next = helper.applyRestartAppShellState(
      {
        page: "main",
        selected: null,
        rightPanel: { kind: "dm", id: "stale" },
        userViewId: null,
        groupViewId: null,
        boardViewId: null,
        input: "",
        drafts: {},
        pinned: [],
        archived: [],
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchDate: "",
        chatSearchFilter: "all",
        chatSearchPos: 0,
        searchQuery: "",
        profileDraftDisplayName: "",
        profileDraftHandle: "",
        profileDraftBio: "",
        profileDraftStatus: "",
      },
      {
        page: "user",
        selected: { kind: "dm", id: "u-1" },
        input: "draft",
        chatSearchOpen: true,
        chatSearchQuery: "hello",
        profileDraftDisplayName: "Alice",
      }
    );
    assert.equal(next.page, "user");
    assert.deepEqual(next.selected, { kind: "dm", id: "u-1" });
    assert.equal(next.userViewId, "u-1");
    assert.equal(next.rightPanel, null);
    assert.equal(next.input, "draft");
    assert.equal(next.chatSearchOpen, true);
    assert.equal(next.chatSearchQuery, "hello");
    assert.equal(next.profileDraftDisplayName, "Alice");
  } finally {
    await helper.cleanup();
  }
});

test("appShellState: auth modal, create page and modal close используют единый shell owner", async () => {
  const helper = await loadAppShellState();
  try {
    const authedPrompt = helper.openAuthModal(
      {
        authMode: "register",
        authRememberedId: "u-1",
        modal: null,
        status: "",
      },
      { mode: "login", message: "Войдите снова", status: "Введите код доступа" }
    );
    assert.equal(authedPrompt.authMode, "login");
    assert.deepEqual(authedPrompt.modal, { kind: "auth", message: "Войдите снова" });
    assert.equal(authedPrompt.status, "Введите код доступа");

    const createPage = helper.openCreatePageState(
      {
        page: "main",
        selected: { kind: "group", id: "g-1" },
        rightPanel: { kind: "group", id: "g-1" },
        mobileSidebarTab: "contacts",
        userViewId: null,
        groupViewId: "g-1",
        boardViewId: null,
        groupCreateMessage: "stale",
        boardCreateMessage: "keep",
      },
      "group_create"
    );
    assert.equal(createPage.page, "group_create");
    assert.equal(createPage.mobileSidebarTab, "menu");
    assert.equal(createPage.groupCreateMessage, "");
    assert.equal(createPage.rightPanel, null);

    const closed = helper.closeModalState(
      {
        modal: { kind: "update" },
        updateLatest: "0.1.999",
        updateDismissedLatest: null,
      },
      { dismissUpdate: true }
    );
    assert.equal(closed.modal, null);
    assert.equal(closed.updateDismissedLatest, "0.1.999");
  } finally {
    await helper.cleanup();
  }
});
