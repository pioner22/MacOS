import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

test("messenger surface polish: history, dialogs and profile share W-0975 layer", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0975:\s*messenger surface polish/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s*\{[\s\S]*?--msg-in-radius:\s*18px/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-context-active\s+\.msg-body/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-unread\s+\.msg-sep-pill/);
  assert.match(css, /\.sidebar\s+\.row-tail-top,\s*[\s\S]*?\.sidebar\s+\.row-tail-bottom/);
  assert.match(css, /\.page\.page-profile,\s*[\s\S]*?\.page\.page-user,\s*[\s\S]*?\.page\.page-room/);
  assert.match(css, /\.profile-session-card,\s*[\s\S]*?\.member-row/);
});

test("messenger surface polish: media cards keep explicit mobile constraints", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0975:\s*richer, readable media cards/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-file="image"\]\s+\.chat-file-preview/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-media-overlay-controls/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-footer="overlay"\]\s+\.msg-meta/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.file-progress-candy/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?--chat-media-frame-width:\s*min\(82%,\s*var\(--chat-media-frame-max\),\s*var\(--msg-body-max-width\)\)/);
});

test("messenger surface polish: W-0976 keeps media stable on mobile", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0976:\s*media stability repair/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-media-progress\s*\{[\s\S]*?inset:\s*50%\s*auto\s*auto\s*50%;[\s\S]*?transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-file-preview\s+\.chat-media-state-active\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-file-preview\.chat-file-preview-video-note\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?clip-path:\s*none/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\s+\.file-row-chat\.file-row-audio[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
  assert.match(css, /W-0976:\s*visual stability repair/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg:not\(\.msg-sys\)\s+\.msg-body\s*\{[\s\S]*?background-color\s+120ms\s+ease/);
});

test("messenger surface polish: W-0977 shrink-wraps desktop captioned media", async () => {
  const css = await readCssWithImports("src/scss/style.css");
  const previewShared = await readFile(new URL("../src/components/chat/chatVisualPreviewShared.ts", import.meta.url), "utf8");

  assert.match(css, /W-0977:\s*desktop\/Web captioned media must shrink-wrap the preview/);
  assert.match(
    css,
    /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-footer="stacked"\]:not\(\[data-msg-album="1"\]\)\[data-msg-file="image"\]\s+\.msg-body,[\s\S]*?\.msg-attach\[data-msg-footer="stacked"\]:not\(\[data-msg-album="1"\]\)\[data-msg-file="video"\]\s+\.msg-body\s*\{[\s\S]*?width:\s*fit-content;[\s\S]*?align-items:\s*stretch/
  );
  assert.match(css, /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?min-width:\s*min\(260px,\s*var\(--chat-media-frame-width\)\)/);
  assert.match(previewShared, /export const CHAT_MEDIA_PREVIEW_SCALE = 0\.5;/);
  assert.match(previewShared, /const w = info\.mediaW \|\| info\.thumbW \|\| CHAT_MEDIA_PREVIEW_FALLBACK_BASE_PX;/);
});

test("messenger surface polish: W-0992 reserves rigid history media slots", async () => {
  const css = await readCssWithImports("src/scss/style.css");
  const previewShared = await readFile(new URL("../src/components/chat/chatVisualPreviewShared.ts", import.meta.url), "utf8");
  const previewRuntime = await readFile(new URL("../src/components/chat/chatVisualPreviewRuntime.ts", import.meta.url), "utf8");
  const previewSurface = await readFile(new URL("../src/components/chat/chatVisualPreviewSurface.ts", import.meta.url), "utf8");

  assert.match(css, /W-0992:\s*rigid history media slots before lazy media loads/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-file="image"\]:not\(\[data-msg-album="1"\]\)\s+\.chat-file-preview\[data-history-geometry="reserved"\]/);
  assert.match(css, /aspect-ratio:\s*var\(--chat-media-slot-ratio,\s*4 \/ 3\)/);
  assert.match(previewShared, /const historyMediaSlotRatios = new Map<string,\s*number>\(\);/);
  assert.match(previewShared, /export function resolveHistoryMediaSlotSize/);
  assert.match(previewRuntime, /data-history-geometry/);
  assert.match(previewSurface, /applyReservedHistoryMediaSlot/);
});

test("messenger surface polish: W-0999 bounds tall media and viewer chrome", async () => {
  const css = await readCssWithImports("src/scss/style.css");
  const previewShared = await readFile(new URL("../src/components/chat/chatVisualPreviewShared.ts", import.meta.url), "utf8");

  assert.match(css, /W-0999:\s*hard history tail and media containment/);
  assert.match(css, /--chat-media-frame-max-h:\s*min\(52dvh,\s*440px\)/);
  assert.match(
    css,
    /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-file="image"\]:not\(\[data-msg-album="1"\]\)\s+\.chat-file-preview\[data-history-geometry="reserved"\],[\s\S]*?max-height:\s*var\(--chat-media-frame-max-h\)/
  );
  assert.match(css, /\.overlay\.overlay-viewer\s*\{[\s\S]*?z-index:\s*80/);
  assert.match(css, /W-1010:\s*final visual viewer fit/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\]\s+\.viewer-header-actions\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\]\s+\.viewer-stage,[\s\S]*?max-height:\s*none/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\]:not\(\.viewer-zoomed\)[\s\S]*?\.viewer-media \.viewer-img,[\s\S]*?max-height:\s*100%\s*!important/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?--chat-media-frame-max-h:\s*min\(46dvh,\s*360px\)/);
  assert.match(previewShared, /CHAT_HISTORY_IMAGE_SLOT_RATIO_MIN\s*=\s*0\.72/);
  assert.match(previewShared, /CHAT_HISTORY_MEDIA_SLOT_RATIO_MIN\s*=\s*0\.4/);
  assert.match(previewShared, /CHAT_HISTORY_MEDIA_SLOT_RATIO_MAX\s*=\s*2\.6/);
});

