import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadInteractionPolicy() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/navigation/interactionPolicy.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (
      typeof mod.resolveEscapeInteractionAction !== "function" ||
      typeof mod.resolveOverlayInteractionAction !== "function" ||
      typeof mod.resolveHeaderNavBackAction !== "function" ||
      typeof mod.resolveHeaderChatBackAction !== "function"
    ) {
      throw new Error("interactionPolicy exports missing");
    }
    return {
      resolveEscapeInteractionAction: mod.resolveEscapeInteractionAction,
      resolveOverlayInteractionAction: mod.resolveOverlayInteractionAction,
      resolveHeaderNavBackAction: mod.resolveHeaderNavBackAction,
      resolveHeaderChatBackAction: mod.resolveHeaderChatBackAction,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("interactionPolicy: Escape соблюдает единый priority order", async () => {
  const { resolveEscapeInteractionAction, cleanup } = await loadInteractionPolicy();
  try {
    assert.equal(
      resolveEscapeInteractionAction({
        modal: { kind: "context_menu", payload: { x: 1, y: 2, title: "Меню", target: { kind: "dm", id: "u1" }, items: [] } },
        chatSearchOpen: true,
        mobileSidebarOpen: true,
        floatingSidebarOpen: false,
        rightPanel: { kind: "dm", id: "u1" },
        page: "search",
        selected: { kind: "dm", id: "u1" },
      }),
      "close_modal"
    );
    assert.equal(
      resolveEscapeInteractionAction({
        modal: null,
        chatSearchOpen: true,
        mobileSidebarOpen: true,
        floatingSidebarOpen: false,
        rightPanel: { kind: "dm", id: "u1" },
        page: "search",
        selected: { kind: "dm", id: "u1" },
      }),
      "close_chat_search"
    );
    assert.equal(
      resolveEscapeInteractionAction({
        modal: null,
        chatSearchOpen: false,
        mobileSidebarOpen: false,
        floatingSidebarOpen: true,
        rightPanel: { kind: "dm", id: "u1" },
        page: "search",
        selected: { kind: "dm", id: "u1" },
      }),
      "close_sidebar"
    );
    assert.equal(
      resolveEscapeInteractionAction({
        modal: null,
        chatSearchOpen: false,
        mobileSidebarOpen: false,
        floatingSidebarOpen: false,
        rightPanel: { kind: "dm", id: "u1" },
        page: "search",
        selected: { kind: "dm", id: "u1" },
      }),
      "close_right_panel"
    );
    assert.equal(
      resolveEscapeInteractionAction({
        modal: null,
        chatSearchOpen: false,
        mobileSidebarOpen: false,
        floatingSidebarOpen: false,
        rightPanel: null,
        page: "search",
        selected: null,
      }),
      "set_page_main"
    );
    assert.equal(
      resolveEscapeInteractionAction({
        modal: null,
        chatSearchOpen: false,
        mobileSidebarOpen: false,
        floatingSidebarOpen: false,
        rightPanel: null,
        page: "main",
        selected: { kind: "dm", id: "u1" },
      }),
      "none"
    );
  } finally {
    await cleanup();
  }
});

test("interactionPolicy: overlay dismiss различает none consume close", async () => {
  const { resolveOverlayInteractionAction, cleanup } = await loadInteractionPolicy();
  try {
    assert.equal(resolveOverlayInteractionAction(null, 2000), "none");
    assert.equal(
      resolveOverlayInteractionAction(
        { kind: "context_menu", payload: { x: 1, y: 2, title: "Меню", target: { kind: "dm", id: "u1" }, items: [] } },
        2000
      ),
      "close_modal"
    );
    assert.equal(
      resolveOverlayInteractionAction({ kind: "file_viewer", chatKey: "dm:u1", msgIdx: 1, fileId: "f1", openedAtMs: 1700 }, 2000),
      "consume"
    );
    assert.equal(
      resolveOverlayInteractionAction({ kind: "file_viewer", chatKey: "dm:u1", msgIdx: 1, fileId: "f1", openedAtMs: 1200 }, 2000),
      "close_modal"
    );
  } finally {
    await cleanup();
  }
});

test("interactionPolicy: header back и chat back централизованы", async () => {
  const { resolveHeaderNavBackAction, resolveHeaderChatBackAction, cleanup } = await loadInteractionPolicy();
  try {
    assert.equal(resolveHeaderNavBackAction({ modal: null, page: "search" }), "set_page_main");
    assert.equal(resolveHeaderNavBackAction({ modal: { kind: "auth" }, page: "search" }), "none");
    assert.equal(resolveHeaderChatBackAction({ modal: null, page: "main", selected: { kind: "dm", id: "u1" } }), "clear_selected_target");
    assert.equal(resolveHeaderChatBackAction({ modal: { kind: "auth" }, page: "main", selected: { kind: "dm", id: "u1" } }), "none");
    assert.equal(resolveHeaderChatBackAction({ modal: null, page: "search", selected: { kind: "dm", id: "u1" } }), "none");
  } finally {
    await cleanup();
  }
});

test("interactionPolicy: hotkeys и topbar используют централизованный resolver", async () => {
  const [hotkeysSrc, topbarSrc] = await Promise.all([
    readFile(path.resolve("src/app/features/hotkeys/hotkeysFeature.ts"), "utf8"),
    readFile(path.resolve("src/app/features/navigation/topbarActionsFeature.ts"), "utf8"),
  ]);
  assert.match(hotkeysSrc, /resolveEscapeInteractionAction/);
  assert.match(topbarSrc, /resolveOverlayInteractionAction/);
  assert.match(topbarSrc, /resolveHeaderNavBackAction/);
  assert.match(topbarSrc, /resolveHeaderChatBackAction/);
});
