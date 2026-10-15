import { conversationKey } from "../../../helpers/chat/conversationKey";
import { messageSelectionKey } from "../../../helpers/chat/chatSelection";
import type { ChatSearchFilter } from "../../../helpers/chat/chatSearch";
import { getActiveConversationKey, getActiveConversationTarget, hasActiveConversationSelection, isMainConversationSurface } from "../../../helpers/navigation/mainConversationState";
import { isRightPanelActiveForSelected } from "../../../helpers/navigation/rightPanelState";
import type { Layout } from "../../../components/layout/types";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, MessageHelperDraft, TargetRef } from "../../../stores/types";
import type { FileViewerFeature, PendingFileViewer } from "../files/fileViewerFeature";
import { createLazyChatSurfaceDeferredRuntime } from "./chatSurfaceDeferredRuntime";
import { createLazyChatSurfaceMediaRuntime } from "./chatSurfaceMediaRuntime";

export interface ChatSurfaceEventsFeatureDeps {
  store: Store<AppState>;
  layout: Pick<Layout, "chat" | "chatSelectionBar">;
  getSuppressChatClickUntil: () => number;
  getSuppressMsgSelectToggleClickUntil: () => number;
  ensureVideoMutedDefault: (video: HTMLVideoElement) => void;
  fileViewer: FileViewerFeature;
  tryOpenFileViewerFromCache: (
    fileId: string,
    meta: {
      name: string;
      size: number;
      mime: string | null;
      caption?: string | null;
      chatKey?: string | null;
      msgIdx?: number | null;
    }
  ) => Promise<boolean>;
  setPendingFileViewer: (next: PendingFileViewer | null) => void;
  enqueueFileGet: (fileId: string, opts?: { priority?: "high" | "prefetch"; silent?: boolean }) => void;
  getChatSelectionAnchorIdx: () => number | null;
  setChatSelectionAnchorIdx: (idx: number | null) => void;
  isChatMessageSelectable: (msg: ChatMessage | null | undefined) => msg is ChatMessage;
  toggleChatSelection: (key: string, msg: ChatMessage) => void;
  addChatSelectionRange: (key: string, fromIdx: number, toIdx: number) => void;
  setChatSelectionRangeValue: (key: string, fromIdx: number, toIdx: number, value: boolean) => void;
  clearChatSelection: () => void;
  closeModal: () => void;
  openUserPage: (uid: string) => void;
  isMobileLikeUi: () => boolean;
  openRightPanel: (target: TargetRef) => void;
  closeRightPanel: () => void;
  openGroupPage: (id: string) => void;
  openBoardPage: (id: string) => void;
  requestMoreHistory: () => void;
  retryHistoryForSelected: () => void;
  pinnedMessagesUiActions: {
    unpinActiveForSelected: () => boolean;
    jumpToActiveForSelected: () => boolean;
    activatePrevForSelected: () => boolean;
    activateNextForSelected: () => boolean;
  };
  openChatSearch: () => void;
  closeChatSearch: () => void;
  stepChatSearch: (dir: 1 | -1) => void;
  setChatSearchDate: (value: string) => void;
  setChatSearchFilter: (filter: ChatSearchFilter) => void;
  toggleChatSearchResults: () => void;
  handleSearchResultClick: (btn: HTMLButtonElement) => boolean;
  jumpToBottom: () => void;
  closeMobileSidebar: () => void;
  authRequestsActions: {
    acceptAuth: (peer: string) => void;
    declineAuth: (peer: string) => void;
    cancelAuth: (peer: string) => void;
  };
  groupBoardJoinActions: {
    acceptGroupInvite: (groupId: string, fromHint?: string) => void;
    declineGroupInvite: (groupId: string, fromHint?: string) => void;
  };
  roomInviteResponsesActions: {
    acceptGroupJoin: (groupId: string, peer: string) => void;
    declineGroupJoin: (groupId: string, peer: string) => void;
    joinBoardFromInvite: (boardId: string) => void;
    declineBoardInvite: (boardId: string) => void;
  };
  send: (payload: any) => void;
  showToast: (message: string, opts?: any) => void;
  fileOffersAccept: (fileId: string) => void;
  beginFileDownload: (fileId: string) => void;
  forwardViewerSelectionActions: {
    handleChatSelectionForward: () => void;
    handleChatSelectionCopy: () => Promise<void>;
    handleChatSelectionDownload: () => Promise<void>;
    handleChatSelectionSendNow: () => void;
    handleChatSelectionDelete: () => void;
    handleChatSelectionPin: () => void;
  };
  coarsePointerMq: MediaQueryList;
  anyFinePointerMq: MediaQueryList;
  buildHelperDraft: (st: AppState, key: string, msg: ChatMessage) => MessageHelperDraft | null;
  scheduleFocusComposer: () => void;
  markUserInput: () => void;
  setChatSearchQuery: (value: string) => void;
  openEmojiPopoverForReaction: (target: { key: string; msgId: number }) => void;
}

