import { el } from "../../helpers/dom/el";
import { conversationKey } from "../../helpers/chat/conversationKey";
import { getConversationHistorySyncState } from "../../helpers/chat/historySync";
import { markHistoryViewportCompensation } from "../../helpers/chat/historyViewportCoordinator";
import { type ChatShiftAnchor, type UnreadDividerAnchor, captureChatShiftAnchor, findChatShiftAnchorElement } from "../../helpers/chat/historyViewportAnchors";
import {
  captureAndStoreChatShiftAnchor,
  clearChatPendingBottomStick,
  disconnectChatHistoryViewportObserver,
  getChatHistoryViewportRuntime,
  isChatPendingBottomStickActive,
  markChatPendingBottomStick,
} from "../../helpers/chat/historyViewportRuntime";
import { messageSelectionKey } from "../../helpers/chat/chatSelection";
import { isPinnedMessage } from "../../helpers/chat/pinnedMessages";
import type { AppState, ChatMessage, ChatMessageRef, FileOfferIn, FileTransferEntry } from "../../stores/types";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { fileBadge } from "../../helpers/files/fileBadge";
import { safeUrl } from "../../helpers/security/safeUrl";
import { renderRichText } from "../../helpers/chat/richText";
import type { Layout } from "../layout/types";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { getCachedMediaAspectRatio } from "../../helpers/chat/mediaAspectCache";
import {
  HISTORY_VIRTUAL_THRESHOLD,
  HISTORY_VIRTUAL_WINDOW,
  clampVirtualAvg,
  getVirtualEnd,
  getVirtualMaxStart,
  getVirtualStart,
  shouldVirtualize,
} from "../../helpers/chat/virtualHistory";
import { CHAT_SEARCH_FILTERS } from "../../helpers/chat/chatSearch";
import { createChatStickyBottomState, isChatStickyBottomActive } from "../../helpers/chat/stickyBottom";
import { getConversationViewportTarget } from "../../helpers/navigation/mainConversationState";
import { isRightPanelActiveForSelected } from "../../helpers/navigation/rightPanelState";
import { resolveUnreadDivider } from "./historyLayoutModel";
import { buildHistoryRenderSurface } from "./historyRenderSurface";
import { clearDeferredPinnedSurface, renderPinnedDeferred, renderSearchAuxDeferred } from "./chatAuxRuntime";
import { keepActiveControlVisible } from "../../helpers/ui/keepActiveControlVisible";
import { renderChatSearchBarSurface, renderChatSelectionBarSurface } from "./chatTopSurface";

import {
  EMPTY_CHAT,
  EMPTY_HITS,
  chatTitleNodes,
  formatUserLabel,
} from "./renderChatHelpers";

function transferProgressTickOnly(prev: AppState["fileTransfers"], next: AppState["fileTransfers"]): boolean {
  if (!Array.isArray(prev) || !Array.isArray(next)) return false;
  if (prev.length !== next.length) return false;
  const prevByLocalId = new Map<string, FileTransferEntry>();
  for (const entry of prev) {
    const lid = String(entry?.localId || "").trim();
    if (!lid) return false;
    if (prevByLocalId.has(lid)) return false;
    prevByLocalId.set(lid, entry);
  }
  const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const arrEq = (a?: string[] | null, b?: string[] | null): boolean => {
    if (a === b) return true;
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i += 1) {
      if (String(aa[i]) !== String(bb[i])) return false;
    }
    return true;
  };
  for (const entry of next) {
    const lid = String(entry?.localId || "").trim();
    if (!lid) return false;
    const prevEntry = prevByLocalId.get(lid);
    if (!prevEntry) return false;
    if (norm(prevEntry.id) !== norm(entry.id)) return false;
    if (String(prevEntry.name) !== String(entry.name)) return false;
    if (Number(prevEntry.size || 0) !== Number(entry.size || 0)) return false;
    if (String(prevEntry.direction) !== String(entry.direction)) return false;
    if (String(prevEntry.peer) !== String(entry.peer)) return false;
    if (norm(prevEntry.room) !== norm(entry.room)) return false;
    if (String(prevEntry.status) !== String(entry.status)) return false;
    if (norm(prevEntry.error) !== norm(entry.error)) return false;
    if (norm(prevEntry.url) !== norm(entry.url)) return false;
    if (norm(prevEntry.mime) !== norm(entry.mime)) return false;
    if (!arrEq(prevEntry.acceptedBy, entry.acceptedBy)) return false;
    if (!arrEq(prevEntry.receivedBy, entry.receivedBy)) return false;
    const prevProgress = Math.round(Number(prevEntry.progress || 0));
    const nextProgress = Math.round(Number(entry.progress || 0));
    if (prevProgress !== nextProgress && entry.status !== "uploading" && entry.status !== "downloading") return false;
  }
  return true;
}

