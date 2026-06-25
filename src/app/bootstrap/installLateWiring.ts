import { conversationKey } from "../../helpers/chat/conversationKey";
import { saveChatFoldersForUser } from "../../helpers/chat/folders";
import { savePinsForUser } from "../../helpers/chat/pins";
import { savePinnedMessagesForUser } from "../../helpers/chat/pinnedMessages";
import { copyText } from "../../helpers/dom/copyText";
import { loadAutoDownloadPrefs, saveAutoDownloadPrefs } from "../../helpers/files/autoDownloadPrefs";
import { setNotifyInAppEnabled, setNotifySoundEnabled } from "../../helpers/notify/notifyPrefs";
import { autosizeInput } from "../../helpers/ui/autosizeInput";
import { createClientConnectionWorker } from "./clientConnectionWorker";
import { createLazyNavigationDeferredRuntime } from "./lazyNavigationDeferredRuntime";
import { createLazyRoomModerationActionsRuntime } from "./lazyRoomModerationActionsRuntime";
import { createLazyPwaUpdateRuntime } from "./lazyPwaUpdateRuntime";
import { createDesktopUpdateFeature } from "../features/desktop/desktopUpdateFeature";
import { createFileActionsFeature } from "../features/files/fileActionsFeature";
import { installEditingEndSyncFeature } from "../features/history/editingEndSyncFeature";
import { createAuthUiActionsFeature } from "../features/auth/authUiActionsFeature";
import { createActionsAccountFeature } from "../features/navigation/actionsAccountFeature";
import { createActionsUiOpenersFeature } from "../features/navigation/actionsUiOpenersFeature";
import { installMainRenderSubscriptionFeature } from "../features/navigation/mainRenderSubscriptionFeature";
import { createPageSetDispatchFeature } from "../features/navigation/pageSetDispatchFeature";
import { installHistoryCachePersistFeature } from "../features/persistence/historyCachePersistFeature";
import { flushRuntimeDelivery, scheduleSaveHistoryCache } from "../features/persistence/localPersistenceTimers";
import { applyRestartStateSnapshot } from "../features/persistence/restartStateRestoreFeature";
import { createRestartStateFeature } from "../features/persistence/restartStateFeature";
import { createUserLocalStateHydrationFeature } from "../features/persistence/userLocalStateHydrationFeature";
import { createChatSearchSyncFeature } from "../features/search/chatSearchSyncFeature";
import { searchableMessagesForSelected } from "../features/search/searchableMessagesFeature";
import { createSidebarPreferencesActionsFeature } from "../features/sidebar/sidebarPreferencesActionsFeature";
import { renderApp } from "../renderApp";

