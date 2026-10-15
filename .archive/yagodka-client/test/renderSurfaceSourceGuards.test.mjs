import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("render surfaces: sidebar and chat keep extracted helpers outside the main renderers", async () => {
  const [renderSidebarSrc, renderChatSrc, sidebarToolsSrc, chatTopSurfaceSrc] = await Promise.all([
    readFile(path.resolve("src/components/sidebar/renderSidebar.ts"), "utf8"),
    readFile(path.resolve("src/components/chat/renderChat.ts"), "utf8"),
    readFile(path.resolve("src/components/sidebar/renderSidebarUiTools.ts"), "utf8"),
    readFile(path.resolve("src/components/chat/chatTopSurface.ts"), "utf8"),
  ]);

  assert.match(renderSidebarSrc, /createSidebarRenderTools/);
  assert.doesNotMatch(renderSidebarSrc, /const buildSidebarSearchBar =/);
  assert.doesNotMatch(renderSidebarSrc, /const buildChatlist =/);
  assert.match(sidebarToolsSrc, /export function createSidebarRenderTools/);
  assert.match(sidebarToolsSrc, /buildSidebarSearchBar/);
  assert.match(sidebarToolsSrc, /buildChatlist/);

  assert.match(renderChatSrc, /renderChatSearchBarSurface/);
  assert.match(renderChatSrc, /renderChatSelectionBarSurface/);
  assert.doesNotMatch(renderChatSrc, /class: "modal-input chat-search-input"/);
  assert.doesNotMatch(renderChatSrc, /chat-selection-cancel/);
  assert.match(chatTopSurfaceSrc, /export function renderChatSearchBarSurface/);
  assert.match(chatTopSurfaceSrc, /export function renderChatSelectionBarSurface/);
});
