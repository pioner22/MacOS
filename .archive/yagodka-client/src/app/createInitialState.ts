import type { AppState } from "../stores/types";
import { APP_VERSION } from "../config/app";
import { getStoredSkinId } from "../helpers/skin/skin";
import { resolveInitialTheme } from "../helpers/theme/theme";
import { getStoredAuthId, getStoredSessionToken, isSessionAutoAuthBlocked } from "../helpers/auth/session";
import { getPushOptOut } from "../helpers/pwa/pushPrefs";
import { loadActiveBuildId } from "../helpers/pwa/buildIdStore";
import { getNotifyInAppEnabled, getNotifySoundEnabled } from "../helpers/notify/notifyPrefs";
import { getStoredMessageView } from "../helpers/ui/messageView";
import { createRuntimeDeliverySyncState } from "../helpers/runtime/deliverySync";
import { createPwaUpdateState } from "../helpers/pwa/updateState";

export function createInitialState(): AppState {
  const skin = getStoredSkinId();
  const theme = resolveInitialTheme(skin);
  const messageView = getStoredMessageView();
  const rememberedId = getStoredAuthId();
  const sessionToken = getStoredSessionToken();
  const autoBlocked = isSessionAutoAuthBlocked();
  const authMode = sessionToken && !autoBlocked ? "auto" : rememberedId ? "login" : "register";
  const status = autoBlocked
    ? "Сессия уже активна в другом окне. Чтобы продолжить здесь, подтвердите вход ещё раз."
    : authMode === "auto"
      ? "Пробуем восстановить сохранённую сессию…"
      : "Подключаем устройство к серверу…";
  const pushSupported = (() => {
    try {
      return Boolean(
        typeof window !== "undefined" &&
          "serviceWorker" in navigator &&
          "PushManager" in window &&
          "Notification" in window
      );
    } catch {
      return false;
    }
  })();
  const pushPermission = (() => {
    try {
      return (Notification?.permission ?? "default") as "default" | "granted" | "denied";
    } catch {
      return "default";
    }
  })();
  const pushOptOut = getPushOptOut();
  const notifyInAppEnabled = getNotifyInAppEnabled();
  const notifySoundEnabled = getNotifySoundEnabled();
  return {
    conn: "connecting",
    netLeader: false,
    authed: false,
    selfId: null,
    serverVersion: null,
    clientVersion: loadActiveBuildId(APP_VERSION),
    status,
    authMode,
    authRememberedId: rememberedId,
    skin,
    skins: [
      { id: "yagodka-modern", title: "Yagodka Modern" },
      { id: "telegram-exact", title: "Telegram (точный)" },
    ],
    theme,
    messageView,
    mobileSidebarTab: "contacts",
    sidebarFolderId: "all",
    sidebarQuery: "",
    sidebarArchiveOpen: true,
    sidebarSync: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastLocalAt: null },
    presenceTick: 0,
    friends: [],
    topPeers: [],
    pendingIn: [],
    pendingOut: [],
    muted: [],
    blocked: [],
    blockedBy: [],
    pinned: [],
    archived: [],
    chatFolders: [],
    pinnedMessages: {},
    pinnedMessageActive: {},
    pinnedBarHidden: {},
    pendingGroupInvites: [],
    pendingGroupJoinRequests: [],
    pendingBoardInvites: [],
    fileOffersIn: [],
    fileTransfers: [],
    fileThumbs: {},
    groups: [],
    boards: [],
    selected: null,
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
    lastRead: {},
    outbox: {},
    deliverySync: createRuntimeDeliverySyncState(),
    drafts: {},
    input: "",
    editing: null,
    replyDraft: null,
    forwardDraft: null,
    chatSelection: null,
    boardComposerOpen: false,
    boardScheduledPosts: [],
    chatSearchOpen: false,
    chatSearchResultsOpen: false,
    chatSearchQuery: "",
    chatSearchDate: "",
    chatSearchFilter: "all",
    chatSearchHits: [],
    chatSearchPos: 0,
    chatSearchCounts: { all: 0, media: 0, files: 0, links: 0, music: 0, voice: 0 },
    page: "main",
    rightPanel: null,
    userViewId: null,
    groupViewId: null,
    boardViewId: null,
    searchQuery: "",
    searchResults: [],
    groupCreateMessage: "",
    boardCreateMessage: "",
    profiles: {},
    profileDraftDisplayName: "",
    profileDraftHandle: "",
    profileDraftBio: "",
    profileDraftStatus: "",
    sessionDevices: [],
    sessionDevicesStatus: null,
    toast: null,
    modal: { kind: "auth" },
    updateLatest: null,
    updateDismissedLatest: null,
    pwaUpdateAvailable: false,
    pwaUpdate: createPwaUpdateState(),
    desktopUpdate: {
      state: "idle",
      supported: false,
      reason: "",
      appVersion: APP_VERSION,
      feedUrl: "",
      autoCheck: false,
      updateInfo: null,
      progress: null,
      error: "",
      updatedAt: null,
    },
    pwaPushSupported: pushSupported,
    pwaPushPermission: pushPermission,
    pwaPushSubscribed: false,
    pwaPushPublicKey: null,
    pwaPushStatus: null,
    pwaPushOptOut: pushOptOut,
    notifyInAppEnabled,
    notifySoundEnabled,

    avatarsRev: 0,
  };
}
