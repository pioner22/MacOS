import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { hasActiveConversationSelection } from "../../../helpers/navigation/mainConversationState";
import { resolveHeaderChatBackAction, resolveHeaderNavBackAction, resolveOverlayInteractionAction } from "./interactionPolicy";

export interface TopbarActionsFeatureDeps {
  store: Store<AppState>;
  overlay: HTMLElement;
  headerLeft: HTMLElement;
  headerRight: HTMLElement;
  closeModal: () => void;
  onSetPageMain: () => void;
  onOpenChatSearch: () => void;
  onCloseChatSearch: () => void;
  onLogout: () => void;
  onAuthOpen: () => void;
  onClearSelectedTarget: () => void;
  onToggleSidebar: () => void;
  onStartCall: (mode: "audio" | "video") => void;
  onOpenChatTopbarMenu: (anchor: HTMLElement) => void;
}

export interface TopbarActionsFeature {
  installEventListeners: () => void;
}

export function createTopbarActionsFeature(deps: TopbarActionsFeatureDeps): TopbarActionsFeature {
  const {
    store,
    overlay,
    headerLeft,
    headerRight,
    closeModal,
    onSetPageMain,
    onOpenChatSearch,
    onCloseChatSearch,
    onLogout,
    onAuthOpen,
    onClearSelectedTarget,
    onToggleSidebar,
    onStartCall,
    onOpenChatTopbarMenu,
  } = deps;

  let listenersInstalled = false;

  const onOverlayClick = (e: Event) => {
    if (e.target !== overlay) return;
    const action = resolveOverlayInteractionAction(store.get().modal);
    if (action === "none") return;
    e.preventDefault();
    if (action === "close_modal") {
      closeModal();
    }
  };

  const onHeaderLeftClick = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action]") as HTMLButtonElement | null;
    if (!btn) return;
    const action = String(btn.dataset.action || "");
    if (action === "nav-back") {
      e.preventDefault();
      const next = resolveHeaderNavBackAction(store.get());
      if (next === "set_page_main") onSetPageMain();
      return;
    }
    if (action === "chat-search-open") {
      e.preventDefault();
      onOpenChatSearch();
      return;
    }
    if (action === "chat-search-close") {
      e.preventDefault();
      onCloseChatSearch();
      return;
    }
    if (action === "auth-logout") {
      e.preventDefault();
      onLogout();
      return;
    }
    if (action === "auth-open") {
      e.preventDefault();
      onAuthOpen();
      return;
    }
    if (action === "chat-back") {
      e.preventDefault();
      const next = resolveHeaderChatBackAction(store.get());
      if (next === "clear_selected_target") onClearSelectedTarget();
      return;
    }
    if (action !== "sidebar-toggle") return;
    e.preventDefault();
    if (store.get().modal) return;
    onToggleSidebar();
  };

  const onHeaderRightClick = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action]") as HTMLButtonElement | null;
    if (!btn) return;
    const action = String(btn.dataset.action || "");
    if (action === "auth-open") {
      e.preventDefault();
      onAuthOpen();
      return;
    }
    if (action === "call-start-audio") {
      e.preventDefault();
      onStartCall("audio");
      return;
    }
    if (action === "call-start-video") {
      e.preventDefault();
      onStartCall("video");
      return;
    }
    if (action !== "chat-topbar-menu") return;
    e.preventDefault();
    const st = store.get();
    if (st.modal) return;
    if (!hasActiveConversationSelection(st)) return;
    onOpenChatTopbarMenu(btn);
  };

  const installEventListeners = () => {
    if (listenersInstalled) return;
    listenersInstalled = true;
    overlay.addEventListener("click", onOverlayClick);
    headerLeft.addEventListener("click", onHeaderLeftClick);
    headerRight.addEventListener("click", onHeaderRightClick);
  };

  return { installEventListeners };
}
