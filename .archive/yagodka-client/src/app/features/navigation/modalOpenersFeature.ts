import type { Store } from "../../../stores/store";
import type { AppState, ConfirmAction } from "../../../stores/types";
import { openAuthModal, openCreatePageState, openModalState } from "../../../helpers/navigation/appShellState";

type RoomTargetKind = "group" | "board";

export interface ModalOpenersFeatureDeps {
  store: Store<AppState>;
  closeMobileSidebar: () => void;
  resetCreateMembers: (scope: "group_create" | "board_create") => void;
  prepareMembersChips?: () => void;
}

export interface ModalOpenersFeature {
  openGroupCreateModal: () => void;
  openBoardCreateModal: () => void;
  openMembersAddModal: (targetKind: RoomTargetKind, targetId: string) => void;
  openMembersRemoveModal: (targetKind: RoomTargetKind, targetId: string) => void;
  openRenameModal: (targetKind: RoomTargetKind, targetId: string) => void;
  openConfirmModal: (payload: {
    title: string;
    message: string;
    action: ConfirmAction;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => void;
}

export function createModalOpenersFeature(deps: ModalOpenersFeatureDeps): ModalOpenersFeature {
  const { store, closeMobileSidebar, resetCreateMembers, prepareMembersChips } = deps;

  const resolveRoomTitle = (targetKind: RoomTargetKind, targetId: string) => {
    const st = store.get();
    const entry = targetKind === "group" ? st.groups.find((group) => group.id === targetId) : st.boards.find((board) => board.id === targetId);
    const name = String(entry?.name || targetId);
    const title = targetKind === "group" ? `Чат: ${name}` : `Доска: ${name}`;
    const currentName = entry?.name ? String(entry.name) : null;
    return { title, currentName };
  };

  const openGroupCreateModal = () => {
    closeMobileSidebar();
    prepareMembersChips?.();
    const st = store.get();
    if (!st.authed) {
      store.set((prev) => openAuthModal(prev, { message: "Сначала войдите или зарегистрируйтесь" }));
      return;
    }
    resetCreateMembers("group_create");
    store.set((prev) => openCreatePageState(prev, "group_create"));
  };

  const openBoardCreateModal = () => {
    closeMobileSidebar();
    prepareMembersChips?.();
    const st = store.get();
    if (!st.authed) {
      store.set((prev) => openAuthModal(prev, { message: "Сначала войдите или зарегистрируйтесь" }));
      return;
    }
    resetCreateMembers("board_create");
    store.set((prev) => openCreatePageState(prev, "board_create"));
  };

  const openMembersAddModal = (targetKind: RoomTargetKind, targetId: string) => {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    prepareMembersChips?.();
    const { title } = resolveRoomTitle(targetKind, targetId);
    store.set((prev) => openModalState(prev, { kind: "members_add", targetKind, targetId, title }));
  };

  const openMembersRemoveModal = (targetKind: RoomTargetKind, targetId: string) => {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    const { title } = resolveRoomTitle(targetKind, targetId);
    store.set((prev) => openModalState(prev, { kind: "members_remove", targetKind, targetId, title }));
  };

  const openRenameModal = (targetKind: RoomTargetKind, targetId: string) => {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    const { title, currentName } = resolveRoomTitle(targetKind, targetId);
    store.set((prev) => openModalState(prev, { kind: "rename", targetKind, targetId, title, currentName }));
  };

  const openConfirmModal = (payload: {
    title: string;
    message: string;
    action: ConfirmAction;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => {
    closeMobileSidebar();
    store.set((prev) => openModalState(prev, { kind: "confirm", ...payload }));
  };

  return {
    openGroupCreateModal,
    openBoardCreateModal,
    openMembersAddModal,
    openMembersRemoveModal,
    openRenameModal,
    openConfirmModal,
  };
}