test("messenger surface polish: W-1006 hides stale media placeholders over loaded previews", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-1006:\s*stale lazy placeholders must never draw a strip over loaded media/);
  assert.ok(css.includes('.chat:not(.chat-board) .msg-attach[data-msg-file="image"] .chat-file-preview:not(.chat-file-preview-empty):not(.chat-file-preview-missing) > .chat-file-placeholder'));
  assert.ok(css.includes(".chat:not(.chat-board) .chat-file-preview:has(> img.chat-file-img) > .chat-file-placeholder"));
  assert.ok(css.includes(".chat:not(.chat-board) .chat-file-preview:has(> video.chat-file-video) > .chat-file-placeholder"));
  assert.ok(css.includes(".chat:not(.chat-board) .chat-file-preview:has(> img.chat-file-img) > .chat-media-state-idle"));
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-file-preview:has\(>\s*video\.chat-file-video\)\s*>\s*\.chat-media-state-idle\s*\{[\s\S]*?display:\s*none\s*!important/);
});

test("messenger surface polish: W-1012 keeps visible media free of stale progress chrome", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-1012:\s*screenshot repair for PWA viewer\/history geometry/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-file-preview:has\(>\s*img\.chat-file-img\)\s*>\s*\.chat-media-progress,[\s\S]*?\.chat-file-preview:has\(>\s*video\.chat-file-video\)\s*>\s*\.chat-media-progress\s*\{[\s\S]*?opacity:\s*0\s*;/);
  assert.match(css, /\.chat-jump\[data-jump-unread="0"\]\s+\.chat-jump-badge,[\s\S]*?\.chat-jump\[data-jump-unread="0"\]\s+\.chat-jump-label\s*\{[\s\S]*?display:\s*none\s*!important/);
});

