import {
  createHistoryMediaHydrationRuntime,
  didPreviewGeometryChange,
  resolveStablePreviewAspectRatio,
} from "../history/historyMediaHydrationRuntime";
import { getChatHistoryViewportRuntime } from "../../../helpers/chat/historyViewportRuntime";
import { createChatStickyBottomState, isChatStickyBottomActive } from "../../../helpers/chat/stickyBottom";
import { hasActiveConversationSelection } from "../../../helpers/navigation/mainConversationState";
import type { ChatHostDeferredDeps } from "./chatHostDeferredRuntime";
export { resolveStablePreviewAspectRatio };
export { didPreviewGeometryChange };

export function installChatHostDeferredEvents(deps: ChatHostDeferredDeps) {
  const {
    store,
    layout,
    getMaxScrollTop,
    scheduleChatJumpVisibility,
    maybeRecordLastRead,
    scheduleAutoFetchVisiblePreviews,
    ensureVideoMutedDefault,
    scheduleViewportReadUpdate,
    markUserChatScroll,
  } = deps;

  let chatStickyResizeRaf: number | null = null;
  let chatTouchStartX = 0;
  let chatTouchStartY = 0;
  let chatTouchTracking = false;
  const CHAT_TOUCH_JITTER_PX = 12;
  const CHAT_TOUCH_JITTER_SQ = CHAT_TOUCH_JITTER_PX * CHAT_TOUCH_JITTER_PX;

  const scheduleChatStickyResize = () => {
    if (chatStickyResizeRaf !== null) return;
    chatStickyResizeRaf = window.requestAnimationFrame(() => {
      chatStickyResizeRaf = null;
      const host = layout.chatHost;
      const key = String(host.getAttribute("data-chat-key") || "");
      if (!key) return;
      const runtime = getChatHistoryViewportRuntime(host);
      const st = runtime.stickyBottom;
      if (!isChatStickyBottomActive(host, st, key)) {
        if (st && st.active && st.key === key) runtime.stickyBottom = createChatStickyBottomState(host, key, false);
        return;
      }
      host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
      runtime.stickyBottom = createChatStickyBottomState(host, key, true);
      maybeRecordLastRead(key);
      scheduleViewportReadUpdate();
      scheduleChatJumpVisibility();
    });
  };

  const mediaHydration = createHistoryMediaHydrationRuntime({
    chatHost: layout.chatHost,
    ensureVideoMutedDefault,
    scheduleAutoFetchVisiblePreviews,
    scheduleChatStickyResize,
  });

  layout.chatHost.addEventListener(
    "load",
    (event) => {
      mediaHydration.handleImageLoad(event.target);
    },
    true
  );

  layout.chatHost.addEventListener(
    "loadedmetadata",
    (event) => {
      mediaHydration.handleLoadedMetadata(event.target);
    },
    true
  );

  if (typeof document !== "undefined") {
    document.addEventListener("play", (event) => mediaHydration.handleDocumentMediaBootstrap(event.target), true);
    document.addEventListener("loadedmetadata", (event) => mediaHydration.handleDocumentMediaBootstrap(event.target), true);
    document.addEventListener("volumechange", (event) => mediaHydration.handleDocumentVolumeChange(event.target), true);
    document.addEventListener("play", (event) => mediaHydration.handleExclusiveMediaPlay(event.target), true);
  }

  layout.chatHost.addEventListener(
    "play",
    (event) => {
      mediaHydration.handleVideoPlay(event.target);
    },
    true
  );

  layout.chatHost.addEventListener(
    "pause",
    (event) => {
      mediaHydration.handleVideoPause(event.target);
    },
    true
  );

  layout.chatHost.addEventListener("wheel", markUserChatScroll, { passive: true });
  layout.chatHost.addEventListener("touchstart", markUserChatScroll, { passive: true });
  layout.chatHost.addEventListener("touchmove", markUserChatScroll, { passive: true });
  layout.chatHost.addEventListener("pointerdown", markUserChatScroll, { passive: true });

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "PageUp" && key !== "PageDown" && key !== "Home" && key !== "End" && key !== " " && key !== "Spacebar") {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest("input, textarea, [contenteditable='true']")) return;
    }
    const st = store.get();
    if (st.page !== "main") return;
    if (!hasActiveConversationSelection(st)) return;
    markUserChatScroll();
  });

  const chatCol = layout.chat.parentElement instanceof HTMLElement ? layout.chat.parentElement : null;
  const mobileOverlayMq =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 600px) and (pointer: coarse)")
      : null;
  let insetRaf: number | null = null;
  let lastComposerH = -1;
  let lastBottomInset = -1;

  const applyBottomInsets = () => {
    if (!chatCol) return;
    const enabled = Boolean(mobileOverlayMq?.matches);
    if (!enabled) {
      if (lastComposerH !== -1 || lastBottomInset !== -1) {
        chatCol.style.removeProperty("--chat-composer-h");
        chatCol.style.removeProperty("--chat-bottom-inset");
        lastComposerH = -1;
        lastBottomInset = -1;
      }
      return;
    }

    const composerH = Math.max(0, Math.round(layout.inputWrap.getBoundingClientRect().height));
    const searchFooterH = (() => {
      const el = layout.chatSearchFooter;
      if (!(el instanceof HTMLElement)) return 0;
      if (el.classList.contains("hidden")) return 0;
      return Math.max(0, Math.round(el.getBoundingClientRect().height));
    })();
    const bottomInset = composerH + searchFooterH;

    if (composerH !== lastComposerH) {
      chatCol.style.setProperty("--chat-composer-h", `${composerH}px`);
      lastComposerH = composerH;
    }
    if (bottomInset !== lastBottomInset) {
      chatCol.style.setProperty("--chat-bottom-inset", `${bottomInset}px`);
      lastBottomInset = bottomInset;
    }
  };

  const scheduleBottomInsets = () => {
    if (!chatCol) return;
    if (insetRaf !== null) return;
    insetRaf = window.requestAnimationFrame(() => {
      insetRaf = null;
      applyBottomInsets();
    });
  };

  scheduleBottomInsets();
  try {
    const anyMq = mobileOverlayMq as unknown as { addEventListener?: (t: "change", cb: () => void) => void; addListener?: (cb: () => void) => void };
    if (anyMq?.addEventListener) anyMq.addEventListener("change", scheduleBottomInsets);
    else if (anyMq?.addListener) anyMq.addListener(scheduleBottomInsets);
  } catch {
    // ignore
  }

  const chatResizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          scheduleBottomInsets();
          scheduleChatStickyResize();
        })
      : null;

  try {
    chatResizeObserver?.observe(layout.chatHost);
    chatResizeObserver?.observe(layout.chat);
    chatResizeObserver?.observe(layout.inputWrap);
    chatResizeObserver?.observe(layout.chatSearchFooter);
  } catch {
    // ignore
  }

  layout.chatHost.addEventListener(
    "loadedmetadata",
    (event) => {
      const target = event.target as unknown;
      if (!(target instanceof HTMLAudioElement)) return;
      scheduleChatStickyResize();
    },
    true
  );

  layout.chatHost.addEventListener(
    "touchstart",
    (event) => {
      const ev = event as TouchEvent;
      if (ev.touches.length !== 1) {
        chatTouchTracking = false;
        return;
      }
      const target = ev.target as HTMLElement | null;
      if (target) {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) {
          chatTouchTracking = false;
          return;
        }
        if (target.closest("button, a")) {
          chatTouchTracking = false;
          return;
        }
      }
      chatTouchStartX = ev.touches[0].clientX;
      chatTouchStartY = ev.touches[0].clientY;
      chatTouchTracking = true;
    },
    { passive: true }
  );

  layout.chatHost.addEventListener(
    "touchmove",
    (event) => {
      if (!chatTouchTracking) return;
      const ev = event as TouchEvent;
      if (ev.touches.length !== 1) return;
      const dx = ev.touches[0].clientX - chatTouchStartX;
      const dy = ev.touches[0].clientY - chatTouchStartY;
      if (dx * dx + dy * dy < CHAT_TOUCH_JITTER_SQ) return;
      const host = layout.chatHost;
      const top = host.scrollTop <= 0;
      const bottom = host.scrollTop >= getMaxScrollTop(host) - 1;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const isMostlyHorizontal = absDx > absDy + 10;
      if (!isMostlyHorizontal) return;
      if (top || bottom) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  const resetChatTouch = () => {
    chatTouchTracking = false;
  };
  layout.chatHost.addEventListener("touchend", resetChatTouch, { passive: true });
  layout.chatHost.addEventListener("touchcancel", resetChatTouch, { passive: true });

  layout.chatHost.addEventListener("yagodka:chat-rendered", () => {
    scheduleBottomInsets();
    mediaHydration.syncExistingMediaState();
  });

  mediaHydration.syncExistingMediaState();
}
