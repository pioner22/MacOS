import { conversationKey } from "../../../helpers/chat/conversationKey";
import { getChatHistoryViewportRuntime } from "../../../helpers/chat/historyViewportRuntime";
import { getActiveConversationTarget, isMainConversationSurface } from "../../../helpers/navigation/mainConversationState";
import { shouldShowRightPanelOverlay } from "../../../helpers/navigation/rightPanelState";
import { isChatHostNearBottom, isChatStickyBottomActive } from "../../../helpers/chat/stickyBottom";
import { normalizeMobileSidebarTab, setMobileSidebarTabValue } from "../../../helpers/sidebar/sidebarState";
import { scheduleChromeColorSync } from "../../../helpers/ui/chromeColors";
import type { Store } from "../../../stores/store";
import type { AppState, MobileSidebarTab } from "../../../stores/types";

export interface SidebarOverlayFeatureDeps {
  store: Store<AppState>;
  navOverlay: HTMLElement;
  sidebar: HTMLElement;
  sidebarBody: HTMLElement;
  chatHost: HTMLElement;
  mobileSidebarMq: MediaQueryList;
  floatingSidebarMq: MediaQueryList;
  rightOverlayMq: MediaQueryList;
  hoverMq: MediaQueryList;
  anyFinePointerMq: MediaQueryList;
  isMobileLikeUi: () => boolean;
  scrollChatToBottom: (key: string) => void;
  closeRightPanel: () => void;
}

export interface SidebarOverlayFeature {
  installEventListeners: () => void;
  dispose: () => void;

  syncNavOverlay: () => void;

  setMobileSidebarOpen: (open: boolean, opts?: { suppressStickBottomRestore?: boolean }) => void;
  setFloatingSidebarOpen: (open: boolean, opts?: { suppressStickBottomRestore?: boolean }) => void;
  closeMobileSidebar: (opts?: { suppressStickBottomRestore?: boolean }) => void;
  closeFloatingSidebar: (opts?: { suppressStickBottomRestore?: boolean }) => void;

  setMobileSidebarTab: (tab: MobileSidebarTab) => void;

  isMobileSidebarOpen: () => boolean;
  isFloatingSidebarOpen: () => boolean;
}

type MqCleanup = () => void;

