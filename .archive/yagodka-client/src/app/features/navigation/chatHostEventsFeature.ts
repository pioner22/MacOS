import { conversationKey } from "../../../helpers/chat/conversationKey";
import { getChatHistoryViewportRuntime } from "../../../helpers/chat/historyViewportRuntime";
import { createChatStickyBottomState, isChatHostNearBottom, isChatStickyBottomActive } from "../../../helpers/chat/stickyBottom";
import { getActiveConversationKey, getActiveConversationTarget } from "../../../helpers/navigation/mainConversationState";
import type { Layout } from "../../../components/layout/types";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";
import { createLazyChatHostDeferredRuntime } from "./chatHostDeferredRuntime";

export interface ChatHostEventsFeatureDeps {
  store: Store<AppState>;
  layout: Pick<Layout, "chat" | "chatHost" | "inputWrap" | "chatSearchFooter">;
  getMaxScrollTop: (host: HTMLElement) => number;
  scheduleChatJumpVisibility: () => void;
  maybeRecordLastRead: (key: string) => void;
  maybeAutoLoadMoreHistory: (payload: { scrollTop: number; scrollingUp: boolean; lastUserScrollAt: number }) => void;
  maybeUpdateVirtualWindow: (scrollTop: number) => void;
  maybeAutoFillHistoryViewport: () => void;
  scheduleAutoFetchVisiblePreviews: () => void;
  recordRoomLastReadEntry: (key: string, msg: ChatMessage) => void;
  maybeSendMessageRead: (peerId: string, msgId: number) => void;
}

export interface ChatHostEventsFeature {
  ensureVideoMutedDefault: (video: HTMLVideoElement) => void;
  install: () => void;
}

export function shouldIgnoreChatHostScrollSideEffects(state: Pick<AppState, "modal">): boolean {
  const kind = state.modal?.kind ?? null;
  return kind === "file_viewer" || kind === "call";
}