test("messenger surface polish: W-1040 media overlay shell does not blur the photo top edge", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-1040:\s*chat media overlay controls must not blur the photo top edge/);
  assert.match(
    css,
    /\.chat:not\(\.chat-board\)\s+\.msg-attach\s+\.file-row-chat\.file-row-image\s+\.file-actions,\s*\.chat:not\(\.chat-board\)\s+\.chat-media-overlay-controls\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?-webkit-backdrop-filter:\s*none;[\s\S]*?backdrop-filter:\s*none;[\s\S]*?box-shadow:\s*none;/
  );

  const blurRuleIndex = css.indexOf("blur(12px) saturate(135%)");
  const cleanupIndex = css.lastIndexOf("W-1040: chat media overlay controls must not blur the photo top edge");
  assert.ok(blurRuleIndex >= 0 && cleanupIndex > blurRuleIndex, "W-1040 cleanup must override the earlier overlay-container blur rule");
});

test("messenger surface polish: W-0978 keeps Android bubbles and context menu bounded", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0978:\s*Android WebView message fallback/);
  assert.match(css, /html\.env-os-android\s+\.chat:not\(\.chat-board\)\s+\.msg-body\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(css, /html\.env-os-android\s+\.chat:not\(\.chat-board\)\s+\.chat-file-preview/);
  assert.match(css, /html\.env-os-android\s+\.ctx-menu\.ctx-menu-message-action-list\s*\{[\s\S]*?max-width:\s*min\(276px,\s*calc\(100dvw - 28px\)\)/);
  assert.match(css, /html\.env-os-android\s+\.ctx-menu\.ctx-menu-message-action-list\s+\.ctx-list\s*\{[\s\S]*?max-height:\s*min\(var\(--ctx-list-max-h,\s*292px\),\s*calc\(100dvh - 168px\)\)/);
});

test("messenger surface polish: W-0985 keeps history media stable and date pills non-sticky", async () => {
  const css = await readCssWithImports("src/scss/style.css");
  const helperSrc = await readFile(new URL("../src/components/chat/renderChatHelpers.ts", import.meta.url), "utf8");

  assert.match(css, /W-0985:\s*stable frameless history media surfaces/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-file="image"\]\s+\.msg-body,[\s\S]*?\.msg-attach\.msg-album\[data-msg-album="1"\]\s+\.msg-body\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
  assert.match(css, /W-0985:\s*history typography and date separator anti-overlap/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-date\s*\{[\s\S]*?position:\s*relative;[\s\S]*?top:\s*auto/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-date\s+\.msg-sep-line\s*\{[\s\S]*?display:\s*none/);
  assert.doesNotMatch(helperSrc, /resolvePreviewBaseWidthPx\(info\)/);
});

test("messenger surface polish: W-0986 matches reference media scale, sharp dates and viewer chrome", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0986:\s*Telegram-reference history media cleanup/);
  assert.match(css, /--chat-media-frame-width:\s*min\(70%,\s*var\(--chat-media-frame-max\),\s*var\(--msg-body-max-width\)\)/);
  assert.match(css, /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?--chat-media-frame-width:\s*min\(390px,\s*var\(--msg-body-max-width\)\)/);
  assert.match(css, /\.msg-attach\[data-msg-file="image"\]:not\(\[data-msg-album="1"\]\)\s+\.chat-file-preview\s*>\s*\.chat-file-img,[\s\S]*?\.msg-attach\[data-msg-file="video"\]:not\(\[data-msg-album="1"\]\)\s+\.chat-file-preview\s*>\s*\.chat-file-video\s*\{[\s\S]*?object-fit:\s*contain;/);
  assert.match(css, /\.msg-attach\[data-msg-footer="stacked"\]\[data-msg-file="image"\]\s+\.msg-attach-footer-media,[\s\S]*?\.msg-attach\[data-msg-footer="stacked"\]\[data-msg-file="video"\]\s+\.msg-attach-footer-media\s*\{[\s\S]*?width:\s*100%;[\s\S]*?background:\s*transparent;/);
  assert.match(css, /W-0986:\s*reference cleanup for message density, sharp date pills and viewer chrome/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-date\s+\.msg-sep-pill\s*\{[\s\S]*?box-shadow:\s*none;[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.viewer-author,[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-header-actions\s+\.btn\s*\{[\s\S]*?opacity:\s*1;/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.viewer-header-actions\s+\.btn,[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-switcher-btn\s*\{[\s\S]*?background:\s*rgba\(0,\s*0,\s*0,\s*0\.46\)/);
});

test("messenger surface polish: W-0987 separates history item layers", async () => {
  const css = await readCssWithImports("src/scss/style.css");
  const contracts = await readFile(new URL("../src/components/chat/historyLayerContracts.ts", import.meta.url), "utf8");
  const sysRuntime = await readFile(new URL("../src/components/chat/chatSpecialMessageRuntime.ts", import.meta.url), "utf8");

  assert.match(contracts, /HISTORY_ITEM_LAYER_CONTRACTS/);
  for (const layer of ["layout", "text", "media", "audio", "date", "system", "interaction", "theme"]) {
    assert.match(contracts, new RegExp(`id:\\s*"${layer}"`));
  }
  assert.match(contracts, /isNoisySystemMessageText/);
  assert.match(contracts, /classifyHistorySystemMessageLayer/);
  assert.match(sysRuntime, /data-msg-system-layer/);
  assert.match(sysRuntime, /msg-sys-noise/);
  assert.match(css, /W-0987:\s*layered history item contracts/);
  assert.match(css, /--history-layer-rail-max:\s*min\(100%,\s*1040px\)/);
  assert.match(css, /--history-layer-gap:\s*4px/);
  assert.match(css, /--history-audio-frame-width:\s*min\(430px,\s*74%\)/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-lines\s*\{[\s\S]*?max-width:\s*var\(--history-layer-rail-max\);[\s\S]*?box-sizing:\s*border-box/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg:not\(\.msg-sys\):not\(\.msg-attach\)\s+\.msg-body\s*\{[\s\S]*?padding:\s*var\(--msg-in-pad-y\)\s+var\(--msg-in-pad-x\)\s+var\(--msg-in-pad-bottom\)/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-file="audio"\]\s+\.msg-body\s*\{[\s\S]*?width:\s*var\(--history-audio-frame-width\)/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-date\s*\{[\s\S]*?position:\s*relative\s*!important;[\s\S]*?top:\s*auto\s*!important/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-sys-noise\s*\{[\s\S]*?display:\s*none/);
});

test("messenger surface polish: W-0988 tightens history, profile and menu chrome", async () => {
  const css = await readCssWithImports("src/scss/style.css");
  const profileSrc = await readFile(new URL("../src/pages/profile/createProfilePage.ts", import.meta.url), "utf8");
  const menuSrc = await readFile(new URL("../src/components/sidebar/renderSidebarMenuSurface.ts", import.meta.url), "utf8");
  const sidebarToolsSrc = await readFile(new URL("../src/components/sidebar/renderSidebarUiTools.ts", import.meta.url), "utf8");

  assert.match(css, /W-0988:\s*screenshot-guided refinement for history,\s*profile and menu/);
  assert.match(css, /--history-layer-rail-max:\s*min\(100%,\s*900px\)/);
  assert.match(css, /--history-audio-frame-width:\s*min\(360px,\s*62%\)/);
  assert.match(css, /\.msg-attach\[data-msg-footer="stacked"\]\[data-msg-file="image"\]\s+\.msg-attach-footer-media\.msg-attach-footer-caption,[\s\S]*?border-radius:\s*0\s+0\s+var\(--chat-history-media-radius\)\s+var\(--chat-history-media-radius\)/);
  assert.match(css, /\.hdr-action,[\s\S]*?\.composer-actions\s+\.btn,[\s\S]*?transform:\s*none\s*!important/);
  assert.match(css, /\.sidebar\[data-sidebar-tab="menu"\]\s+\.sidebar-menu-row\s+\.row-prefix\s*\{[\s\S]*?width:\s*32px;[\s\S]*?animation:\s*none\s*!important/);
  assert.match(css, /\.sidebar-menu-row\[data-menu-icon="profile"\]\s+\.row-prefix\s*\{[\s\S]*?--menu-icon-mask:\s*var\(--menu-icon-profile\)/);
  assert.match(css, /\.sidebar-self-id-card\s*\{/);

  assert.match(profileSrc, /profileIdCard/);
  assert.match(profileSrc, /Ваш ID для контактов/);
  assert.match(profileSrc, /profileId\.textContent\s*=\s*myId\s*\?\s*`ID:\s*\$\{myId\}`\s*:\s*"ID появится после входа"/);
  assert.match(profileSrc, /onCopyId/);
  assert.match(profileSrc, /onShareId/);
  assert.match(profileSrc, /profileCompletenessValue\.textContent\s*=\s*completion\s*>=\s*100\s*\?\s*"Готов"/);
  assert.match(profileSrc, /profileNotifyValue\.textContent\s*=\s*subscribed\s*\?\s*"Включены"/);
  assert.match(profileSrc, /profileSessionsPill\.textContent\s*=\s*sessionEntries\.length\s*\?\s*`Устройств:/);

  assert.match(menuSrc, /function markMenuRow/);
  assert.match(menuSrc, /dataset\.menuIcon/);
  assert.match(menuSrc, /"Профиль и настройки"/);
  assert.match(menuSrc, /"Справка и версия"/);
  assert.doesNotMatch(menuSrc, /"Info"/);

  assert.match(sidebarToolsSrc, /buildSelfIdContactCard/);
  assert.match(sidebarToolsSrc, /Скопировать ID/);
  assert.match(sidebarToolsSrc, /navigator\.share/);
});

test("messenger surface polish: W-1059 redraws sidebar tabs, menu rows and mobile chrome", async () => {
  const css = await readCssWithImports("src/scss/style.css");
  const skinCss = await readFile(new URL("../public/skins/yagodka-modern.css", import.meta.url), "utf8");
  const chromeColorsSrc = await readFile(new URL("../src/helpers/ui/chromeColors.ts", import.meta.url), "utf8");
  const sidebarToolsSrc = await readFile(new URL("../src/components/sidebar/renderSidebarUiTools.ts", import.meta.url), "utf8");

  assert.match(css, /W-1059:\s*premium Telegram-like sidebar tabs,\s*menu chrome and PWA safe-area polish/);
  assert.match(css, /--sidebar-tab-icon-contacts:/);
  assert.match(css, /--sidebar-tab-icon-menu:/);
  assert.ok(css.includes('html[data-skin="yagodka-modern"] .sidebar-tabs:not(.sidebar-tabs-bottom-nav) .sidebar-tab::before'));
  assert.match(css, /mask:\s*var\(--sidebar-tab-icon\)\s+no-repeat\s+center\s*\/\s*contain/);
  assert.match(css, /\.sidebar-tabs:not\(\.sidebar-tabs-bottom-nav\)\s+\.sidebar-tab-active\s*\{[\s\S]*?animation:\s*w1059-tab-pop/);
  assert.match(css, /\.sidebar\[data-sidebar-tab="menu"\]\s+\.sidebar-menu-row::after\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);

  assert.match(skinCss, /:root\s*\{[\s\S]*?--app-host-canvas-bg:\s*#fbfcfb;/);
  assert.match(skinCss, /:root\[data-theme="dark"\]\s*\{[\s\S]*?--app-host-canvas-bg:\s*#14201c;/);
  assert.match(skinCss, /--premium-nav-bg:/);
  assert.match(chromeColorsSrc, /setMeta\("apple-mobile-web-app-status-bar-style",\s*theme === "dark"\s*\?\s*"black-translucent"\s*:\s*"default"\)/);
  assert.match(sidebarToolsSrc, /SIDEBAR_TAB_META/);
  assert.match(sidebarToolsSrc, /"data-tab-icon":\s*SIDEBAR_TAB_META\[tab\]\?\.icon \|\| tab/);
  assert.match(sidebarToolsSrc, /"data-sidebar-action":\s*"menu"/);
});

test("messenger surface polish: W-0989 keeps lazy media and audio geometry stable", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0989:\s*stable history media geometry/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-album-loading\s*\{[\s\S]*?contain:\s*layout style paint/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-album-loading\s+\.chat-album-grid-loading\s*\{[\s\S]*?min-height:\s*180px/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-album-loading\s+\.chat-album-footer-loading\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-deferred-voice-mount\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?contain:\s*layout style/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-file="audio"\]\s+\.chat-voice,[\s\S]*?\.chat-deferred-voice-mount\s+\.chat-voice\s*\{[\s\S]*?grid-template-columns:\s*30px minmax\(104px,\s*1fr\) 42px 28px/);
});

test("messenger surface polish: W-0990 bounds mobile media and viewer width", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0990:\s*mobile media\/viewer containment/);
  assert.match(css, /--history-mobile-media-max:\s*min\(100%,\s*calc\(100dvw - var\(--history-mobile-media-gutter\)\),\s*var\(--msg-body-max-width\)\)/);
  assert.match(css, /\.msg-attach\.msg-album\[data-msg-album="1"\]\s+\.chat-album-surface,[\s\S]*?\.msg-album-loading\s+\.chat-album-grid-loading\s*\{[\s\S]*?width:\s*var\(--chat-album-shell-width-resolved\)\s*!important;/);
  assert.match(css, /\.msg-attach\.msg-album\[data-msg-album="1"\]\[data-msg-album-layout="mosaic"\]\s+\.chat-album-grid,[\s\S]*?\.msg-album-loading\[data-msg-album-layout="mosaic"\]\s+\.chat-album-grid-loading\s*\{[\s\S]*?height:\s*auto\s*!important;[\s\S]*?aspect-ratio:\s*var\(--chat-album-shell-ratio,\s*1 \/ 1\)/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\.viewer-visual\s*\{[\s\S]*?width:\s*100dvw;[\s\S]*?max-width:\s*100dvw/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.viewer-media\s+\.viewer-img,[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-media\s+\.viewer-video\s*\{[\s\S]*?max-width:\s*min\(100dvw,\s*100%\);/);
});

test("messenger surface polish: W-0991 keeps mobile albums Telegram-sized without overflow", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0991:\s*Telegram-like mobile album scale/);
  assert.match(css, /--history-mobile-album-gutter:\s*36px/);
  assert.match(css, /--chat-album-frame-max:\s*372px/);
  assert.match(css, /--history-mobile-album-max:\s*min\(var\(--chat-album-frame-max\),\s*calc\(100dvw - var\(--history-mobile-album-gutter\)\)\)/);
  assert.match(css, /\.msg-attach\.msg-album\[data-msg-album="1"\]\s*\{[\s\S]*?--chat-album-shell-width-resolved:\s*min\([\s\S]*?var\(--chat-album-shell-width,\s*var\(--chat-album-frame-max\)\),[\s\S]*?var\(--history-mobile-album-max\)[\s\S]*?\)/);
  assert.match(css, /\.msg-attach\.msg-album\[data-msg-album="1"\]\s+\.msg-body\s*\{[\s\S]*?width:\s*var\(--chat-album-shell-width-resolved\);[\s\S]*?max-width:\s*min\(100%,\s*calc\(100dvw - var\(--history-mobile-album-gutter\)\)\)/);
});
