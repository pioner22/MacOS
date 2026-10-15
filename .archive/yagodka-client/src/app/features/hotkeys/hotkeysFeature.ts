import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { hasActiveConversationSelection } from "../../../helpers/navigation/mainConversationState";
import { resolveEscapeInteractionAction } from "../navigation/interactionPolicy";

export interface HotkeysFeatureDeps {
  store: Store<AppState>;
  hotkeysRoot: HTMLElement;
  onHotkey: (key: string) => void;
  onManualPwaUpdate: () => void;
  onFileViewerNavigate: (dir: "prev" | "next") => void;
  onOpenChatSearch: () => void;
  onCloseMobileSidebar: () => void;
  onCloseModal: () => void;
  onCloseChatSearch: () => void;
  onCloseRightPanel: () => void;
  onSetMainPage: () => void;
  isMobileSidebarOpen: () => boolean;
  isFloatingSidebarOpen: () => boolean;
}

export interface HotkeysFeature {
  installEventListeners: () => void;
  dispose: () => void;
}

export function createHotkeysFeature(deps: HotkeysFeatureDeps): HotkeysFeature {
  const {
    store,
    hotkeysRoot,
    onHotkey,
    onManualPwaUpdate,
    onFileViewerNavigate,
    onOpenChatSearch,
    onCloseMobileSidebar,
    onCloseModal,
    onCloseChatSearch,
    onCloseRightPanel,
    onSetMainPage,
    isMobileSidebarOpen,
    isFloatingSidebarOpen,
  } = deps;

  let listenersInstalled = false;

  const onWindowKeyDown = (e: KeyboardEvent) => {
    const st = store.get();

    if (st.modal?.kind === "auth" && !st.authed) {
      if (e.key.startsWith("F")) {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        return;
      }
    }

    if (st.modal?.kind === "pwa_update") {
      if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        onManualPwaUpdate();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onManualPwaUpdate();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseModal();
      }
      return;
    }

    if (st.modal?.kind === "update") {
      if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        window.location.reload();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        window.location.reload();
        return;
      }
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
        e.preventDefault();
        onCloseModal();
      }
      return;
    }

    if (st.modal?.kind === "file_viewer") {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onFileViewerNavigate("prev");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onFileViewerNavigate("next");
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
      e.preventDefault();
      if (!st.authed) return;
      if (st.pwaUpdateAvailable) {
        onManualPwaUpdate();
      } else if (st.updateLatest) {
        window.location.reload();
      } else {
        store.set({ status: "Обновлений веб-клиента нет" });
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
      if (hasActiveConversationSelection(st)) {
        e.preventDefault();
        onOpenChatSearch();
      }
      return;
    }

    if (e.key === "Escape") {
      const action = resolveEscapeInteractionAction({
        ...st,
        mobileSidebarOpen: isMobileSidebarOpen(),
        floatingSidebarOpen: isFloatingSidebarOpen(),
      });
      if (action === "none") return;
      e.preventDefault();
      if (action === "close_modal") {
        onCloseModal();
        return;
      }
      if (action === "close_chat_search") {
        onCloseChatSearch();
        return;
      }
      if (action === "close_sidebar") {
        onCloseMobileSidebar();
        return;
      }
      if (action === "close_right_panel") {
        onCloseRightPanel();
        return;
      }
      if (action === "set_page_main") {
        onSetMainPage();
      }
      return;
    }

    if (e.key === "F10" && e.shiftKey) return;

    if (e.key.startsWith("F")) {
      e.preventDefault();
      onHotkey(e.key);
    }
  };

  const onHotkeysClick = (e: Event) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest("button[data-key]") as HTMLButtonElement | null;
    if (!btn) return;
    const key = btn.dataset.key || "";
    if (!key) return;
    onHotkey(key);
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    window.addEventListener("keydown", onWindowKeyDown);
    hotkeysRoot.addEventListener("click", onHotkeysClick);
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    window.removeEventListener("keydown", onWindowKeyDown);
    hotkeysRoot.removeEventListener("click", onHotkeysClick);
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
  };
}
