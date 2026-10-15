import { conversationKey } from "../../../helpers/chat/conversationKey";
import {
  getActiveConversationKey,
  getActiveConversationTarget,
  hasActiveConversationSelection,
  isMainConversationSurface,
} from "../../../helpers/navigation/mainConversationState";
import type { Layout } from "../../../components/layout/types";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";
import type { RenderActions } from "../../renderApp";

interface MainHistoryFeature {
  applyPendingAutoScrollAfterRender: (st: AppState) => void;
  maybeBootstrapPrefetch: (st: AppState) => void;
}

interface MainVirtualHistoryFeature {
  maybeClampStartAtTop: (st: AppState) => boolean;
}

interface MainPreviewAutoFetchFeature {
  scheduleWarmupCachedPreviews: () => void;
  scheduleAutoFetchVisiblePreviews: () => void;
}

interface MainUserLocalStateHydrationFeature {
  maybeHydrateLocalState: () => boolean;
}

interface MainChatSearchSyncFeature {
  maybeSyncChatSearchState: () => boolean;
}

export interface MainRenderSubscriptionFeatureDeps {
  store: Store<AppState>;
  layout: Layout;
  actions: RenderActions;
  renderApp: (layout: Layout, state: AppState, actions: RenderActions) => void;
  getUserLocalStateHydrationFeature: () => MainUserLocalStateHydrationFeature | null;
  getChatSearchSyncFeature: () => MainChatSearchSyncFeature | null;
  syncNavOverlay: () => void;
  getHistoryFeature: () => MainHistoryFeature | null;
  getVirtualHistoryFeature: () => MainVirtualHistoryFeature | null;
  scheduleChatJumpVisibility: () => void;
  onMembersAddModalVisible: () => void;
  closeMobileSidebar: () => void;
  mobileSidebarMq: MediaQueryList;
  floatingSidebarMq: MediaQueryList;
  isMobileSidebarOpen: () => boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  isFloatingSidebarOpen: () => boolean;
  setFloatingSidebarOpen: (open: boolean) => void;
  scheduleAutoApplyPwaUpdate: () => void;
  requestHistory: (target: TargetRef, opts?: { force?: boolean; deltaLimit?: number; prefetchBefore?: boolean }) => void;
  maybeSendMessageRead: (peerId: string, upToId?: number | null) => void;
  scheduleFocusComposer: () => void;
  previewAutoFetchFeature: MainPreviewAutoFetchFeature;
  scheduleHistoryWarmup: () => void;
  maybeAutoFillHistoryViewport: () => void;
  maybeAutoRetryHistory: () => void;
  convoSig: (msgs: any[]) => string;
}

export function installMainRenderSubscriptionFeature(deps: MainRenderSubscriptionFeatureDeps): void {
  const {
    store,
    layout,
    actions,
    renderApp,
    getUserLocalStateHydrationFeature,
    getChatSearchSyncFeature,
    syncNavOverlay,
    getHistoryFeature,
    getVirtualHistoryFeature,
    scheduleChatJumpVisibility,
    onMembersAddModalVisible,
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
  } = deps;

  const initialSelected = store.get().selected;
  let prevAuthed = store.get().authed;
  let prevAutoFetchKey = initialSelected ? conversationKey(initialSelected) : "";
  let prevAutoFetchSig = prevAutoFetchKey ? convoSig(store.get().conversations[prevAutoFetchKey] ?? []) : "";
  let prevAutoFetchTransfersRef = store.get().fileTransfers;
  let localHydrationAttemptedUser = "";
  let localHydrationScheduledUser = "";

  const scheduleLocalStateHydration = (userIdRaw: string): void => {
    const userId = String(userIdRaw || "").trim();
    if (!userId) return;
    if (localHydrationAttemptedUser === userId || localHydrationScheduledUser === userId) return;
    localHydrationScheduledUser = userId;
    const run = () => {
      const scheduledUser = localHydrationScheduledUser;
      localHydrationScheduledUser = "";
      const feature = getUserLocalStateHydrationFeature();
      if (!feature || !scheduledUser) return;
      feature.maybeHydrateLocalState();
      localHydrationAttemptedUser = scheduledUser;
    };
    try {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          if (typeof window.setTimeout === "function") window.setTimeout(run, 0);
          else run();
        });
        return;
      }
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(run, 0);
        return;
      }
    } catch {
      // fall through
    }
    run();
  };

  store.subscribe(() => {
    const st = store.get();
    if (st.authed && st.selfId) {
      scheduleLocalStateHydration(st.selfId);
    } else if (!st.authed) {
      localHydrationAttemptedUser = "";
      localHydrationScheduledUser = "";
    }
    if (getChatSearchSyncFeature()?.maybeSyncChatSearchState()) return;
    renderApp(layout, st, actions);
    syncNavOverlay();
    if (getVirtualHistoryFeature()?.maybeClampStartAtTop(st)) return;
    getHistoryFeature()?.applyPendingAutoScrollAfterRender(st);
    scheduleChatJumpVisibility();
    if (st.modal?.kind === "members_add") {
      onMembersAddModalVisible();
    }
    if (st.modal && st.modal.kind !== "context_menu") {
      closeMobileSidebar();
    }
    if (isMainConversationSurface(st) && !getActiveConversationTarget(st)) {
      if (mobileSidebarMq.matches && !isMobileSidebarOpen()) {
        setMobileSidebarOpen(true);
      } else if (floatingSidebarMq.matches && !isFloatingSidebarOpen()) {
        setFloatingSidebarOpen(true);
      }
    }
    if (st.pwaUpdateAvailable) {
      scheduleAutoApplyPwaUpdate();
    }
    if (st.authed && !prevAuthed) {
      const activeConversation = getActiveConversationTarget(st);
      if (activeConversation) {
        requestHistory(activeConversation, { force: true, deltaLimit: 2000, prefetchBefore: true });
        if (activeConversation.kind === "dm") {
          maybeSendMessageRead(activeConversation.id);
        }
      }
      if (hasActiveConversationSelection(st) && !mobileSidebarMq.matches) {
        scheduleFocusComposer();
      }
    }
    if (st.authed && st.selfId) {
      previewAutoFetchFeature.scheduleWarmupCachedPreviews();
      previewAutoFetchFeature.scheduleAutoFetchVisiblePreviews();
      scheduleHistoryWarmup();
      maybeAutoFillHistoryViewport();
      maybeAutoRetryHistory();
    }
    if (st.authed && st.selfId && hasActiveConversationSelection(st)) {
      getHistoryFeature()?.maybeBootstrapPrefetch(st);
    }
    const selectedKey = getActiveConversationKey(st);
    const selectedSig = selectedKey ? convoSig(st.conversations[selectedKey] ?? []) : "";
    const autoFetchChanged =
      selectedKey !== prevAutoFetchKey ||
      selectedSig !== prevAutoFetchSig ||
      st.fileTransfers !== prevAutoFetchTransfersRef;
    prevAutoFetchKey = selectedKey;
    prevAutoFetchSig = selectedSig;
    prevAutoFetchTransfersRef = st.fileTransfers;
    if (isMainConversationSurface(st) && selectedKey && autoFetchChanged) {
      previewAutoFetchFeature.scheduleAutoFetchVisiblePreviews();
      maybeAutoFillHistoryViewport();
    }
    prevAuthed = st.authed;
  });
}
