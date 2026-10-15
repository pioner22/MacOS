import { createChatSearchCounts } from "../../../helpers/chat/chatSearch";
import { clearStoredSessionToken, getStoredSessionToken, storeAuthId } from "../../../helpers/auth/session";
import { resetNavigationState } from "../../../helpers/navigation/viewState";
import { resetRuntimeDeliveryState } from "../../../helpers/runtime/deliverySync";
import { resetSidebarState } from "../../../helpers/sidebar/sidebarState";
import { clearOutboxForUser } from "../../../helpers/pwa/outboxSync";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { flushDrafts, flushHistoryCache, flushOutbox, flushPinnedMessages } from "../persistence/localPersistenceTimers";

export interface LogoutFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  clearToast: () => void;
  resetAutoAuthAttempt: () => void;
  onHistoryLogout: () => void;
  onPwaPushLogout: () => void;
  resetFileGet: () => void;
  resetFileDownloadActions: () => void;
  resetFileDownloads: () => void;
  resetPreviewWarmup: () => void;
  resetLoadedForUser: () => void;
  clearBoardScheduleTimer: () => void;
  resetInput: () => void;
  reconnectGateway: () => void;
  lastReadSentAt: Map<string, number>;
  cachedPreviewsAttempted: Map<string, number>;
  cachedThumbsAttempted: Map<string, number>;
  previewPrefetchAttempted: Map<string, number>;
}

export interface LogoutFeature {
  logout: () => void;
}

export function createLogoutFeature(deps: LogoutFeatureDeps): LogoutFeature {
  const {
    store,
    send,
    clearToast,
    resetAutoAuthAttempt,
    onHistoryLogout,
    onPwaPushLogout,
    resetFileGet,
    resetFileDownloadActions,
    resetFileDownloads,
    resetPreviewWarmup,
    resetLoadedForUser,
    clearBoardScheduleTimer,
    resetInput,
    reconnectGateway,
    lastReadSentAt,
    cachedPreviewsAttempted,
    cachedThumbsAttempted,
    previewPrefetchAttempted,
  } = deps;

  function logout() {
    flushDrafts(store);
    flushPinnedMessages(store);
    flushOutbox(store);
    flushHistoryCache(store);
    clearToast();

    const st = store.get();
    const id = String(st.selfId || "").trim();
    const rememberedId = id || String(st.authRememberedId || "").trim() || null;

    const session = getStoredSessionToken();
    if (st.conn === "connected" && st.authed) {
      send({ type: "logout", ...(session ? { session } : {}) });
    }

    if (id) storeAuthId(id);
    if (id) void clearOutboxForUser(id);
    clearStoredSessionToken();

    resetAutoAuthAttempt();
    onHistoryLogout();
    lastReadSentAt.clear();
    cachedPreviewsAttempted.clear();
    cachedThumbsAttempted.clear();
    previewPrefetchAttempted.clear();
    onPwaPushLogout();
    resetFileGet();
    resetFileDownloadActions();
    resetFileDownloads();
    resetPreviewWarmup();

    const toRevoke = (st.fileTransfers || [])
      .map((entry) => entry.url)
      .filter((url): url is string => Boolean(url));
    for (const url of toRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }

    const thumbToRevoke = Object.values(st.fileThumbs || {})
      .map((entry) => entry?.url)
      .filter((url): url is string => Boolean(url));
    for (const url of thumbToRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }

    store.set((prev) => ({
      ...resetRuntimeDeliveryState(resetSidebarState(resetNavigationState(prev, { page: "main" }))),
      authed: false,
      selfId: null,
      friends: [],
      pendingIn: [],
      pendingOut: [],
      muted: [],
      blocked: [],
      blockedBy: [],
      pinned: [],
      pinnedMessages: {},
      pinnedMessageActive: {},
      pendingGroupInvites: [],
      pendingGroupJoinRequests: [],
      pendingBoardInvites: [],
      fileOffersIn: [],
      fileThumbs: {},
      groups: [],
      boards: [],
      conversations: {},
      historySync: {},
      rosterSync: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastPresenceAt: null },
      profileSync: {},
      historyLoaded: {},
      historyPreviewOnly: {},
      historyCursor: {},
      historyHasMore: {},
      historyLoading: {},
      historyLoadingSlots: {},
      historyVirtualStart: {},
      input: "",
      editing: null,
      boardComposerOpen: false,
      boardScheduledPosts: [],
      chatSearchOpen: false,
      chatSearchResultsOpen: false,
      chatSearchQuery: "",
      chatSearchDate: "",
      chatSearchFilter: "all",
      chatSearchHits: [],
      chatSearchPos: 0,
      chatSearchCounts: createChatSearchCounts(),
      profiles: {},
      profileDraftDisplayName: "",
      profileDraftHandle: "",
      sessionDevices: [],
      sessionDevicesStatus: null,
      toast: null,
      modal: { kind: "auth" },
      authMode: rememberedId ? "login" : "register",
      authRememberedId: rememberedId,
      status: "Вы вышли из аккаунта. Для продолжения войдите снова или выберите другой аккаунт.",
    }));

    resetLoadedForUser();
    clearBoardScheduleTimer();
    resetInput();

    // Сбрасываем серверную авторизацию через переподключение.
    reconnectGateway();
  }

  return { logout };
}
