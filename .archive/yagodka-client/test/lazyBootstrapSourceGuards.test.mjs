import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

async function readSrc(relPath) {
  return await readFile(path.resolve(relPath), "utf8");
}

test("lazy bootstrap: mountApp and late wiring keep debug/PWA runtime behind lazy wrappers", async () => {
  const indexSrc = await readSrc("src/index.ts");
  assert.match(indexSrc, /void import\("\.\/helpers\/pwa\/registerServiceWorker"\)/);
  assert.doesNotMatch(indexSrc, /import \{ registerServiceWorker \} from "\.\/helpers\/pwa\/registerServiceWorker"/);

  const renderAppSrc = await readSrc("src/app/renderApp.ts");
  assert.match(renderAppSrc, /import\("\.\.\/pages\/help\/createHelpPage"\)/);
  assert.match(renderAppSrc, /import\("\.\.\/pages\/search\/createSearchPage"\)/);
  assert.match(renderAppSrc, /import\("\.\.\/pages\/profile\/createProfilePage"\)/);
  assert.match(renderAppSrc, /import\("\.\.\/pages\/profile\/createSessionsPage"\)/);
  assert.match(renderAppSrc, /import\("\.\.\/pages\/user\/createUserPage"\)/);
  assert.match(renderAppSrc, /import\("\.\.\/pages\/room\/createRoomPage"\)/);
  assert.match(renderAppSrc, /import\("\.\.\/pages\/files\/createFilesPage"\)/);
  assert.match(renderAppSrc, /import\("\.\.\/pages\/create\/createGroupCreatePage"\)/);
  assert.match(renderAppSrc, /import\("\.\.\/pages\/create\/createBoardCreatePage"\)/);
  assert.match(renderAppSrc, /Загрузка справки/);
  assert.doesNotMatch(renderAppSrc, /import \{ createHelpPage, type HelpPage \} from "\.\.\/pages\/help\/createHelpPage"/);
  assert.doesNotMatch(renderAppSrc, /import \{ createSearchPage, type SearchPage \} from "\.\.\/pages\/search\/createSearchPage"/);
  assert.doesNotMatch(renderAppSrc, /import \{ createProfilePage, type ProfilePage \} from "\.\.\/pages\/profile\/createProfilePage"/);
  assert.doesNotMatch(renderAppSrc, /import \{ createSessionsPage, type SessionsPage \} from "\.\.\/pages\/profile\/createSessionsPage"/);
  assert.doesNotMatch(renderAppSrc, /import \{ createUserPage, type UserPage \} from "\.\.\/pages\/user\/createUserPage"/);
  assert.doesNotMatch(renderAppSrc, /import \{ createRoomPage, type RoomPage \} from "\.\.\/pages\/room\/createRoomPage"/);
  assert.doesNotMatch(renderAppSrc, /import \{ createFilesPage, type FilesPage \} from "\.\.\/pages\/files\/createFilesPage"/);
  assert.doesNotMatch(renderAppSrc, /import \{ createGroupCreatePage, type CreateGroupPage \} from "\.\.\/pages\/create\/createGroupCreatePage"/);
  assert.doesNotMatch(renderAppSrc, /import \{ createBoardCreatePage, type CreateBoardPage \} from "\.\.\/pages\/create\/createBoardCreatePage"/);
  assert.match(renderAppSrc, /createLazyCallModalRuntime/);
  assert.doesNotMatch(renderAppSrc, /import \{ createCallModal \} from "\.\.\/components\/modals\/call\/createCallModal"/);

  const renderModalSrc = await readSrc("src/components/modals/renderModal.ts");
  assert.match(renderModalSrc, /import\("\.\/renderHeavyModal"\)/);
  assert.match(renderModalSrc, /import\("\.\/renderSecondaryModal"\)/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderForwardModal \} from "\.\/renderForwardModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderFileViewerModal \} from "\.\/renderFileViewerModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderCallModal \} from "\.\/renderCallModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderMembersAddModal \} from "\.\/renderMembersAddModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderMembersRemoveModal \} from "\.\/renderMembersRemoveModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderRenameModal \} from "\.\/renderRenameModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderFileSendModal \} from "\.\/renderFileSendModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderInviteUserModal \} from "\.\/renderInviteUserModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderActionModal \} from "\.\/renderActionModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderBoardPostModal \} from "\.\/renderBoardPostModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderSendScheduleModal \} from "\.\/renderSendScheduleModal"/);
  assert.doesNotMatch(renderModalSrc, /import \{ renderReactionsModal \} from "\.\/renderReactionsModal"/);

  const renderSidebarSrc = await readSrc("src/components/sidebar/renderSidebar.ts");
  assert.match(renderSidebarSrc, /renderSidebarMobileDeferred/);
  assert.match(renderSidebarSrc, /renderSidebarDesktopTabsDeferred/);
  assert.match(renderSidebarSrc, /renderSidebarMenuDeferred/);
  assert.match(renderSidebarSrc, /renderSidebarStandaloneDeferred/);
  assert.doesNotMatch(renderSidebarSrc, /import \{ renderSidebarMobile \} from "\.\/renderSidebarMobile"/);
  assert.doesNotMatch(renderSidebarSrc, /const profileRow = roomRow\("☺", "Профиль"/);
  assert.doesNotMatch(renderSidebarSrc, /const contactRowsAll = buildContactRows\(contactCandidates\)/);
  assert.doesNotMatch(renderSidebarSrc, /const restBoards = boards\.filter/);

  const renderSidebarRuntimeSrc = await readSrc("src/components/sidebar/renderSidebarMobileRuntime.ts");
  assert.match(renderSidebarRuntimeSrc, /import\("\.\/renderSidebarMobile"\)/);

  const renderSidebarMenuRuntimeSrc = await readSrc("src/components/sidebar/renderSidebarMenuRuntime.ts");
  assert.match(renderSidebarMenuRuntimeSrc, /import\("\.\/renderSidebarMenuSurface"\)/);

  const renderSidebarDesktopTabsRuntimeSrc = await readSrc("src/components/sidebar/renderSidebarDesktopTabsRuntime.ts");
  assert.match(renderSidebarDesktopTabsRuntimeSrc, /import\("\.\/renderSidebarDesktopTabsSurface"\)/);

  const renderSidebarStandaloneRuntimeSrc = await readSrc("src/components/sidebar/renderSidebarStandaloneRuntime.ts");
  assert.match(renderSidebarStandaloneRuntimeSrc, /import\("\.\/renderSidebarStandalone"\)/);

  const tabNotifierLazySrc = await readSrc("src/helpers/notify/tabNotifierLazy.ts");
  assert.match(tabNotifierLazySrc, /import\("\.\/tabNotifier"\)/);
  assert.doesNotMatch(tabNotifierLazySrc, /import \{ getTabNotifier \} from "\.\/tabNotifier"/);

  const mountAppSrc = await readSrc("src/app/mountApp.ts");
  assert.match(mountAppSrc, /createLazyDebugTools/);
  assert.match(mountAppSrc, /createLazyChatSearchUiRuntime/);
  assert.match(mountAppSrc, /createLazyContextMenuActionsRuntime/);
  assert.match(mountAppSrc, /createLazyEmojiPopoverRuntime/);
  assert.match(mountAppSrc, /createLazyMembersChipsRuntime/);
  assert.match(mountAppSrc, /createLazyPwaRuntime/);
  assert.match(mountAppSrc, /helpers\/notify\/tabNotifierLazy/);
  assert.match(mountAppSrc, /features\/search\/searchResultLabels/);
  assert.match(mountAppSrc, /pwaRuntime\.startDeferredBoot\(\)/);
  assert.doesNotMatch(mountAppSrc, /createPwaInstallPromptFeature/);
  assert.doesNotMatch(mountAppSrc, /createPwaUpdateFeature/);
  assert.doesNotMatch(mountAppSrc, /createPwaNotifyFeature/);
  assert.doesNotMatch(mountAppSrc, /createPwaPushFeature/);
  assert.doesNotMatch(mountAppSrc, /createPwaShareFeature/);
  assert.doesNotMatch(mountAppSrc, /features\/search\/searchShareFormatters/);
  assert.doesNotMatch(mountAppSrc, /import \{ createChatSearchUiFeature \} from "\.\/features\/search\/chatSearchUiFeature"/);
  assert.doesNotMatch(mountAppSrc, /createMembersChipsFeature/);
  assert.doesNotMatch(mountAppSrc, /import \{ createContextMenuActionsFeature, type ContextMenuActionsFeature \} from "\.\/features\/contextMenu\/contextMenuActionsFeature"/);
  assert.doesNotMatch(mountAppSrc, /installDebugHud/);
  assert.doesNotMatch(mountAppSrc, /createEmojiPopoverFeature/);
  assert.doesNotMatch(mountAppSrc, /helpers\/notify\/tabNotifier"(?!Lazy)/);

  const handleServerCommonSrc = await readSrc("src/app/handleServerMessage/common.ts");
  assert.match(handleServerCommonSrc, /helpers\/notify\/tabNotifierLazy/);
  assert.doesNotMatch(handleServerCommonSrc, /helpers\/notify\/tabNotifier"(?!Lazy)/);

  const lateWiringSrc = await readSrc("src/app/bootstrap/installLateWiring.ts");
  assert.match(lateWiringSrc, /createClientConnectionWorker/);
  assert.match(lateWiringSrc, /createLazyNavigationDeferredRuntime/);
  assert.match(lateWiringSrc, /createLazyRoomModerationActionsRuntime/);
  assert.match(lateWiringSrc, /createLazyPwaUpdateRuntime/);
  assert.match(lateWiringSrc, /membersChipsFeature\?\.startDeferredBoot\?\.\(\)/);
  assert.match(lateWiringSrc, /bindDebugMonitor\?\.\(\{ store, gateway \}\)/);
  assert.match(lateWiringSrc, /pwaUpdateRuntime\.startDeferredBoot\(\)/);
  assert.match(lateWiringSrc, /connectionWorker\.startAfterClientUpdateReady\(\)/);
  assert.match(lateWiringSrc, /navigationDeferredRuntime\.startDeferredBoot\(\)/);
  assert.doesNotMatch(lateWiringSrc, /gateway\.connect\(\)/);
  assert.doesNotMatch(lateWiringSrc, /createHotkeyActionsFeature/);
  assert.doesNotMatch(lateWiringSrc, /createHotkeyAdapterActionsFeature/);
  assert.doesNotMatch(lateWiringSrc, /createHotkeysFeature/);
  assert.doesNotMatch(lateWiringSrc, /installSidebarChatContextInteractionsFeature/);
  assert.doesNotMatch(lateWiringSrc, /createProfileActionsFeature/);
  assert.doesNotMatch(lateWiringSrc, /createSearchHistoryActionsFeature/);
  assert.doesNotMatch(lateWiringSrc, /createSearchInputActionsFeature/);
  assert.doesNotMatch(lateWiringSrc, /formatSearchHistoryShareText/);
  assert.doesNotMatch(lateWiringSrc, /formatSearchServerShareText/);
  assert.doesNotMatch(lateWiringSrc, /createNotifyActionsFeature/);
  assert.doesNotMatch(lateWiringSrc, /createRoomModerationActionsFeature/);
  assert.doesNotMatch(lateWiringSrc, /installDebugMonitorFeature/);
  assert.doesNotMatch(lateWiringSrc, /createPwaUpdateFeature/);

  const chatSurfaceEventsSrc = await readSrc("src/app/features/navigation/chatSurfaceEventsFeature.ts");
  assert.match(chatSurfaceEventsSrc, /createLazyChatSurfaceDeferredRuntime/);
  assert.match(chatSurfaceEventsSrc, /createLazyChatSurfaceMediaRuntime/);
  assert.match(chatSurfaceEventsSrc, /deferredRuntime\.maybeHandleChatClick/);
  assert.match(chatSurfaceEventsSrc, /deferredRuntime\.maybeHandleSelectionBarClick/);
  assert.match(chatSurfaceEventsSrc, /mediaRuntime\.maybeHandleChatClick/);
  assert.match(chatSurfaceEventsSrc, /handleCriticalActionClick/);
  assert.match(chatSurfaceEventsSrc, /group-invite-accept/);
  assert.match(chatSurfaceEventsSrc, /file-download/);
  assert.doesNotMatch(chatSurfaceEventsSrc, /ensureChatMessageLoadedById/);
  assert.doesNotMatch(chatSurfaceEventsSrc, /formatTime/);
  assert.doesNotMatch(chatSurfaceEventsSrc, /requestVoiceAutoplay/);
  assert.doesNotMatch(chatSurfaceEventsSrc, /isVideoLikeFile/);

  const chatSurfaceDeferredRuntimeSrc = await readSrc("src/app/features/navigation/chatSurfaceDeferredRuntime.ts");
  assert.match(chatSurfaceDeferredRuntimeSrc, /import\("\.\/chatSurfaceDeferredActions"\)/);
  assert.match(chatSurfaceDeferredRuntimeSrc, /DEFERRED_CHAT_ACTIONS/);
  assert.match(chatSurfaceDeferredRuntimeSrc, /DEFERRED_SELECTION_ACTIONS/);

  const chatSurfaceMediaRuntimeSrc = await readSrc("src/app/features/navigation/chatSurfaceMediaRuntime.ts");
  assert.match(chatSurfaceMediaRuntimeSrc, /import\("\.\/chatSurfaceMediaActions"\)/);
  assert.match(chatSurfaceMediaRuntimeSrc, /handleVoicePlaceholderClick/);
  assert.match(chatSurfaceMediaRuntimeSrc, /toggleResolvedVoicePlayback/);
  assert.match(chatSurfaceMediaRuntimeSrc, /ensureVoiceFallbackBound/);
  assert.match(chatSurfaceMediaRuntimeSrc, /handleMediaToggleClick/);
  assert.match(chatSurfaceMediaRuntimeSrc, /handleOpenFileViewerClick/);

  const chatSurfaceMediaActionsSrc = await readSrc("src/app/features/navigation/chatSurfaceMediaActions.ts");
  assert.match(chatSurfaceMediaActionsSrc, /requestVoiceAutoplay\(fileId\)/);
  assert.match(chatSurfaceMediaActionsSrc, /enqueueFileGet\(fileId,\s*\{\s*priority:\s*"high",\s*silent:\s*true\s*\}\)/);
  assert.doesNotMatch(chatSurfaceMediaActionsSrc, /status:\s*name\s*\?\s*`Загрузка:/);

  const chatHostEventsSrc = await readSrc("src/app/features/navigation/chatHostEventsFeature.ts");
  assert.match(chatHostEventsSrc, /createLazyChatHostDeferredRuntime/);
  assert.match(chatHostEventsSrc, /deferredRuntime\.startDeferredBoot\(\)/);
  assert.doesNotMatch(chatHostEventsSrc, /ResizeObserver/);
  assert.doesNotMatch(chatHostEventsSrc, /loadedmetadata",/);
  assert.doesNotMatch(chatHostEventsSrc, /touchmove",/);

  const chatHostDeferredRuntimeSrc = await readSrc("src/app/features/navigation/chatHostDeferredRuntime.ts");
  assert.match(chatHostDeferredRuntimeSrc, /import\("\.\/chatHostDeferredEvents"\)/);
  assert.match(chatHostDeferredRuntimeSrc, /startDeferredBoot/);

  const renderChatSrc = await readSrc("src/components/chat/renderChat.ts");
  assert.match(renderChatSrc, /renderPinnedDeferred/);
  assert.match(renderChatSrc, /renderSearchAuxDeferred/);
  assert.match(renderChatSrc, /buildHistoryRenderSurface/);
  assert.doesNotMatch(renderChatSrc, /renderChatPinnedSurface/);
  assert.doesNotMatch(renderChatSrc, /renderAlbumLine/);

  const historyRenderSurfaceSrc = await readSrc("src/components/chat/historyRenderSurface.ts");
  assert.match(historyRenderSurfaceSrc, /renderDeferredAlbumLine/);
  assert.match(historyRenderSurfaceSrc, /buildHistoryLayoutBlocks/);

  const chatAuxRuntimeSrc = await readSrc("src/components/chat/chatAuxRuntime.ts");
  assert.match(chatAuxRuntimeSrc, /import\("\.\/chatAuxSurface"\)/);
  assert.match(chatAuxRuntimeSrc, /renderPinnedDeferred/);
  assert.match(chatAuxRuntimeSrc, /renderSearchAuxDeferred/);

  const chatDeferredMediaRuntimeSrc = await readSrc("src/components/chat/chatDeferredMediaRuntime.ts");
  assert.match(chatDeferredMediaRuntimeSrc, /import\("\.\/chatDeferredMediaSurface"\)/);
  assert.match(chatDeferredMediaRuntimeSrc, /renderDeferredVoicePlayer/);
  assert.match(chatDeferredMediaRuntimeSrc, /renderDeferredAlbumLine/);

  const renderChatHelpersSrc = await readSrc("src/components/chat/renderChatHelpers.ts");
  assert.match(renderChatHelpersSrc, /renderDeferredSysMessage/);
  assert.match(renderChatHelpersSrc, /renderDeferredVisualPreview/);
  assert.doesNotMatch(renderChatHelpersSrc, /function renderInviteCard/);
  assert.doesNotMatch(renderChatHelpersSrc, /function sysActions/);
  assert.doesNotMatch(renderChatHelpersSrc, /export function renderImagePreviewButton/);
  assert.doesNotMatch(renderChatHelpersSrc, /export function renderVideoPreviewButton/);

  const chatSpecialMessageRuntimeSrc = await readSrc("src/components/chat/chatSpecialMessageRuntime.ts");
  assert.match(chatSpecialMessageRuntimeSrc, /import\("\.\/chatSpecialMessageSurface"\)/);
  assert.match(chatSpecialMessageRuntimeSrc, /renderDeferredSysMessage/);

  const chatVisualPreviewRuntimeSrc = await readSrc("src/components/chat/chatVisualPreviewRuntime.ts");
  assert.match(chatVisualPreviewRuntimeSrc, /import\("\.\/chatVisualPreviewSurface"\)/);
  assert.match(chatVisualPreviewRuntimeSrc, /renderDeferredVisualPreview/);

  const roomCreateSubmitSrc = await readSrc("src/app/features/navigation/roomCreateSubmitFeature.ts");
  assert.match(roomCreateSubmitSrc, /membersInputShared/);
  assert.doesNotMatch(roomCreateSubmitSrc, /normalizeHandle, type MembersChipsFeature \} from "\.\.\/members\/membersChipsFeature"/);

  const roomMembersSubmitSrc = await readSrc("src/app/features/navigation/roomMembersSubmitFeature.ts");
  assert.match(roomMembersSubmitSrc, /membersInputShared/);
  assert.doesNotMatch(roomMembersSubmitSrc, /parseMembersInput, type MembersChipsFeature \} from "\.\.\/members\/membersChipsFeature"/);
});

test("lazy bootstrap: emoji helpers no longer drag emoji catalog into eager startup code", async () => {
  const boardToolSrc = await readSrc("src/app/features/navigation/boardToolInputActionsFeature.ts");
  assert.match(boardToolSrc, /helpers\/ui\/textSelection/);
  assert.doesNotMatch(boardToolSrc, /helpers\/ui\/emoji/);

  const emojiHelperSrc = await readSrc("src/helpers/ui/emoji.ts");
  assert.match(emojiHelperSrc, /import \* as emojiCatalogModule from "\.\/emojiCatalog"/);
  assert.match(emojiHelperSrc, /Promise\.resolve\(emojiCatalogModule\)/);
  assert.match(emojiHelperSrc, /export \{ insertTextAtSelection \} from "\.\/textSelection"/);

  const emojiCatalogSrc = await readSrc("src/helpers/ui/emojiCatalog.ts");
  assert.match(emojiCatalogSrc, /from "\.\/emojiShared"/);
});

test("lazy bootstrap: vite keeps debug runtime and deferred PWA helpers out of generic eager chunks", async () => {
  const viteSrc = await readSrc("vite.config.ts");
  assert.match(viteSrc, /\/src\/config\/changelog\//);
  assert.match(viteSrc, /return "page-help"/);
  assert.match(viteSrc, /\/src\/config\/app\.ts/);
  assert.match(viteSrc, /\/src\/config\/env\.ts/);
  assert.match(viteSrc, /return "boot-config"/);
  assert.match(viteSrc, /\/src\/pages\/help\//);
  assert.match(viteSrc, /\/src\/pages\/search\//);
  assert.match(viteSrc, /return "page-search"/);
  assert.match(viteSrc, /\/src\/pages\/profile\//);
  assert.match(viteSrc, /return "page-profile"/);
  assert.match(viteSrc, /\/src\/pages\/user\//);
  assert.match(viteSrc, /return "page-user"/);
  assert.match(viteSrc, /\/src\/pages\/room\//);
  assert.match(viteSrc, /return "page-room"/);
  assert.match(viteSrc, /\/src\/pages\/files\//);
  assert.match(viteSrc, /return "page-files"/);
  assert.match(viteSrc, /\/src\/pages\/create\//);
  assert.match(viteSrc, /return "page-create"/);
  assert.match(viteSrc, /\/src\/helpers\/skin\/skin\.ts/);
  assert.match(viteSrc, /\/src\/helpers\/theme\/theme\.ts/);
  assert.match(viteSrc, /\/src\/helpers\/ui\/appViewport\.ts/);
  assert.match(viteSrc, /\/src\/helpers\/ui\/fancyCaret\.ts/);
  assert.match(viteSrc, /\/src\/helpers\/ui\/environmentAgent\.ts/);
  assert.match(viteSrc, /return "boot-helpers"/);
  assert.match(viteSrc, /\/src\/helpers\/pwa\/registerServiceWorker\.ts/);
  assert.match(viteSrc, /return "boot-pwa"/);
  assert.match(viteSrc, /\/src\/app\/features\/emoji\//);
  assert.match(viteSrc, /return "app-emoji"/);
  assert.match(viteSrc, /\/src\/helpers\/chat\/historyIdb\.ts/);
  assert.match(viteSrc, /\/src\/helpers\/chat\/historyCache\.ts/);
  assert.match(viteSrc, /\/src\/helpers\/chat\/historyCachePrefs\.ts/);
  assert.match(viteSrc, /\/src\/helpers\/files\/fileTransferHistory\.ts/);
  assert.match(viteSrc, /return "helper-history-storage"/);
  assert.match(viteSrc, /\/src\/helpers\/notify\/tabNotifier\.ts/);
  assert.match(viteSrc, /return "helper-notify"/);
  assert.match(viteSrc, /\/src\/helpers\/ui\/debugHud/);
  assert.match(viteSrc, /return "app-debug"/);
  assert.match(viteSrc, /\/src\/helpers\/pwa\/installPrompt/);
  assert.match(viteSrc, /\/src\/helpers\/pwa\/shouldReloadForBuild/);
  assert.match(viteSrc, /return "app-pwa"/);
  assert.match(viteSrc, /\/src\/app\/features\/contextMenu\/contextMenuActionsFeature/);
  assert.match(viteSrc, /\/src\/app\/features\/contextMenu\/roomModerationActionsFeature/);
  assert.match(viteSrc, /return "app-context-actions"/);
  assert.match(viteSrc, /\/src\/app\/features\/hotkeys\//);
  assert.match(viteSrc, /\/src\/app\/features\/navigation\/sidebarChatContextInteractionsFeature\.ts/);
  assert.match(viteSrc, /\/src\/app\/features\/navigation\/chatSurfaceDeferredActions\.ts/);
  assert.match(viteSrc, /return "app-chat-surface-secondary"/);
  assert.match(viteSrc, /\/src\/app\/features\/navigation\/chatSurfaceMediaActions\.ts/);
  assert.match(viteSrc, /return "app-chat-surface-media"/);
  assert.match(viteSrc, /\/src\/app\/features\/navigation\/chatHostDeferredEvents\.ts/);
  assert.match(viteSrc, /return "app-chat-host-deferred"/);
  assert.match(viteSrc, /\/src\/app\/features\/search\/chatSearchUiFeature\.ts/);
  assert.match(viteSrc, /\/src\/app\/features\/members\/membersChipsFeature\.ts/);
  assert.match(viteSrc, /return "app-search-members-ui"/);
  assert.match(viteSrc, /\/src\/app\/features\/profile\/profileActionsFeature\.ts/);
  assert.match(viteSrc, /\/src\/app\/features\/search\/searchInputActionsFeature\.ts/);
  assert.match(viteSrc, /\/src\/app\/features\/search\/searchHistoryActionsFeature\.ts/);
  assert.match(viteSrc, /\/src\/app\/features\/search\/searchShareFormatters\.ts/);
  assert.match(viteSrc, /\/src\/app\/features\/pwa\/notifyActionsFeature\.ts/);
  assert.match(viteSrc, /return "app-nav-deferred"/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderHeavyModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderForwardModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderFileViewerModal\.ts/);
  assert.match(viteSrc, /return "modal-heavy"/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderSecondaryModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderMembersAddModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderMembersRemoveModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderRenameModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderFileSendModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderInviteUserModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderActionModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderBoardPostModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderSendScheduleModal\.ts/);
  assert.match(viteSrc, /\/src\/components\/modals\/renderReactionsModal\.ts/);
  assert.match(viteSrc, /return "modal-secondary"/);
  assert.match(viteSrc, /\/src\/components\/chat\/chatAuxSurface\.ts/);
  assert.match(viteSrc, /\/src\/components\/chat\/chatPinnedSurface\.ts/);
  assert.match(viteSrc, /return "chat-aux-surface"/);
  assert.match(viteSrc, /\/src\/components\/chat\/chatDeferredMediaSurface\.ts/);
  assert.match(viteSrc, /return "chat-media-surface"/);
  assert.match(viteSrc, /\/src\/components\/chat\/chatSpecialMessageSurface\.ts/);
  assert.match(viteSrc, /return "chat-special-message-surface"/);
  assert.match(viteSrc, /\/src\/components\/chat\/chatVisualPreviewSurface\.ts/);
  assert.match(viteSrc, /return "chat-visual-preview-surface"/);
  assert.match(viteSrc, /\/src\/components\/sidebar\/renderSidebarMobile\.ts/);
  assert.match(viteSrc, /return "sidebar-mobile"/);
  assert.match(viteSrc, /\/src\/components\/sidebar\/renderSidebarMenuSurface\.ts/);
  assert.match(viteSrc, /return "sidebar-menu"/);
  assert.match(viteSrc, /\/src\/components\/sidebar\/renderSidebarDesktopTabsSurface\.ts/);
  assert.match(viteSrc, /return "sidebar-desktop-tabs"/);
  assert.match(viteSrc, /\/src\/components\/sidebar\/renderSidebarStandalone\.ts/);
  assert.match(viteSrc, /return "sidebar-standalone"/);
  assert.match(viteSrc, /\/src\/components\/modals\/call\/createCallModal\.ts/);
  assert.match(viteSrc, /return "modal-call"/);
  assert.doesNotMatch(viteSrc, /return "emoji-catalog"/);
});