export function installLateWiring(deps: any) {
  const {
    store,
    gateway,
    root,
    layout,
    coarsePointerMq,
    mobileSidebarMq,
    floatingSidebarMq,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
    isFloatingSidebarOpen,
    setFloatingSidebarOpen,
    setMobileSidebarTab,
    isChatMessageSelectable,
    setChatSelectionValueAtIdx,
    setChatSelectionAnchorIdx,
    setSuppressMsgSelectToggleClickUntil,
    setSuppressChatClickUntil,
    getSuppressChatClickUntil,
    setMsgContextSelection,
    getLastUserInputAt,
    markUserInput,
    contextMenuFeature,
    contextMenuActionsFeature,
    avatarFeature,
    outboxFeature,
    fileDownloadActions,
    fileOffers,
    fileSendModalFeature,
    autoDownloadCachePolicyFeature,
    fileViewer,
    openChatSearch,
    closeChatSearch,
    closeRightPanel,
    closeMobileSidebar,
    closeModal,
    callRequestMediaAccess,
    callOpenMediaSettings,
    callAccept,
    callDecline,
    setPage,
    logout,
    openGroupCreateModal,
    openBoardCreateModal,
    debugHud,
    bindDebugMonitor,
    openConfirmModal,
    openActionModal,
    showToast,
    scheduleFocusComposer,
    requestFreshHttpDownloadUrl,
    clearComposerHelper,
    composerHelperDraftFeature,
    composerSendMenuFeature,
    composerSendMenuActionsFeature,
    sendChat,
    selectTarget,
    openUserPage,
    openGroupPage,
    openBoardPage,
    openMembersAddModal,
    openMembersRemoveModal,
    openRenameModal,
    maybeSendMessageRead,
    toggleChatSelection,
    jumpToChatMsgIdx,
    setChatSearchQuery,
    buildHelperDraft,
    beginEditingMessage,
    roomInfoSubmitFeature,
    authFeature,
    setSkin,
    setTheme,
    pwaShareFeature,
    pwaNotifyFeature,
    enablePush,
    disablePush,
    createGroup,
    createBoard,
    membersAddSubmit,
    membersRemoveSubmit,
    renameSubmit,
    sendScheduleSubmit,
    sendScheduleWhenOnlineSubmit,
    forwardViewerSelectionActionsFeature,
    modalSubmitFeature,
    authRequestsFeature,
    groupBoardJoinFeature,
    roomInviteResponsesFeature,
    publishBoardPost,
    openChatFromSearch,
    membersChipsFeature,
    historyFeature,
    virtualHistoryFeature,
    syncNavOverlay,
    scheduleChatJumpVisibility,
    requestHistory,
    previewAutoFetchFeature,
    hasPendingFileActivityForUpdate,
    scheduleHistoryWarmup,
    maybeAutoFillHistoryViewport,
    maybeAutoRetryHistory,
    convoSig,
    normalizeChatSearchFilter,
    sameChatSearchCounts,
    sameNumberArray,
    armBoardScheduleTimer,
    scheduleBoardEditorPreview,
    initSkins,
  } = deps as any;

  try {
    bindDebugMonitor?.({ store, gateway });
  } catch {
    // ignore
  }

  const restartStateFeature = createRestartStateFeature();
  const desktopUpdateFeature = createDesktopUpdateFeature({
    store,
    showToast,
    flushBeforeInstall: () => {
      flushRuntimeDelivery(store);
      restartStateFeature.save(store.get());
    },
  });
  desktopUpdateFeature.bind();
  desktopUpdateFeature.start();

  const pwaUpdateRuntime = createLazyPwaUpdateRuntime({
    store,
    send: (payload) => gateway.send(payload),
    flushBeforeReload: () => {
      flushRuntimeDelivery(store);
      restartStateFeature.save(store.get());
    },
    getLastUserInputAt,
    hasPendingHistoryActivityForUpdate: () => historyFeature?.hasPendingActivityForUpdate() ?? false,
    hasPendingPreviewActivityForUpdate: () => previewAutoFetchFeature.hasPendingActivityForUpdate(),
    hasPendingFileActivityForUpdate: () =>
      typeof hasPendingFileActivityForUpdate === "function" ? hasPendingFileActivityForUpdate() : false,
  });
  pwaUpdateRuntime.startDeferredBoot();

  async function applyPwaUpdateNow(opts?: { mode?: "auto" | "manual"; buildId?: string }) {
    await pwaUpdateRuntime.applyPwaUpdateNow(opts);
  }

  function deferPwaUpdate() {
    pwaUpdateRuntime.deferPwaUpdate();
  }

  function forceUpdateReload(reason?: string) {
    pwaUpdateRuntime.forceUpdateReload(reason);
  }

  async function forcePwaUpdate() {
    await pwaUpdateRuntime.forcePwaUpdate();
  }

  function scheduleAutoApplyPwaUpdate(delayMs = 800) {
    pwaUpdateRuntime.scheduleAutoApplyPwaUpdate(delayMs);
  }

  const connectionWorker = createClientConnectionWorker({
    store,
    gateway,
    desktopUpdateWorker: desktopUpdateFeature,
    updateWorker: pwaUpdateRuntime,
  });

  const navigationDeferredRuntime = createLazyNavigationDeferredRuntime({
    hotkeyActions: {
      store,
      send: (payload) => gateway.send(payload),
      closeMobileSidebar,
      closeModal,
      setPage,
      logout,
      openGroupCreateModal,
      openBoardCreateModal,
      toggleDebugHud: () => {
        debugHud.toggle();
        return debugHud.isEnabled();
      },
    },
    hotkeyAdapterActions: {
      onManualPwaUpdate: () => {
        void applyPwaUpdateNow({ mode: "manual" });
      },
      onFileViewerNavigate: fileViewer.navigate,
      onOpenChatSearch: openChatSearch,
      onCloseMobileSidebar: closeMobileSidebar,
      onCloseModal: closeModal,
      onCloseChatSearch: closeChatSearch,
      onCloseRightPanel: closeRightPanel,
      onSetMainPage: () => setPage("main"),
      isMobileSidebarOpen,
      isFloatingSidebarOpen,
    },
    hotkeys: {
      store,
      hotkeysRoot: layout.hotkeys,
    },
    sidebarChatContextInteractions: {
      store,
      sidebar: layout.sidebar,
      sidebarBody: layout.sidebarBody,
      chat: layout.chat,
      chatHost: layout.chatHost,
      coarsePointerMq,
      mobileSidebarMq,
      isMobileSidebarOpen,
      setMobileSidebarTab,
      isChatMessageSelectable,
      setChatSelectionValueAtIdx,
      setChatSelectionAnchorIdx,
      setSuppressMsgSelectToggleClickUntil,
      setSuppressChatClickUntil,
      getSuppressChatClickUntil,
      setMsgContextSelection,
      openContextMenu: (target, x, y) => {
        contextMenuFeature?.openContextMenu(target, x, y);
      },
      onReplySwipeCommit: (swipeKey, swipeIdx) => {
        const st = store.get();
        if (st.editing || !st.selected || !swipeKey) return;
        const key = conversationKey(st.selected);
        if (!key || key !== swipeKey) return;
        const conv = st.conversations[key] || null;
        const msg = conv && swipeIdx >= 0 && swipeIdx < conv.length ? conv[swipeIdx] : null;
        const draft = msg ? buildHelperDraft(st, key, msg) : null;
        if (!draft) return;
        setSuppressChatClickUntil(Date.now() + 800);
        store.set({ replyDraft: draft, forwardDraft: null });
        scheduleFocusComposer();
      },
    },
    profileActions: {
      store,
      send: (payload) => gateway.send(payload),
      markUserInput,
      buildSearchServerShareText: () => "",
      tryAppendShareTextToSelected: (text) => Boolean(pwaShareFeature?.tryAppendShareTextToSelected(text)),
      copyText,
      getAvatarFeature: () => avatarFeature,
    },
    searchInputActions: {
      store,
      send: (payload) => gateway.send(payload),
      markUserInput,
    },
    searchHistoryActions: {
      store,
      send: (payload) => gateway.send(payload),
      savePinsForUser,
      savePinnedMessagesForUser,
    },
    notifyActions: {
      store,
      enablePush,
      disablePush,
      setNotifyInAppEnabled,
      setNotifySoundEnabled,
      syncNotifyPrefsToServiceWorker: () => {
        pwaNotifyFeature?.syncNotifyPrefsToServiceWorker();
      },
      forcePwaUpdate,
    },
    tryAppendSearchShareTextToSelected: (text) => Boolean(pwaShareFeature?.tryAppendShareTextToSelected(text)),
    copyText,
  });

  const authUiActionsFeature = createAuthUiActionsFeature({
    store,
    logout,
    authLoginFromDom: () => authFeature?.authLoginFromDom(),
    authRegisterFromDom: () => authFeature?.authRegisterFromDom(),
    authTouchIdFromDom: () => authFeature?.authTouchIdFromDom(),
    closeModal,
    forceUpdateReload,
    applyPwaUpdateNow: () => applyPwaUpdateNow({ mode: "manual" }),
    deferPwaUpdate,
    setSkin,
    setTheme,
  });

  const roomModerationActionsFeature = createLazyRoomModerationActionsRuntime({
    store,
    send: (payload) => gateway.send(payload),
    openConfirmModal,
    showToast,
    saveRoomInfo: roomInfoSubmitFeature.saveRoomInfo,
  });

  const sidebarPreferencesActionsFeature = createSidebarPreferencesActionsFeature({
    store,
    sidebarBody: layout.sidebarBody,
    send: (payload) => gateway.send(payload),
    saveChatFoldersForUser,
  });

  const fileActionsFeature = createFileActionsFeature({
    store,
    getFileOffers: () => fileOffers,
    getFileSendModal: () => fileSendModalFeature,
    saveAutoDownloadPrefs,
    loadAutoDownloadPrefs,
    onAutoDownloadPrefsReloaded: (uid, prefs) => {
      autoDownloadCachePolicyFeature.setAutoDownloadPrefsCache(uid, prefs);
    },
  });

  const pageSetDispatchFeature = createPageSetDispatchFeature({
    store,
    setPage,
    send: (payload) => gateway.send(payload),
  });
  const actionsUiOpenersFeature = createActionsUiOpenersFeature({
    setPage,
    openSidebarToolsContextMenu: (x: number, y: number) => contextMenuFeature?.openContextMenu({ kind: "sidebar_tools", id: "main" }, x, y),
  });
  const actionsAccountFeature = createActionsAccountFeature({
    authUiActions: authUiActionsFeature,
    profileActions: navigationDeferredRuntime,
    notifyActions: navigationDeferredRuntime,
  });
  const actions = {
    onSelectTarget: selectTarget,
    onOpenUser: openUserPage,
    onCloseRightPanel: closeRightPanel,
    onOpenActionModal: openActionModal,
    onOpenHelp: actionsUiOpenersFeature.onOpenHelp,
    onOpenGroupCreate: openGroupCreateModal,
    onOpenBoardCreate: openBoardCreateModal,
    onSetPage: pageSetDispatchFeature.handleSetPage,
    onOpenSidebarToolsMenu: actionsUiOpenersFeature.onOpenSidebarToolsMenu,
    onRoomMemberRemove: roomModerationActionsFeature.onRoomMemberRemove,
    onBlockToggle: roomModerationActionsFeature.onBlockToggle,
    onRoomWriteToggle: roomModerationActionsFeature.onRoomWriteToggle,
    onRoomRefresh: roomModerationActionsFeature.onRoomRefresh,
    onRoomInfoSave: roomModerationActionsFeature.onRoomInfoSave,
    onRoomLeave: roomModerationActionsFeature.onRoomLeave,
    onRoomDisband: roomModerationActionsFeature.onRoomDisband,
    onSetMobileSidebarTab: setMobileSidebarTab,
    onSetSidebarFolderId: sidebarPreferencesActionsFeature.onSetSidebarFolderId,
    onSetSidebarQuery: sidebarPreferencesActionsFeature.onSetSidebarQuery,
    onToggleSidebarArchive: sidebarPreferencesActionsFeature.onToggleSidebarArchive,
    ...actionsAccountFeature,
    onDesktopUpdateCheck: desktopUpdateFeature.check,
    onDesktopUpdateDownload: desktopUpdateFeature.download,
    onDesktopUpdateInstall: desktopUpdateFeature.install,
    onCallRequestMediaAccess: callRequestMediaAccess,
    onCallOpenMediaSettings: callOpenMediaSettings,
    onCallAccept: callAccept,
    onCallDecline: callDecline,
    onGroupCreate: createGroup,
    onBoardCreate: createBoard,
    onMembersAdd: membersAddSubmit,
    onMembersRemove: membersRemoveSubmit,
    onRename: renameSubmit,
    onSendSchedule: sendScheduleSubmit,
    onSendScheduleWhenOnline: sendScheduleWhenOnlineSubmit,
    onForwardSend: forwardViewerSelectionActionsFeature.sendForwardToTargets,
    onInviteUser: modalSubmitFeature.inviteUserSubmit,
    onAuthRequest: authRequestsFeature.requestAuth,
    onAuthAccept: authRequestsFeature.acceptAuth,
    onAuthDecline: authRequestsFeature.declineAuth,
    onAuthCancel: authRequestsFeature.cancelAuth,
    onGroupJoin: groupBoardJoinFeature.joinGroup,
    onBoardJoin: groupBoardJoinFeature.joinBoard,
    onGroupInviteAccept: groupBoardJoinFeature.acceptGroupInvite,
    onGroupInviteDecline: groupBoardJoinFeature.declineGroupInvite,
    onGroupJoinAccept: roomInviteResponsesFeature.acceptGroupJoin,
    onGroupJoinDecline: roomInviteResponsesFeature.declineGroupJoin,
    onBoardInviteJoin: roomInviteResponsesFeature.joinBoardFromInvite,
    onBoardInviteDecline: roomInviteResponsesFeature.declineBoardInvite,
    onFileSendConfirm: fileActionsFeature.onFileSendConfirm,
    onFileViewerNavigate: fileViewer.navigate,
    onFileViewerJump: fileViewer.jumpFromViewer,
    onFileViewerRecover: () => void fileViewer.recoverCurrent(),
    onFileViewerShare: () => void forwardViewerSelectionActionsFeature.shareFromFileViewer(),
    onFileViewerForward: forwardViewerSelectionActionsFeature.forwardFromFileViewer,
    onFileViewerDelete: forwardViewerSelectionActionsFeature.deleteFromFileViewer,
    onFileViewerOpenAt: fileViewer.openAtIndex,
    onFileSend: fileActionsFeature.onFileSend,
    onFileOfferAccept: fileActionsFeature.onFileOfferAccept,
    onFileOfferReject: fileActionsFeature.onFileOfferReject,
    onClearCompletedFiles: fileActionsFeature.onClearCompletedFiles,
    onAutoDownloadPrefsSave: fileActionsFeature.onAutoDownloadPrefsSave,
    onSearchQueryChange: navigationDeferredRuntime.onSearchQueryChange,
    onSearchSubmit: navigationDeferredRuntime.onSearchSubmit,
    onBoardPostPublish: publishBoardPost,
    onOpenHistoryHit: openChatFromSearch,
    onSearchPinToggle: navigationDeferredRuntime.onSearchPinToggle,
    onSearchHistoryDelete: navigationDeferredRuntime.onSearchHistoryDelete,
    onSearchHistoryForward: navigationDeferredRuntime.onSearchHistoryForward,
    onContextMenuAction: (itemId: string) => {
      void contextMenuActionsFeature?.handleContextMenuAction(itemId);
    },
    onConfirmModal: modalSubmitFeature.confirmSubmit,
  };

  applyRestartStateSnapshot({
    store,
    restartStateFeature,
    input: layout.input,
    autosizeInput,
  });

  installEditingEndSyncFeature({
    store,
    input: layout.input,
    autosizeInput,
    scheduleBoardEditorPreview,
  });

  const userLocalStateHydrationFeature = createUserLocalStateHydrationFeature({
    store,
    input: layout.input,
    autosizeInput,
    armBoardScheduleTimer,
    syncOutboxFromServiceWorker: (userId) => outboxFeature?.syncFromServiceWorker(userId),
  });

  const chatSearchSyncFeature = createChatSearchSyncFeature({
    store,
    searchableMessagesForSelected,
    normalizeChatSearchFilter,
    sameChatSearchCounts,
    sameNumberArray,
  });

  installMainRenderSubscriptionFeature({
    store,
    layout,
    actions,
    renderApp,
    getUserLocalStateHydrationFeature: () => userLocalStateHydrationFeature,
    getChatSearchSyncFeature: () => chatSearchSyncFeature,
    syncNavOverlay,
    getHistoryFeature: () => historyFeature,
    getVirtualHistoryFeature: () => virtualHistoryFeature,
    scheduleChatJumpVisibility,
    onMembersAddModalVisible: () => {
      membersChipsFeature?.startDeferredBoot?.();
      membersChipsFeature?.renderMembersAddChips();
      membersChipsFeature?.drainMembersAddLookups();
    },
    closeMobileSidebar,
    mobileSidebarMq,
    floatingSidebarMq,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
    isFloatingSidebarOpen,
    setFloatingSidebarOpen,
    scheduleAutoApplyPwaUpdate,
    requestHistory,
    maybeSendMessageRead,
    scheduleFocusComposer,
    previewAutoFetchFeature,
    scheduleHistoryWarmup,
    maybeAutoFillHistoryViewport,
    maybeAutoRetryHistory,
    convoSig,
  });

  installHistoryCachePersistFeature({
    store,
    isHistoryCacheLoadedFor: (userId: string) => Boolean(userLocalStateHydrationFeature?.isHistoryCacheLoadedFor(userId)),
    scheduleSaveHistoryCache,
  });

  renderApp(layout, store.get(), actions);
  navigationDeferredRuntime.startDeferredBoot();

  void initSkins();
  connectionWorker.startAfterClientUpdateReady();

  // Remove the boot screen only after the app is ready enough to render UI.
  try {
    const boot = root.querySelector(".boot");
    if (boot instanceof HTMLElement) {
      const prefersReducedMotion = (() => {
        try {
          return typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
            : false;
        } catch {
          return false;
        }
      })();
      const sinceLoad = (() => {
        try {
          return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : null;
        } catch {
          return null;
        }
      })();
      const minVisibleMs = 420;
      const startDelay = sinceLoad !== null ? Math.max(0, Math.round(minVisibleMs - sinceLoad)) : 0;
      const fadeMs = prefersReducedMotion ? 0 : 260;

      window.setTimeout(() => {
        try {
          document.documentElement.classList.remove("app-frame-booting");
          root.classList.remove("app-frame-booting");
          boot.classList.add("boot-out");
          boot.setAttribute("aria-hidden", "true");
        } catch {
          // ignore
        }
        window.setTimeout(() => {
          try {
            boot.remove();
          } catch {
            // ignore
          }
        }, fadeMs);
      }, startDelay);
    } else {
      document.documentElement.classList.remove("app-frame-booting");
      root.classList.remove("app-frame-booting");
    }
  } catch {
    // ignore
  }

  try {
    window.dispatchEvent(new Event("yagodka:booted"));
  } catch {
    // ignore
  }

  return { userLocalStateHydrationFeature, chatSearchSyncFeature };
}