function patchChatTransferProgress(scrollHost: HTMLElement, transfers: AppState["fileTransfers"]): void {
  if (!Array.isArray(transfers) || transfers.length === 0) return;
  const byLocalId = new Map<string, FileTransferEntry>();
  const byFileId = new Map<string, FileTransferEntry>();
  for (const t of transfers) {
    const lid = String(t?.localId || "").trim();
    if (lid) byLocalId.set(lid, t);
    const fid = String(t?.id || "").trim();
    if (fid) byFileId.set(fid, t);
  }
  const updateProgressbar = (node: HTMLElement, transfer: FileTransferEntry) => {
    const pct = Math.max(0, Math.min(100, Math.round(transfer.progress || 0)));
    const label = transfer.status === "uploading" ? `Загрузка ${pct}%` : transfer.status === "downloading" ? `Скачивание ${pct}%` : `${pct}%`;
    try {
      node.setAttribute("aria-valuenow", String(pct));
      node.setAttribute("title", label);
      node.setAttribute("aria-label", label);
    } catch {
      // ignore
    }
    const candy = node.querySelector(".file-progress-candy") as HTMLElement | null;
    if (candy) {
      try {
        candy.style.setProperty("--file-progress", `${pct}%`);
      } catch {
        // ignore
      }
    }
    const stateLabel = node.parentElement?.querySelector?.(".chat-media-state") as HTMLElement | null;
    if (stateLabel) stateLabel.textContent = label;
  };
  const nodes = scrollHost.querySelectorAll("button.chat-file-preview[data-local-id], button.chat-file-preview[data-file-id]");
  for (const node of Array.from(nodes)) {
    if (!(node instanceof HTMLButtonElement)) continue;
    const localId = String(node.getAttribute("data-local-id") || "").trim();
    const fileId = String(node.getAttribute("data-file-id") || "").trim();
    const transfer = localId ? byLocalId.get(localId) : fileId ? byFileId.get(fileId) : null;
    if (!transfer) continue;
    if (transfer.status !== "uploading" && transfer.status !== "downloading") continue;
    const media = node.querySelector(".chat-media-progress") as HTMLElement | null;
    if (media) updateProgressbar(media, transfer);
    const row = node.closest(".file-row") as HTMLElement | null;
    if (row) {
      const bar = row.querySelector(".file-progress") as HTMLElement | null;
      if (bar) updateProgressbar(bar, transfer);
    }
  }
}

function chatTailIdentity(msg: ChatMessage | null | undefined): string {
  if (!msg) return "";
  const id = Number(msg.id ?? 0);
  const serverId = Number.isFinite(id) && id > 0 ? `id:${Math.trunc(id)}` : "";
  const localId = typeof msg.localId === "string" && msg.localId.trim() ? `local:${msg.localId.trim()}` : "";
  const stableId = serverId || localId;
  if (stableId) return `${msg.kind}:${stableId}`;
  const from = String(msg.from || "");
  const target = String(msg.room || msg.to || "");
  const textSize = String(msg.text || "").length;
  const ts = Number(msg.ts ?? 0);
  return `${msg.kind}:${from}:${target}:${Number.isFinite(ts) ? ts : 0}:${textSize}`;
}