function addMediaQueryListener(mq: MediaQueryList, cb: (ev: MediaQueryListEvent) => void): MqCleanup {
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener?.("change", cb);
  }
  const legacy = mq as MediaQueryList & {
    addListener?: (listener: (ev: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (ev: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener?.(cb);
  return () => legacy.removeListener?.(cb);
}

export function createSidebarOverlayFeature(deps: SidebarOverlayFeatureDeps): SidebarOverlayFeature {
  const {
    store,
    navOverlay,
    sidebar,
    sidebarBody,
    chatHost,
    mobileSidebarMq,
    floatingSidebarMq,
    rightOverlayMq,
    hoverMq,
    anyFinePointerMq,
    isMobileLikeUi,
    scrollChatToBottom,
    closeRightPanel,
  } = deps;

  let listenersInstalled = false;
  const mqCleanup: MqCleanup[] = [];

  let mobileSidebarOpen = false;
  let mobileSidebarChatKey: string | null = null;
  let mobileSidebarChatWasAtBottom = false;
  let suppressMobileSidebarCloseStickBottom = false;

  let floatingSidebarOpen = false;
  let floatingSidebarChatKey: string | null = null;
  let floatingSidebarChatWasAtBottom = false;
  let suppressFloatingSidebarCloseStickBottom = false;

  function isChatAtBottom(key: string): boolean {
    const k = String(key || "").trim();
    if (!k) return true;
    const currentKey = String(chatHost.getAttribute("data-chat-key") || "").trim();
    if (!currentKey || currentKey !== k) return true;
    const sticky = getChatHistoryViewportRuntime(chatHost).stickyBottom;
    if (isChatStickyBottomActive(chatHost, sticky, k)) return true;
    return isChatHostNearBottom(chatHost);
  }

  function shouldShowRightOverlay(st: AppState): boolean {
    return shouldShowRightPanelOverlay(st, { overlayMatches: rightOverlayMq.matches, mobileUi: isMobileLikeUi() });
  }

  function syncNavOverlay() {
    const st = store.get();
    const show = mobileSidebarOpen || floatingSidebarOpen || shouldShowRightOverlay(st);
    navOverlay.classList.toggle("hidden", !show);
    navOverlay.setAttribute("aria-hidden", show ? "false" : "true");
  }

  const markSidebarResetScroll = () => {
    try {
      sidebar.dataset.sidebarResetScroll = "1";
      sidebarBody.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  };

  const resetSidebarScrollTop = (behavior: ScrollBehavior = "auto") => {
    try {
      sidebarBody.scrollTo({ top: 0, left: 0, behavior });
    } catch {
      sidebarBody.scrollTop = 0;
      sidebarBody.scrollLeft = 0;
    }
  };

  const scheduleSidebarScrollReset = () => {
    const resetScroll = () => resetSidebarScrollTop();
    queueMicrotask(() => resetScroll());
    try {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resetScroll());
      }
    } catch {
      // ignore
    }
    try {
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(() => resetScroll(), 120);
      }
    } catch {
      // ignore
    }
  };

  function withSuppressedStickBottomRestore(suppress: boolean, fn: () => void): void {
    if (!suppress) {
      fn();
      return;
    }
    const prevMobile = suppressMobileSidebarCloseStickBottom;
    const prevFloating = suppressFloatingSidebarCloseStickBottom;
    suppressMobileSidebarCloseStickBottom = true;
    suppressFloatingSidebarCloseStickBottom = true;
    try {
      fn();
    } finally {
      suppressMobileSidebarCloseStickBottom = prevMobile;
      suppressFloatingSidebarCloseStickBottom = prevFloating;
    }
  }

  function setMobileSidebarOpen(open: boolean, opts?: { suppressStickBottomRestore?: boolean }) {
    const suppress = Boolean(opts?.suppressStickBottomRestore);
    withSuppressedStickBottomRestore(suppress, () => {
      const st = store.get();
      const activeTarget = getActiveConversationTarget(st);
      const forcedOpen = Boolean(mobileSidebarMq.matches && isMainConversationSurface(st) && !activeTarget);
      const shouldOpen = Boolean((open || forcedOpen) && mobileSidebarMq.matches);
      if (mobileSidebarOpen === shouldOpen) return;

      const prevOpen = mobileSidebarOpen;
      const selKey = activeTarget ? conversationKey(activeTarget) : "";
      const restoreKey =
        !shouldOpen &&
        prevOpen &&
        !suppressMobileSidebarCloseStickBottom &&
        mobileSidebarChatWasAtBottom &&
        mobileSidebarChatKey &&
        selKey &&
        selKey === mobileSidebarChatKey
          ? selKey
          : "";

      if (shouldOpen) {
        mobileSidebarChatKey = selKey || null;
        mobileSidebarChatWasAtBottom = Boolean(selKey && isChatAtBottom(selKey));
      } else {
        mobileSidebarChatKey = null;
        mobileSidebarChatWasAtBottom = false;
      }

      mobileSidebarOpen = shouldOpen;
      sidebar.classList.toggle("sidebar-mobile-open", shouldOpen);
      document.documentElement.classList.toggle("sidebar-mobile-open", shouldOpen);
      scheduleChromeColorSync();
      syncNavOverlay();
      if (shouldOpen) {
        markSidebarResetScroll();
        scheduleSidebarScrollReset();
        queueMicrotask(() => {
          const autoFocusSearch = hoverMq.matches && anyFinePointerMq.matches;
          const searchInput = sidebar.querySelector(".sidebar-search-input") as HTMLInputElement | null;
          if (autoFocusSearch && searchInput && !searchInput.disabled) {
            searchInput.focus();
            return;
          }
          const tabBtn = sidebar.querySelector(".sidebar-tabs button") as HTMLButtonElement | null;
          if (tabBtn) {
            tabBtn.focus();
            return;
          }
          sidebarBody?.focus?.();
        });
      } else if (restoreKey) {
        scrollChatToBottom(restoreKey);
      }
    });
  }

  function setFloatingSidebarOpen(open: boolean, opts?: { suppressStickBottomRestore?: boolean }) {
    const suppress = Boolean(opts?.suppressStickBottomRestore);
    withSuppressedStickBottomRestore(suppress, () => {
      const st = store.get();
      const activeTarget = getActiveConversationTarget(st);
      const forcedOpen = Boolean(floatingSidebarMq.matches && isMainConversationSurface(st) && !activeTarget);
      const shouldOpen = Boolean((open || forcedOpen) && floatingSidebarMq.matches);
      if (floatingSidebarOpen === shouldOpen) return;

      const prevOpen = floatingSidebarOpen;
      const selKey = activeTarget ? conversationKey(activeTarget) : "";
      const restoreKey =
        !shouldOpen &&
        prevOpen &&
        !suppressFloatingSidebarCloseStickBottom &&
        floatingSidebarChatWasAtBottom &&
        floatingSidebarChatKey &&
        selKey &&
        selKey === floatingSidebarChatKey
          ? selKey
          : "";

      if (shouldOpen) {
        floatingSidebarChatKey = selKey || null;
        floatingSidebarChatWasAtBottom = Boolean(selKey && isChatAtBottom(selKey));
      } else {
        floatingSidebarChatKey = null;
        floatingSidebarChatWasAtBottom = false;
      }

      floatingSidebarOpen = shouldOpen;
      sidebar.classList.toggle("sidebar-float-open", shouldOpen);
      document.documentElement.classList.toggle("floating-sidebar-open", shouldOpen);
      syncNavOverlay();
      if (shouldOpen) {
        markSidebarResetScroll();
        scheduleSidebarScrollReset();
      }
      if (restoreKey) {
        scrollChatToBottom(restoreKey);
      }
    });
  }

  function closeMobileSidebar(opts?: { suppressStickBottomRestore?: boolean }) {
    const suppress = Boolean(opts?.suppressStickBottomRestore);
    withSuppressedStickBottomRestore(suppress, () => {
      if (!mobileSidebarOpen) {
        closeFloatingSidebar({ suppressStickBottomRestore: suppress });
        return;
      }
      setMobileSidebarOpen(false);
      closeFloatingSidebar({ suppressStickBottomRestore: suppress });
    });
  }

  function closeFloatingSidebar(opts?: { suppressStickBottomRestore?: boolean }) {
    const suppress = Boolean(opts?.suppressStickBottomRestore);
    withSuppressedStickBottomRestore(suppress, () => {
      if (!floatingSidebarOpen) return;
      setFloatingSidebarOpen(false);
    });
  }

  function setMobileSidebarTab(tab: MobileSidebarTab) {
    const next = normalizeMobileSidebarTab(tab);
    if (normalizeMobileSidebarTab(store.get().mobileSidebarTab) === next) {
      resetSidebarScrollTop("smooth");
      return;
    }
    markSidebarResetScroll();
    store.set((prev) => setMobileSidebarTabValue(prev, next));
  }

  const onNavOverlayClick = () => {
    const st = store.get();
    if (shouldShowRightOverlay(st)) {
      closeRightPanel();
      return;
    }
    closeMobileSidebar();
  };

  const onSidebarClick = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action='sidebar-close']") as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();
    closeMobileSidebar();
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    navOverlay.addEventListener("click", onNavOverlayClick);
    sidebar.addEventListener("click", onSidebarClick);

    mqCleanup.push(
      addMediaQueryListener(mobileSidebarMq, () => {
        if (mobileSidebarMq.matches) return;
        closeMobileSidebar();
      })
    );
    mqCleanup.push(
      addMediaQueryListener(floatingSidebarMq, () => {
        if (floatingSidebarMq.matches) return;
        closeFloatingSidebar();
      })
    );
    mqCleanup.push(
      addMediaQueryListener(rightOverlayMq, () => {
        syncNavOverlay();
      })
    );

    syncNavOverlay();
  }

  function dispose() {
    if (!listenersInstalled) return;
    listenersInstalled = false;

    navOverlay.removeEventListener("click", onNavOverlayClick);
    sidebar.removeEventListener("click", onSidebarClick);
    while (mqCleanup.length) {
      const cleanup = mqCleanup.pop();
      try {
        cleanup?.();
      } catch {
        // ignore
      }
    }
  }

  return {
    installEventListeners,
    dispose,
    syncNavOverlay,
    setMobileSidebarOpen,
    setFloatingSidebarOpen,
    closeMobileSidebar,
    closeFloatingSidebar,
    setMobileSidebarTab,
    isMobileSidebarOpen: () => mobileSidebarOpen,
    isFloatingSidebarOpen: () => floatingSidebarOpen,
  };
}