export type ChatSurfaceDeferredDeps = ChatSurfaceEventsFeatureDeps & {
  requireConnectedAndAuthed: (st: AppState) => boolean;
};

export interface ChatSurfaceEventsFeature {
  install: () => void;
}

export function createChatSurfaceEventsFeature(deps: ChatSurfaceEventsFeatureDeps): ChatSurfaceEventsFeature {
  const {
    store,
    layout,
    getSuppressChatClickUntil,
    getSuppressMsgSelectToggleClickUntil,
    getChatSelectionAnchorIdx,
    setChatSelectionAnchorIdx,
    isChatMessageSelectable,
    toggleChatSelection,
    addChatSelectionRange,
    setChatSelectionRangeValue,
    clearChatSelection,
    openUserPage,
    isMobileLikeUi,
    openRightPanel,
    closeRightPanel,
    openGroupPage,
    openBoardPage,
    requestMoreHistory,
    retryHistoryForSelected,
    closeMobileSidebar,
    authRequestsActions,
    groupBoardJoinActions,
    roomInviteResponsesActions,
    send,
    showToast,
    fileOffersAccept,
    beginFileDownload,
    closeChatSearch,
    stepChatSearch,
    setChatSearchDate,
    jumpToBottom,
    coarsePointerMq,
    anyFinePointerMq,
    buildHelperDraft,
    scheduleFocusComposer,
    markUserInput,
    setChatSearchQuery,
  } = deps;

  const chatSelectionAnchor = {
    get: getChatSelectionAnchorIdx,
    set: setChatSelectionAnchorIdx,
  };

  const requireConnectedAndAuthed = (st: AppState): boolean => {
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return false;
    }
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return false;
    }
    return true;
  };

  const blockPeerInline = (peer: string): boolean => {
    const id = String(peer || "").trim();
    if (!id) return false;
    const st = store.get();
    if (!requireConnectedAndAuthed(st)) return false;
    send({ type: "block_set", peer: id, value: true });
    showToast(`Заблокировано: ${id}`, { kind: "warn" });
    return true;
  };

  const handleCriticalActionClick = (event: MouseEvent, target: HTMLElement | null): boolean => {
    const actionEl = target?.closest("[data-action]") as HTMLElement | null;
    const action = String(actionEl?.getAttribute("data-action") || "").trim();
    if (!actionEl || !action) return false;

    const stop = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const attr = (name: string) => String(actionEl.getAttribute(name) || "").trim();

    if (action === "auth-accept" || action === "auth-decline" || action === "auth-cancel") {
      const peer = attr("data-peer");
      if (!peer) return false;
      stop();
      closeMobileSidebar();
      if (action === "auth-accept") authRequestsActions.acceptAuth(peer);
      else if (action === "auth-decline") authRequestsActions.declineAuth(peer);
      else authRequestsActions.cancelAuth(peer);
      return true;
    }

    if (action === "group-invite-accept" || action === "group-invite-decline" || action === "group-invite-block") {
      const groupId = attr("data-group-id");
      if (!groupId) return false;
      const fromAttr = attr("data-from");
      const from = fromAttr || String(store.get().pendingGroupInvites.find((x) => x.groupId === groupId)?.from || "").trim();
      stop();
      closeMobileSidebar();
      if (action === "group-invite-accept") groupBoardJoinActions.acceptGroupInvite(groupId, from);
      else {
        if (action === "group-invite-block" && from) blockPeerInline(from);
        groupBoardJoinActions.declineGroupInvite(groupId, from);
      }
      return true;
    }

    if (action === "group-join-accept" || action === "group-join-decline") {
      const groupId = attr("data-group-id");
      const peer = attr("data-peer");
      if (!groupId || !peer) return false;
      stop();
      closeMobileSidebar();
      if (action === "group-join-accept") roomInviteResponsesActions.acceptGroupJoin(groupId, peer);
      else roomInviteResponsesActions.declineGroupJoin(groupId, peer);
      return true;
    }

    if (action === "board-invite-accept" || action === "board-invite-decline" || action === "board-invite-block") {
      const boardId = attr("data-board-id");
      if (!boardId) return false;
      const fromAttr = attr("data-from");
      const from = fromAttr || String(store.get().pendingBoardInvites.find((x) => x.boardId === boardId)?.from || "").trim();
      stop();
      closeMobileSidebar();
      if (action === "board-invite-accept") roomInviteResponsesActions.joinBoardFromInvite(boardId);
      else {
        if (action === "board-invite-block" && from) blockPeerInline(from);
        roomInviteResponsesActions.declineBoardInvite(boardId);
      }
      return true;
    }

    if (action === "file-accept" || action === "file-download") {
      const fileId = attr("data-file-id");
      if (!fileId) return false;
      stop();
      closeMobileSidebar();
      if (action === "file-accept") fileOffersAccept(fileId);
      else beginFileDownload(fileId);
      return true;
    }

    return false;
  };

  const deferredRuntime = createLazyChatSurfaceDeferredRuntime({
    ...deps,
    requireConnectedAndAuthed,
  });
  const mediaRuntime = createLazyChatSurfaceMediaRuntime({
    ...deps,
    requireConnectedAndAuthed,
  });

  const install = () => {
    layout.chat.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;

      if (Date.now() < getSuppressChatClickUntil()) {
        const row = target?.closest("[data-msg-idx]");
        if (row) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (mediaRuntime.maybeHandleChatClick(e, target)) return;

      const msgSelectBtn = target?.closest("button[data-action='msg-select-toggle']") as HTMLButtonElement | null;
      if (msgSelectBtn) {
        if (Date.now() < getSuppressMsgSelectToggleClickUntil()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const st = store.get();
        const key = getActiveConversationKey(st);
        if (!key) return;
        const idxRaw = String(msgSelectBtn.getAttribute("data-msg-idx") || "").trim();
        const idx = Number.isFinite(Number(idxRaw)) ? Math.trunc(Number(idxRaw)) : -1;
        const conv = key ? st.conversations[key] : null;
        const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
        if (!msg) return;
        if (!isChatMessageSelectable(msg)) return;
        e.preventDefault();
        e.stopPropagation();
        const groupStartRaw = String(msgSelectBtn.getAttribute("data-msg-group-start") || "").trim();
        const groupEndRaw = String(msgSelectBtn.getAttribute("data-msg-group-end") || "").trim();
        if (groupStartRaw && groupEndRaw && conv) {
          const start = Number.isFinite(Number(groupStartRaw)) ? Math.trunc(Number(groupStartRaw)) : -1;
          const end = Number.isFinite(Number(groupEndRaw)) ? Math.trunc(Number(groupEndRaw)) : -1;
          if (start >= 0 && end >= 0) {
            const selection = st.chatSelection;
            const idSet = new Set(selection && selection.key === key ? selection.ids || [] : []);
            let selectedCount = 0;
            let selectableCount = 0;
            const boundedEnd = Math.min(Math.max(start, end), conv.length - 1);
            for (let i = Math.min(start, end); i <= boundedEnd; i += 1) {
              const m = conv[i];
              if (!isChatMessageSelectable(m)) continue;
              const selId = messageSelectionKey(m);
              if (!selId) continue;
              selectableCount += 1;
              if (idSet.has(selId)) selectedCount += 1;
            }
            const shouldSelectAll = selectedCount < selectableCount;
            setChatSelectionRangeValue(key, start, end, shouldSelectAll);
            chatSelectionAnchor.set(idx);
            return;
          }
        }
        const shift = "shiftKey" in e ? Boolean((e as MouseEvent).shiftKey) : false;
        const anchor = chatSelectionAnchor.get();
        if (shift && anchor !== null) addChatSelectionRange(key, anchor, idx);
        else toggleChatSelection(key, msg);
        chatSelectionAnchor.set(idx);
        return;
      }

      const stForSelection = store.get();
      const selectionKey = getActiveConversationKey(stForSelection);
      const selectionActive =
        Boolean(selectionKey) &&
        Boolean(stForSelection.chatSelection && stForSelection.chatSelection.key === selectionKey) &&
        Boolean(stForSelection.chatSelection?.ids?.length);
      if (selectionActive) {
        if (target?.closest("button, a, input, textarea, select, audio, video, [contenteditable='true']")) return;
        const row = target?.closest("[data-msg-idx]") as HTMLElement | null;
        if (row) {
          const idx = Math.trunc(Number(row.getAttribute("data-msg-idx") || ""));
          const conv = selectionKey ? stForSelection.conversations[selectionKey] : null;
          const groupStartRaw = String(row.getAttribute("data-msg-group-start") || "").trim();
          const groupEndRaw = String(row.getAttribute("data-msg-group-end") || "").trim();
          if (groupStartRaw && groupEndRaw && conv) {
            const start = Number.isFinite(Number(groupStartRaw)) ? Math.trunc(Number(groupStartRaw)) : -1;
            const end = Number.isFinite(Number(groupEndRaw)) ? Math.trunc(Number(groupEndRaw)) : -1;
            if (start >= 0 && end >= 0) {
              e.preventDefault();
              e.stopPropagation();
              const selection = stForSelection.chatSelection;
              const idSet = new Set(selection && selection.key === selectionKey ? selection.ids || [] : []);
              let selectedCount = 0;
              let selectableCount = 0;
              const boundedEnd = Math.min(Math.max(start, end), conv.length - 1);
              for (let i = Math.min(start, end); i <= boundedEnd; i += 1) {
                const m = conv[i];
                if (!isChatMessageSelectable(m)) continue;
                const selId = messageSelectionKey(m);
                if (!selId) continue;
                selectableCount += 1;
                if (idSet.has(selId)) selectedCount += 1;
              }
              const shouldSelectAll = selectedCount < selectableCount;
              setChatSelectionRangeValue(selectionKey, start, end, shouldSelectAll);
              chatSelectionAnchor.set(idx);
              return;
            }
          }
          const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
          if (msg) {
            e.preventDefault();
            e.stopPropagation();
            const shift = "shiftKey" in e ? Boolean((e as MouseEvent).shiftKey) : false;
            const anchor = chatSelectionAnchor.get();
            if (shift && anchor !== null) addChatSelectionRange(selectionKey, anchor, idx);
            else toggleChatSelection(selectionKey, msg);
            chatSelectionAnchor.set(idx);
            return;
          }
        }
      }

      const userBtn = target?.closest("[data-action='user-open']") as HTMLElement | null;
      if (userBtn) {
        const uid = String(userBtn.getAttribute("data-user-id") || "").trim();
        if (uid) {
          e.preventDefault();
          openUserPage(uid);
        }
        return;
      }

      const chatProfileBtn = target?.closest("button[data-action='chat-profile-open']") as HTMLButtonElement | null;
      if (chatProfileBtn) {
        const st = store.get();
        const activeConversation = getActiveConversationTarget(st);
        if (!activeConversation) return;
        e.preventDefault();
        const mobileUi = isMobileLikeUi();
        if (!mobileUi && isMainConversationSurface(st)) {
          const active = isRightPanelActiveForSelected(st);
          if (active) closeRightPanel();
          else openRightPanel(activeConversation);
        } else if (activeConversation.kind === "dm") {
          openUserPage(activeConversation.id);
        } else if (activeConversation.kind === "group") {
          openGroupPage(activeConversation.id);
        } else if (activeConversation.kind === "board") {
          openBoardPage(activeConversation.id);
        }
        return;
      }

      const historyMoreBtn = target?.closest("button[data-action='chat-history-more']") as HTMLButtonElement | null;
      if (historyMoreBtn) {
        e.preventDefault();
        requestMoreHistory();
        return;
      }

      const historyRetryBtn = target?.closest("button[data-action='chat-history-retry']") as HTMLButtonElement | null;
      if (historyRetryBtn) {
        e.preventDefault();
        retryHistoryForSelected();
        return;
      }

      const selectionCancelBtn = target?.closest("button[data-action='chat-selection-cancel']") as HTMLButtonElement | null;
      if (selectionCancelBtn) {
        e.preventDefault();
        clearChatSelection();
        return;
      }

      if (handleCriticalActionClick(e, target)) return;
      if (deferredRuntime.maybeHandleChatClick(e, target)) return;

      const jumpBtn = target?.closest("button[data-action='chat-jump-bottom']") as HTMLButtonElement | null;
      if (jumpBtn) {
        e.preventDefault();
        jumpToBottom();
        return;
      }
    });

    layout.chatSelectionBar.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest("button[data-action^='chat-selection-']") as HTMLButtonElement | null;
      if (!btn || btn.hasAttribute("disabled")) return;
      const action = String(btn.getAttribute("data-action") || "");
      if (!action) return;
      if (action === "chat-selection-cancel") {
        e.preventDefault();
        clearChatSelection();
        return;
      }
      if (deferredRuntime.maybeHandleSelectionBarClick(e, target)) return;
    });

    layout.chat.addEventListener("dblclick", (e) => {
      const st = store.get();
      if (coarsePointerMq.matches && !anyFinePointerMq.matches) return;
      if (st.editing) return;
      if (Date.now() < getSuppressChatClickUntil()) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("button, a, input, textarea, [contenteditable='true']")) return;
      const row = target.closest("[data-msg-idx]") as HTMLElement | null;
      if (!row) return;
      const idx = Math.trunc(Number(row.getAttribute("data-msg-idx") || ""));
      const key = getActiveConversationKey(st);
      if (!key || !Number.isFinite(idx) || idx < 0) return;
      const conv = st.conversations[key] || null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const draft = msg ? buildHelperDraft(st, key, msg) : null;
      if (!draft) return;
      e.preventDefault();
      store.set({ replyDraft: draft, forwardDraft: null });
      scheduleFocusComposer();
    });

    layout.chat.addEventListener("input", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t instanceof HTMLInputElement)) return;
      if (t.id === "chat-search-input") {
        markUserInput();
        setChatSearchQuery(t.value);
        return;
      }
      if (t.id === "chat-search-date") {
        markUserInput();
        setChatSearchDate(t.value);
      }
    });

    layout.chat.addEventListener("change", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t instanceof HTMLInputElement)) return;
      if (t.id !== "chat-search-date") return;
      markUserInput();
      setChatSearchDate(t.value);
    });

    layout.chat.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t instanceof HTMLInputElement)) return;
      if (t.id !== "chat-search-input") return;
      if (e.key === "Enter") {
        e.preventDefault();
        stepChatSearch(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeChatSearch();
      }
    });
  };

  return { install };
}