export function renderChat(layout: Layout, state: AppState) {
  const activeConversation = getConversationViewportTarget(state);
  const mobileUi = isMobileLikeUi();
  const boardUi = Boolean(activeConversation && activeConversation.kind === "board");
  const scrollHost = layout.chatHost;
  const hostState = scrollHost as any;
  const albumLayout = (() => {
    const fallbackMaxWidth = mobileUi ? 340 : 420;
    const fallbackSpacing = 1;
    const parseCssPx = (raw: string, fallback: number): number => {
      const v = String(raw || "").trim().toLowerCase();
      if (!v) return fallback;
      const n = Number(v.endsWith("px") ? v.slice(0, -2) : v);
      if (!Number.isFinite(n) || n <= 0) return fallback;
      return Math.round(n);
    };
    try {
      const st = getComputedStyle(layout.chat);
      const maxWidth = parseCssPx(st.getPropertyValue("--chat-album-frame-max"), fallbackMaxWidth);
      const spacing = parseCssPx(st.getPropertyValue("--chat-album-gap"), fallbackSpacing);
      return { maxWidth, minWidth: 100, spacing };
    } catch {
      return { maxWidth: fallbackMaxWidth, minWidth: 100, spacing: fallbackSpacing };
    }
  })();
  const key = activeConversation ? conversationKey(activeConversation) : "";
  const selectionState = state.chatSelection && state.chatSelection.key === key ? state.chatSelection : null;
  const selectionSet =
    selectionState && Array.isArray(selectionState.ids) && selectionState.ids.length ? new Set(selectionState.ids) : null;
  const selectionCount = selectionSet ? selectionSet.size : 0;
  const maxScrollTop = () => Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
  const selectedKindClass = activeConversation ? activeConversation.kind : null;
  layout.chat.classList.toggle("chat-board", selectedKindClass === "board");
  layout.chat.classList.toggle("chat-dm", selectedKindClass === "dm");
  layout.chat.classList.toggle("chat-group", selectedKindClass === "group");
  const prevKey = String(scrollHost.getAttribute("data-chat-key") || "");
  const keyChanged = key !== prevKey;
  const prevScrollTop = scrollHost.scrollTop;
  const atBottomBefore = scrollHost.scrollTop >= maxScrollTop() - 24;
  const viewportRuntime = getChatHistoryViewportRuntime(scrollHost);
  const viewerReturnAnchor =
    key && !keyChanged && viewportRuntime.viewerReturnAnchor?.key === key ? viewportRuntime.viewerReturnAnchor : null;
  const sticky = viewportRuntime.stickyBottom;
  const stickyActive = isChatStickyBottomActive(scrollHost, sticky, key);
  const pendingBottomStickActive = isChatPendingBottomStickActive(scrollHost, key);
  const cachedMessages = key ? (state.conversations?.[key] ?? EMPTY_CHAT) : EMPTY_CHAT;
  const historySync = key ? getConversationHistorySyncState(state, key) : null;
  const allowSticky = Boolean(key && ((historySync && historySync.loaded) || cachedMessages.length));
  const prevTailKey = String(hostState.__chatTailKey || "");
  const prevTailSig = String(hostState.__chatTailSig || "");
  const prevTailCount = Math.max(0, Math.trunc(Number(hostState.__chatTailCount || 0) || 0));
  const tailSig = chatTailIdentity(cachedMessages.length ? cachedMessages[cachedMessages.length - 1] : null);
  const tailMessageAppended = Boolean(
    key &&
      !keyChanged &&
      allowSticky &&
      prevTailKey === key &&
      prevTailSig &&
      tailSig &&
      tailSig !== prevTailSig &&
      cachedMessages.length >= prevTailCount &&
      !state.chatSearchOpen &&
      (!state.modal || state.modal.kind === "context_menu")
  );
  if (tailMessageAppended) markChatPendingBottomStick(scrollHost, key, Date.now(), 2500);
  // Keep pinned-bottom stable during re-renders/content growth, including the first render after a sent-message autoscroll mark.
  const shouldStick = Boolean(
    key && !keyChanged && !viewerReturnAnchor && allowSticky && (stickyActive || atBottomBefore || pendingBottomStickActive || tailMessageAppended)
  );
  const preShiftAnchor = viewerReturnAnchor ?? (key && !keyChanged && !shouldStick ? captureChatShiftAnchor(scrollHost, key) : null);
  if (keyChanged && viewportRuntime.stickyBottom) viewportRuntime.stickyBottom = null;
  if (keyChanged && viewportRuntime.shiftAnchor) viewportRuntime.shiftAnchor = null;
  if (keyChanged && viewportRuntime.viewerReturnAnchor) viewportRuntime.viewerReturnAnchor = null;
  else if (key) {
    if (shouldStick) viewportRuntime.stickyBottom = createChatStickyBottomState(scrollHost, key, true);
    else if (viewportRuntime.stickyBottom && viewportRuntime.stickyBottom.key === key) {
      viewportRuntime.stickyBottom = createChatStickyBottomState(scrollHost, key, false);
    }
  }
  scrollHost.setAttribute("data-chat-key", key);
  if (!key && viewportRuntime.linesObserver) disconnectChatHistoryViewportObserver(scrollHost);

  // No selected chat: keep the main area empty (mobile starts from the sidebar tabs).
  if (!key) {
    layout.chatTop.replaceChildren();
    scrollHost.replaceChildren();
    layout.chatJump.classList.add("hidden");
    layout.chatSearchResults.classList.add("hidden");
    layout.chatSearchResults.replaceChildren();
    layout.chatSearchFooter.classList.add("hidden");
    layout.chatSearchFooter.replaceChildren();
    layout.chatSelectionBar.classList.add("hidden");
    layout.chatSelectionBar.replaceChildren();
    return;
  }

  const friendLabels = new Map<string, string>();
  for (const f of state.friends || []) {
    friendLabels.set(String(f.id), formatUserLabel(f.display_name || "", f.handle || "", String(f.id || "")));
  }

  const msgs = cachedMessages;
  const historyLoaded = Boolean(historySync?.loaded);
  const historyEmptyNotice = historySync?.emptyNotice ?? null;
  const historyLoading = Boolean(historySync?.loading);
  const historyCursor = Number(historySync?.cursor ?? NaN);
  const rawHasMore = historySync?.hasMore ?? undefined;
  const hasMore = Boolean(key && (rawHasMore ?? (historyLoaded && Number.isFinite(historyCursor) && historyCursor > 0)));
  const loadingMore = Boolean(historyLoading && historyLoaded);
  const loadingInitial = Boolean(historyLoading && !historyLoaded);
  const historyLoadingSlots = Math.max(0, Math.trunc(Number(historySync?.loadingSlots ?? 0) || 0));
  const searchActive = Boolean(state.chatSearchOpen && state.chatSearchQuery.trim());
  const hits = searchActive ? state.chatSearchHits || EMPTY_HITS : EMPTY_HITS;
  const hitSet = searchActive && hits.length ? new Set(hits) : null;
  const activePos = searchActive ? Math.max(0, Math.min(hits.length ? hits.length - 1 : 0, state.chatSearchPos | 0)) : 0;
  const activeMsgIdx = searchActive && hits.length ? hits[activePos] : null;
  const searchResultsOpen = Boolean(searchActive && state.chatSearchResultsOpen);
  const contextMenuMessageIdx =
    state.modal?.kind === "context_menu" && state.modal.payload.target.kind === "message" && key
      ? String(state.modal.payload.target.id || "").trim()
      : "";
  const prevRender = hostState.__chatRenderState as
    | {
        key: string;
        selectedKind: string;
        selectedId: string;
        page: string;
        msgsRef: ChatMessage[];
        historyLoaded: boolean;
        historyEmptyNoticeRef: typeof historyEmptyNotice;
        historyLoading: boolean;
        historyHasMore: boolean;
        historyLoadingSlots: number;
        historyVirtualStart: number | null;
        searchOpen: boolean;
        searchQuery: string;
        searchResultsOpen: boolean;
        searchPos: number;
        searchHitsRef: number[] | null;
        selectionRef: AppState["chatSelection"] | null;
        pinnedIdsRef: number[] | null;
        pinnedActive: number | null;
        lastRead: { id?: number; ts?: number } | null;
        avatarsRev: number;
        profilesRef: AppState["profiles"];
        groupsRef: AppState["groups"];
        boardsRef: AppState["boards"];
        rightPanelRef: AppState["rightPanel"];
        fileTransfersRef: AppState["fileTransfers"];
        fileThumbsRef: AppState["fileThumbs"];
        messageView: AppState["messageView"];
        searchFilter: AppState["chatSearchFilter"];
        searchDate: AppState["chatSearchDate"];
        contextMenuMessageIdx: string;
      }
    | null;
  const pinnedIds = key && state.pinnedMessages ? state.pinnedMessages[key] : null;
  const activeRaw = key && state.pinnedMessageActive ? state.pinnedMessageActive[key] : null;
  const selectedKind = activeConversation?.kind ? String(activeConversation.kind) : "";
  const selectedId = activeConversation?.id ? String(activeConversation.id) : "";
  const historyVirtualStartMap = state.historyVirtualStart || {};
  const hasHistoryVirtualStart = Boolean(key && Object.prototype.hasOwnProperty.call(historyVirtualStartMap, key));
  const rawHistoryVirtualStart = hasHistoryVirtualStart ? historyVirtualStartMap[key] : null;
  const historyVirtualStart =
    typeof rawHistoryVirtualStart === "number" && Number.isFinite(rawHistoryVirtualStart)
      ? Math.max(0, Math.trunc(rawHistoryVirtualStart))
      : null;
  const lastRead = key && state.lastRead ? state.lastRead[key] ?? null : null;
  const selectionRef = selectionState;
  const renderState = {
    key,
    selectedKind,
    selectedId,
    page: state.page,
    msgsRef: msgs,
    historyLoaded,
    historyEmptyNoticeRef: historyEmptyNotice,
    historyLoading,
    historyHasMore: hasMore,
    historyLoadingSlots,
    historyVirtualStart,
    searchOpen: Boolean(state.chatSearchOpen),
    searchQuery: String(state.chatSearchQuery || ""),
    searchResultsOpen,
    searchPos: state.chatSearchPos | 0,
    searchHitsRef: hits,
    selectionRef,
    pinnedIdsRef: pinnedIds,
    pinnedActive: typeof activeRaw === "number" ? activeRaw : null,
    lastRead,
    avatarsRev: Math.max(0, Math.trunc(Number((state as any).avatarsRev || 0) || 0)),
    profilesRef: state.profiles,
    groupsRef: state.groups,
    boardsRef: state.boards,
    rightPanelRef: state.rightPanel,
    fileTransfersRef: state.fileTransfers,
    fileThumbsRef: state.fileThumbs,
    messageView: state.messageView,
    searchFilter: state.chatSearchFilter,
    searchDate: state.chatSearchDate,
    contextMenuMessageIdx,
  };
  const canSkipRenderExceptTransfers =
    prevRender &&
    prevRender.key === renderState.key &&
    prevRender.selectedKind === renderState.selectedKind &&
    prevRender.selectedId === renderState.selectedId &&
    prevRender.page === renderState.page &&
    prevRender.msgsRef === renderState.msgsRef &&
    prevRender.historyLoaded === renderState.historyLoaded &&
    prevRender.historyEmptyNoticeRef === renderState.historyEmptyNoticeRef &&
    prevRender.historyLoading === renderState.historyLoading &&
    prevRender.historyHasMore === renderState.historyHasMore &&
    prevRender.historyLoadingSlots === renderState.historyLoadingSlots &&
    prevRender.historyVirtualStart === renderState.historyVirtualStart &&
    prevRender.searchOpen === renderState.searchOpen &&
    prevRender.searchQuery === renderState.searchQuery &&
    prevRender.searchResultsOpen === renderState.searchResultsOpen &&
    prevRender.searchPos === renderState.searchPos &&
    prevRender.searchHitsRef === renderState.searchHitsRef &&
    prevRender.selectionRef === renderState.selectionRef &&
    prevRender.pinnedIdsRef === renderState.pinnedIdsRef &&
    prevRender.pinnedActive === renderState.pinnedActive &&
    prevRender.lastRead === renderState.lastRead &&
    prevRender.avatarsRev === renderState.avatarsRev &&
    prevRender.profilesRef === renderState.profilesRef &&
    prevRender.groupsRef === renderState.groupsRef &&
    prevRender.boardsRef === renderState.boardsRef &&
    prevRender.rightPanelRef === renderState.rightPanelRef &&
    prevRender.fileThumbsRef === renderState.fileThumbsRef &&
    prevRender.messageView === renderState.messageView &&
    prevRender.searchFilter === renderState.searchFilter &&
    prevRender.searchDate === renderState.searchDate &&
    prevRender.contextMenuMessageIdx === renderState.contextMenuMessageIdx;
  const canSkipRender =
    prevRender &&
    prevRender.key === renderState.key &&
    prevRender.selectedKind === renderState.selectedKind &&
    prevRender.selectedId === renderState.selectedId &&
    prevRender.page === renderState.page &&
    prevRender.msgsRef === renderState.msgsRef &&
    prevRender.historyLoaded === renderState.historyLoaded &&
    prevRender.historyEmptyNoticeRef === renderState.historyEmptyNoticeRef &&
    prevRender.historyLoading === renderState.historyLoading &&
    prevRender.historyHasMore === renderState.historyHasMore &&
    prevRender.historyLoadingSlots === renderState.historyLoadingSlots &&
    prevRender.historyVirtualStart === renderState.historyVirtualStart &&
    prevRender.searchOpen === renderState.searchOpen &&
    prevRender.searchQuery === renderState.searchQuery &&
    prevRender.searchResultsOpen === renderState.searchResultsOpen &&
    prevRender.searchPos === renderState.searchPos &&
    prevRender.searchHitsRef === renderState.searchHitsRef &&
    prevRender.selectionRef === renderState.selectionRef &&
    prevRender.pinnedIdsRef === renderState.pinnedIdsRef &&
    prevRender.pinnedActive === renderState.pinnedActive &&
    prevRender.lastRead === renderState.lastRead &&
    prevRender.avatarsRev === renderState.avatarsRev &&
    prevRender.profilesRef === renderState.profilesRef &&
    prevRender.groupsRef === renderState.groupsRef &&
    prevRender.boardsRef === renderState.boardsRef &&
    prevRender.rightPanelRef === renderState.rightPanelRef &&
    prevRender.fileTransfersRef === renderState.fileTransfersRef &&
    prevRender.fileThumbsRef === renderState.fileThumbsRef &&
    prevRender.messageView === renderState.messageView &&
    prevRender.searchFilter === renderState.searchFilter &&
    prevRender.searchDate === renderState.searchDate &&
    prevRender.contextMenuMessageIdx === renderState.contextMenuMessageIdx;
  if (
    !viewerReturnAnchor &&
    canSkipRenderExceptTransfers &&
    prevRender.fileTransfersRef !== renderState.fileTransfersRef &&
    transferProgressTickOnly(prevRender.fileTransfersRef, renderState.fileTransfersRef)
  ) {
    hostState.__chatRenderState = renderState;
    patchChatTransferProgress(scrollHost, renderState.fileTransfersRef);
    return;
  }
  if (canSkipRender && !viewerReturnAnchor) return;
  hostState.__chatRenderState = renderState;
  const mobileLikeUi = isMobileLikeUi();
  const memoryGb = (() => {
    try {
      const raw = Number((navigator as any)?.deviceMemory ?? 0);
      return Number.isFinite(raw) && raw > 0 ? raw : 4;
    } catch {
      return 4;
    }
  })();
  const connection = (() => {
    try {
      return (navigator as any)?.connection ?? null;
    } catch {
      return null;
    }
  })();
  const saveData = Boolean(connection && (connection as any).saveData);
  const effectiveType = String((connection as any)?.effectiveType || "").toLowerCase();
  const slowNetwork = saveData || effectiveType.includes("2g") || effectiveType.includes("3g");
  const constrained = mobileLikeUi || memoryGb <= 4 || slowNetwork;
  const virtualThreshold = slowNetwork ? 200 : constrained ? 240 : HISTORY_VIRTUAL_THRESHOLD;
  const virtualWindow = slowNetwork ? 160 : constrained ? 200 : HISTORY_VIRTUAL_WINDOW;
  const virtualEnabled = Boolean(key && shouldVirtualize(msgs.length, searchActive, virtualThreshold));
  const virtualAvgMap = viewportRuntime.virtualAvgHeights;
  const avgHeight = clampVirtualAvg(key ? virtualAvgMap.get(key) : null);
  const maxVirtualStart = getVirtualMaxStart(msgs.length, virtualWindow);
  const preferredStart = virtualEnabled && shouldStick ? maxVirtualStart : historyVirtualStart;
  const virtualStart = virtualEnabled ? getVirtualStart(msgs.length, preferredStart, virtualWindow) : 0;
  const virtualEnd = virtualEnabled ? getVirtualEnd(msgs.length, virtualStart, virtualWindow) : msgs.length;
  const topSpacerHeight = virtualEnabled ? Math.max(0, virtualStart) * avgHeight : 0;
  const bottomSpacerHeight = virtualEnabled ? Math.max(0, msgs.length - virtualEnd) * avgHeight : 0;
  const lines: HTMLElement[] = [];
  const unreadMap = viewportRuntime.unreadAnchors;
  if (keyChanged && key) {
    unreadMap.delete(key);
    viewportRuntime.unreadClearArmed.delete(key);
  }

  const suppressActiveUnread = Boolean(activeConversation && key === conversationKey(activeConversation));
  if (suppressActiveUnread && key) {
    unreadMap.delete(key);
    viewportRuntime.unreadClearArmed.delete(key);
  }
  const unreadResolved = suppressActiveUnread
    ? { unreadIdx: -1, unreadCount: 0, unreadInsertIdx: -1, anchor: null }
    : resolveUnreadDivider({
        key,
        msgs,
        searchActive,
        selected: activeConversation,
        friends: state.friends,
        lastRead: state.lastRead,
        savedAnchor: key ? unreadMap.get(key) ?? null : null,
        virtualEnabled,
        virtualStart,
      });
  if (key && unreadResolved.anchor && (unreadResolved.anchor.msgKey || unreadResolved.anchor.msgId !== undefined)) {
    unreadMap.set(key, unreadResolved.anchor);
  }

  const historySurface = buildHistoryRenderSurface({
    state,
    msgs,
    key,
    mobileUi,
    boardUi,
    friendLabels,
    selectionCount,
    selectionSet,
    hitSet,
    activeMsgIdx,
    historyLoaded,
    historyEmptyNotice,
    hasMore,
    loadingMore,
    loadingMoreSlotCount: loadingMore ? historyLoadingSlots : 0,
    loadingInitial,
    virtualEnabled,
    virtualStart,
    virtualEnd,
    topSpacerHeight,
    bottomSpacerHeight,
    unreadInsertIdx: unreadResolved.unreadInsertIdx,
    unreadCount: unreadResolved.unreadCount,
    albumLayout,
  });
  lines.push(...historySurface.lines);
  const isEmptyState = historySurface.isEmptyState;
  const titleChildren: Array<string | HTMLElement> = [...chatTitleNodes(state)];
  const chatSearchEnabled = !mobileUi;
  const showChatSearchToggle = false;
  if (activeConversation) {
    const infoActive = isRightPanelActiveForSelected(state);
    titleChildren.push(el("span", { class: "chat-title-spacer", "aria-hidden": "true" }, [""]));
    titleChildren.push(
      el(
        "button",
        {
          class: infoActive ? "btn chat-info-btn btn-active" : "btn chat-info-btn",
          type: "button",
          "data-action": "chat-profile-open",
          title: infoActive ? "Закрыть профиль чата" : "Профиль чата",
          "aria-label": infoActive ? "Закрыть профиль чата" : "Профиль чата",
          "aria-pressed": infoActive ? "true" : "false",
        },
        ["ℹ︎"]
      )
    );
    if (chatSearchEnabled && showChatSearchToggle) {
      titleChildren.push(
        el(
          "button",
          {
            class: state.chatSearchOpen ? "btn chat-search-toggle btn-active" : "btn chat-search-toggle",
            type: "button",
            "data-action": state.chatSearchOpen ? "chat-search-close" : "chat-search-open",
            title: "Поиск в чате (Ctrl+F)",
            "aria-label": "Поиск в чате",
          },
          [state.chatSearchOpen ? "Закрыть поиск" : "Поиск"]
        )
      );
    }
  }

  const searchBar = renderChatSearchBarSurface(state, chatSearchEnabled);

  renderSearchAuxDeferred({
    layout,
    state,
    msgs,
    hits,
    activePos,
    searchResultsOpen,
    friendLabels,
  });

  const pinnedSig = Array.isArray(pinnedIds) && pinnedIds.length ? pinnedIds.join(",") : "";
  const pinnedHiddenSig = key ? String(state.pinnedBarHidden?.[key] || "") : "";
  const pinnedHidden = Boolean(pinnedSig && pinnedHiddenSig && pinnedHiddenSig === pinnedSig);
  const pinnedBar = renderPinnedDeferred({
    msgs,
    pinnedIds,
    activeRaw: typeof activeRaw === "number" ? activeRaw : null,
    pinnedHidden,
  });
  if (!pinnedBar) {
    clearDeferredPinnedSurface();
  }

  const topChildren: HTMLElement[] = [el("div", { class: "chat-title" }, titleChildren)];
  if (pinnedBar) topChildren.push(pinnedBar);
  if (searchBar) topChildren.push(searchBar);
  layout.chatTop.replaceChildren(...topChildren);
  if (searchBar) {
    const nextSearchFilterScrollKey = `${key}|${state.chatSearchOpen ? 1 : 0}|${state.chatSearchFilter}|${Boolean((state.chatSearchQuery || "").trim()) ? 1 : 0}`;
    if (hostState.__chatSearchFilterScrollKey !== nextSearchFilterScrollKey) {
      hostState.__chatSearchFilterScrollKey = nextSearchFilterScrollKey;
      keepActiveControlVisible(searchBar, ".chat-search-filter.is-active");
    }
  } else if (hostState.__chatSearchFilterScrollKey) {
    hostState.__chatSearchFilterScrollKey = "";
  }
  if (selectionCount > 0) {
    const inner = renderChatSelectionBarSurface({ state, msgs, selectionSet, selectionCount, key });
    layout.chatSelectionBar.classList.remove("hidden");
    layout.chatSelectionBar.replaceChildren(...(inner ? [inner] : []));
  } else {
    layout.chatSelectionBar.classList.add("hidden");
    layout.chatSelectionBar.replaceChildren();
  }
  const linesClass = isEmptyState ? "chat-lines chat-lines-empty" : "chat-lines";
  scrollHost.replaceChildren(el("div", { class: linesClass }, lines));
  try {
    scrollHost.dispatchEvent(new Event("yagodka:chat-rendered"));
  } catch {
    // ignore
  }

  if (virtualEnabled && key) {
    const w = typeof window !== "undefined" ? window : null;
    if (hostState.__chatVirtualAvgRaf) {
      // already scheduled
    } else {
      const schedule = () => {
        hostState.__chatVirtualAvgRaf = null;
        const linesEl = scrollHost.firstElementChild as HTMLElement | null;
        if (!linesEl) return;
        const children = Array.from(linesEl.children) as HTMLElement[];
        let spacerHeight = 0;
        let spacerCount = 0;
        for (const child of children) {
          if (child.getAttribute("data-virtual-spacer")) {
            spacerHeight += child.offsetHeight;
            spacerCount += 1;
          }
        }
        const totalHeight = Math.max(0, linesEl.scrollHeight - spacerHeight);
        const lineCount = Math.max(1, children.length - spacerCount);
        const avg = clampVirtualAvg(totalHeight / lineCount);
        virtualAvgMap.set(key, avg);
      };
      if (w && typeof w.requestAnimationFrame === "function") {
        hostState.__chatVirtualAvgRaf = w.requestAnimationFrame(schedule);
      } else {
        hostState.__chatVirtualAvgRaf = 1;
        schedule();
      }
    }
  }

  // iOS/WebKit: images and media previews may change the history height after render.
  // Keep the chat pinned to bottom on content height changes, or preserve a visible anchor when not pinned.
  if (key && typeof ResizeObserver === "function") {
    try {
      if (!viewportRuntime.linesObserver) {
        viewportRuntime.linesObserverRaf = null;
        viewportRuntime.linesObserver = new ResizeObserver(() => {
          const w = typeof window !== "undefined" ? window : null;
          if (viewportRuntime.linesObserverRaf !== null) return;
          const run = () => {
            viewportRuntime.linesObserverRaf = null;
            const curKey = String(scrollHost.getAttribute("data-chat-key") || "");
            if (!curKey) return;
            const st = viewportRuntime.stickyBottom;
            if (isChatPendingBottomStickActive(scrollHost, curKey) || isChatStickyBottomActive(scrollHost, st, curKey)) {
              scrollHost.scrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
              viewportRuntime.stickyBottom = createChatStickyBottomState(scrollHost, curKey, true);
              return;
            }
            const anchor = viewportRuntime.shiftAnchor as ChatShiftAnchor | null;
            if (!anchor || anchor.key !== curKey) return;
            if (Math.abs(scrollHost.scrollTop - anchor.scrollTop) > 2) {
              viewportRuntime.shiftAnchor = captureChatShiftAnchor(scrollHost, curKey);
              return;
            }
            const anchorEl = findChatShiftAnchorElement(scrollHost, anchor);
            if (!anchorEl) return;
            const rect = anchorEl.getBoundingClientRect();
            const delta = rect.top - anchor.rectTop;
            if (Math.abs(delta) >= 1) {
              scrollHost.scrollTop += delta;
              markHistoryViewportCompensation(scrollHost);
            }
            anchor.rectTop = rect.top;
            anchor.scrollTop = scrollHost.scrollTop;
          };
          if (w && typeof w.requestAnimationFrame === "function") {
            viewportRuntime.linesObserverRaf = w.requestAnimationFrame(run);
          } else {
            viewportRuntime.linesObserverRaf = 1;
            run();
          }
        });
      }
      const linesEl = scrollHost.firstElementChild as HTMLElement | null;
      if (linesEl && viewportRuntime.linesObserved !== linesEl && viewportRuntime.linesObserver) {
        viewportRuntime.linesObserver.disconnect();
        viewportRuntime.linesObserver.observe(linesEl);
        viewportRuntime.linesObserved = linesEl;
      }
    } catch {
      // ignore
    }
  }

  if (!shouldStick && !keyChanged) {
    // Preserve the user's position in history unless we explicitly want to stick to bottom.
    // Some browsers may reset scrollTop when we replace the chat DOM; also keep the visible anchor stable on prepends.
    try {
      const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, prevScrollTop));
      if (Math.abs(scrollHost.scrollTop - nextTop) >= 1) scrollHost.scrollTop = nextTop;
      if (preShiftAnchor && (preShiftAnchor.msgKey || preShiftAnchor.msgId !== undefined)) {
        const anchorEl = findChatShiftAnchorElement(scrollHost, preShiftAnchor);
        if (anchorEl) {
          const rect = anchorEl.getBoundingClientRect();
          const delta = rect.top - preShiftAnchor.rectTop;
          if (Math.abs(delta) >= 1) {
            const corrected = Math.max(0, Math.min(maxTop, scrollHost.scrollTop + delta));
            if (Math.abs(scrollHost.scrollTop - corrected) >= 1) {
              scrollHost.scrollTop = corrected;
              markHistoryViewportCompensation(scrollHost);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  if (viewerReturnAnchor && viewportRuntime.viewerReturnAnchor === viewerReturnAnchor) {
    viewportRuntime.viewerReturnAnchor = null;
  }
  const atBottomNow = scrollHost.scrollTop >= maxScrollTop() - 24;
  layout.chatJump.classList.toggle("hidden", !key || shouldStick || atBottomNow);
  if (shouldStick) {
    const stickNow = () => {
      const curKey = String(scrollHost.getAttribute("data-chat-key") || "");
      const st = viewportRuntime.stickyBottom;
      if (!curKey || curKey !== key) return;
      const forcePending = isChatPendingBottomStickActive(scrollHost, key);
      if (!forcePending && !isChatStickyBottomActive(scrollHost, st, key)) return;
      scrollHost.scrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
      viewportRuntime.stickyBottom = createChatStickyBottomState(scrollHost, key, true);
      if (!forcePending) clearChatPendingBottomStick(scrollHost, key);
    };
    queueMicrotask(stickNow);
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(stickNow);
    }
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(stickNow, 80);
      window.setTimeout(stickNow, 260);
    }
  }
  hostState.__chatTailKey = key;
  hostState.__chatTailSig = tailSig;
  hostState.__chatTailCount = msgs.length;
  if (key && !shouldStick) {
    captureAndStoreChatShiftAnchor(scrollHost, key);
  } else if (viewportRuntime.shiftAnchor) {
    viewportRuntime.shiftAnchor = null;
  }
}
