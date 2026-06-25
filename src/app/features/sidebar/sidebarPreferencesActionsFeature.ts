import { sanitizeChatFoldersSnapshot } from "../../../helpers/chat/folders";
import {
  setSidebarArchiveOpenValue,
  setSidebarFolderId,
  setSidebarQueryValue,
} from "../../../helpers/sidebar/sidebarState";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface SidebarPreferencesActionsFeatureDeps {
  store: Store<AppState>;
  sidebarBody: HTMLElement;
  send: (payload: any) => void;
  saveChatFoldersForUser: (selfId: string, snapshot: any) => void;
}

export interface SidebarPreferencesActionsFeature {
  onSetSidebarFolderId: (folderId: string) => void;
  onSetSidebarQuery: (query: string) => void;
  onToggleSidebarArchive: () => void;
}

export function createSidebarPreferencesActionsFeature(
  deps: SidebarPreferencesActionsFeatureDeps
): SidebarPreferencesActionsFeature {
  const { store, sidebarBody, send, saveChatFoldersForUser } = deps;

  const onSetSidebarFolderId = (folderId: string) => {
    const st = store.get();
    const active = String(folderId || "").trim().toLowerCase() || "all";
    const snap = sanitizeChatFoldersSnapshot({ v: 1, active, folders: st.chatFolders });
    if (st.sidebarFolderId === snap.active) return;
    store.set((prev) => setSidebarFolderId(prev, snap.active));
    if (st.selfId) saveChatFoldersForUser(st.selfId, snap);
    if (st.conn === "connected" && st.authed) {
      send({ type: "prefs_set", values: { chat_folders: snap } });
    }
  };

  const onSetSidebarQuery = (query: string) => {
    const q = String(query ?? "");
    if (store.get().sidebarQuery === q) return;
    store.set((prev) => setSidebarQueryValue(prev, q));
  };

  const onToggleSidebarArchive = () => {
    const nextOpen = !store.get().sidebarArchiveOpen;
    if (nextOpen) {
      try {
        sidebarBody.dataset.sidebarResetScroll = "1";
      } catch {
        // ignore
      }
    }
    store.set((prev) => setSidebarArchiveOpenValue(prev, !prev.sidebarArchiveOpen));
  };

  return {
    onSetSidebarFolderId,
    onSetSidebarQuery,
    onToggleSidebarArchive,
  };
}