export function createChatHostEventsFeature(deps: ChatHostEventsFeatureDeps): ChatHostEventsFeature {
  const {
    store,
    layout,
    getMaxScrollTop,
    scheduleChatJumpVisibility,
    maybeRecordLastRead,
    maybeAutoLoadMoreHistory,
    maybeUpdateVirtualWindow,
    maybeAutoFillHistoryViewport,
    scheduleAutoFetchVisiblePreviews,
    recordRoomLastReadEntry,
    maybeSendMessageRead,
  } = deps;

  let lastChatScrollTop = 0;
  let lastChatUserScrollAt = 0;
  let viewportReadRaf: number | null = null;
  let lastViewportReadAt = 0;

  const findLastVisibleMessageIndex = (host: HTMLElement): number | null => {
    const linesEl = host.querySelector(".chat-lines");
    if (!(linesEl instanceof HTMLElement)) return null;
    const children = Array.from(linesEl.children);
    if (!children.length) return null;
    const hostRect = host.getBoundingClientRect();
    const topEdge = hostRect.top + 4;
    const bottomEdge = hostRect.bottom - 4;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (!(child instanceof HTMLElement)) continue;
      const rawIdx = child.getAttribute("data-msg-idx");
      if (!rawIdx) continue;
      const rect = child.getBoundingClientRect();
      if (rect.bottom <= topEdge) break;
      if (rect.top >= bottomEdge) continue;
      const idx = Number(rawIdx);
      if (Number.isFinite(idx)) return idx;
    }
    return null;
  };

  const recordVisibleRead = () => {
    const st = store.get();
    const activeConversation = getActiveConversationTarget(st);
    if (!activeConversation) return;
    if (st.chatSearchOpen && st.chatSearchQuery.trim()) return;
    const key = getActiveConversationKey(st);
    if (!key) return;
    const msgIdx = findLastVisibleMessageIndex(layout.chatHost);
    if (msgIdx === null) return;
    const msgs = st.conversations[key] || [];
    let idx = msgIdx;
    let msg = msgs[idx];
    while (msg && msg.kind === "sys" && idx > 0) {
      idx -= 1;
      msg = msgs[idx];
    }
    if (!msg || msg.kind === "sys") return;
    if (key.startsWith("room:")) {
      recordRoomLastReadEntry(key, msg);
      return;
    }
    if (key.startsWith("dm:")) {
      const msgId = Number(msg.id ?? 0);
      if (!Number.isFinite(msgId) || msgId <= 0) return;
      const peerId = activeConversation.kind === "dm" ? activeConversation.id : key.slice("dm:".length);
      if (!peerId) return;
      maybeSendMessageRead(peerId, msgId);
    }
  };

  const scheduleViewportReadUpdate = () => {
    if (viewportReadRaf !== null) return;
    viewportReadRaf = window.requestAnimationFrame(() => {
      viewportReadRaf = null;
      const now = Date.now();
      if (now - lastViewportReadAt < 160) return;
      lastViewportReadAt = now;
      recordVisibleRead();
    });
  };

  const shouldForceVideoMute = (video: HTMLVideoElement): boolean => {
    if (video.dataset.allowAudio === "1") return false;
    if (video.dataset.userUnmuted === "1") return false;
    return true;
  };

  const ensureVideoMutedDefault = (video: HTMLVideoElement) => {
    if (!shouldForceVideoMute(video)) return;
    if (!video.muted) video.muted = true;
    if (!video.defaultMuted) video.defaultMuted = true;
    if (!video.hasAttribute("muted")) video.setAttribute("muted", "");
  };

  const markUserChatScroll = () => {
    if (shouldIgnoreChatHostScrollSideEffects(store.get())) return;
    const now = Date.now();
    lastChatUserScrollAt = now;
    const key = String(layout.chatHost.getAttribute("data-chat-key") || "");
    if (!key) return;
    const runtime = getChatHistoryViewportRuntime(layout.chatHost);
    const stick = runtime.stickyBottom;
    if (!stick || stick.key !== key || !stick.active) return;
    if (isChatHostNearBottom(layout.chatHost)) return;
    runtime.stickyBottom = createChatStickyBottomState(layout.chatHost, key, false, now);
  };

  const deferredRuntime = createLazyChatHostDeferredRuntime({
    store,
    layout,
    getMaxScrollTop,
    scheduleChatJumpVisibility,
    maybeRecordLastRead,
    scheduleAutoFetchVisiblePreviews,
    ensureVideoMutedDefault,
    scheduleViewportReadUpdate,
    markUserChatScroll,
  });

  const install = () => {
    layout.chatHost.addEventListener(
      "scroll",
      () => {
        const scrollTop = layout.chatHost.scrollTop;
        const scrollingUp = scrollTop < lastChatScrollTop;
        lastChatScrollTop = scrollTop;
        if (shouldIgnoreChatHostScrollSideEffects(store.get())) return;
        const key = String(layout.chatHost.getAttribute("data-chat-key") || "");
        const now = Date.now();
        const userScrollRecent = now - lastChatUserScrollAt < 2000;
        const atBottom = isChatHostNearBottom(layout.chatHost);
        if (key) {
          const runtime = getChatHistoryViewportRuntime(layout.chatHost);
          const unreadMap: Map<string, unknown> = runtime.unreadAnchors;
          const unreadClearArmed = runtime.unreadClearArmed;
          if (unreadMap && unreadMap.has(key)) {
            if (!atBottom && userScrollRecent) unreadClearArmed.add(key);
            if (atBottom && unreadClearArmed.has(key)) {
              unreadMap.delete(key);
              unreadClearArmed.delete(key);
            }
          } else {
            unreadClearArmed.delete(key);
          }
          const stick = runtime.stickyBottom;
          if (!stick || stick.key !== key) {
            runtime.stickyBottom = createChatStickyBottomState(layout.chatHost, key, atBottom, now);
          } else if (atBottom) {
            runtime.stickyBottom = createChatStickyBottomState(layout.chatHost, key, true, now);
          } else if (userScrollRecent || isChatStickyBottomActive(layout.chatHost, stick, key)) {
            runtime.stickyBottom = createChatStickyBottomState(layout.chatHost, key, false, now);
          }
        }
        scheduleChatJumpVisibility();
        maybeAutoLoadMoreHistory({ scrollTop, scrollingUp, lastUserScrollAt: lastChatUserScrollAt });
        maybeUpdateVirtualWindow(scrollTop);
        scheduleViewportReadUpdate();
        scheduleAutoFetchVisiblePreviews();
        if (atBottom) maybeRecordLastRead(key);
      },
      { passive: true }
    );

    layout.chatHost.addEventListener("yagodka:chat-rendered", () => {
      scheduleAutoFetchVisiblePreviews();
      maybeAutoFillHistoryViewport();
    });
    deferredRuntime.startDeferredBoot();
  };

  return {
    ensureVideoMutedDefault,
    install,
  };
}
