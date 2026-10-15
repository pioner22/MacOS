import type { Store } from "../../../stores/store";
import type { AppState, PageKind } from "../../../stores/types";

export interface HotkeyActionsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  closeMobileSidebar: () => void;
  closeModal: () => void;
  setPage: (page: PageKind) => void;
  logout: () => void;
  openGroupCreateModal: () => void;
  openBoardCreateModal: () => void;
  toggleDebugHud: () => boolean;
}

export interface HotkeyActionsFeature {
  handleHotkey: (key: string) => void;
}

export function createHotkeyActionsFeature(deps: HotkeyActionsFeatureDeps): HotkeyActionsFeature {
  const {
    store,
    send,
    closeMobileSidebar,
    closeModal,
    setPage,
    logout,
    openGroupCreateModal,
    openBoardCreateModal,
    toggleDebugHud,
  } = deps;

  function handleHotkey(key: string) {
    const st = store.get();
    if (st.modal && st.modal.kind !== "auth") return;

    closeMobileSidebar();

    if (key === "F1") {
      if (st.modal) closeModal();
      setPage("help");
      return;
    }

    if (key === "F10") {
      if (st.authed) {
        logout();
        return;
      }
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        modal: { kind: "auth" },
      }));
      return;
    }

    if (!st.authed) return;

    if (key === "F2") {
      setPage("profile");
      send({ type: "profile_get" });
      return;
    }

    if (key === "F3") {
      setPage("search");
      return;
    }

    if (key === "F5") {
      openGroupCreateModal();
      return;
    }

    if (key === "F6") {
      openBoardCreateModal();
      return;
    }

    if (key === "F7") {
      setPage("files");
      return;
    }

    if (key === "F12") {
      const enabled = toggleDebugHud();
      store.set({ status: enabled ? "Debug HUD: включён" : "Debug HUD: выключен" });
    }
  }

  return { handleHotkey };
}
