import type { Store } from "../../../stores/store";
import type { AppState, ConfirmAction, TargetRef } from "../../../stores/types";

export interface RoomModerationActionsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  openConfirmModal: (payload: {
    title: string;
    message: string;
    action: ConfirmAction;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => void;
  showToast: (message: string, opts?: any) => void;
  saveRoomInfo: (kind: TargetRef["kind"], roomId: string, description: string, rules: string) => void;
}

export interface RoomModerationActionsFeature {
  onRoomMemberRemove: (kind: TargetRef["kind"], roomId: string, memberId: string) => void;
  onBlockToggle: (memberId: string) => void;
  onRoomWriteToggle: (kind: TargetRef["kind"], roomId: string, memberId: string, value: boolean) => void;
  onRoomRefresh: (kind: TargetRef["kind"], roomId: string) => void;
  onRoomInfoSave: (kind: TargetRef["kind"], roomId: string, description: string, rules: string) => void;
  onRoomLeave: (kind: TargetRef["kind"], roomId: string) => void;
  onRoomDisband: (kind: TargetRef["kind"], roomId: string) => void;
}

export function createRoomModerationActionsFeature(
  deps: RoomModerationActionsFeatureDeps
): RoomModerationActionsFeature {
  const { store, send, openConfirmModal, showToast, saveRoomInfo } = deps;

  const onRoomMemberRemove = (kind: TargetRef["kind"], roomId: string, memberId: string) => {
    const st = store.get();
    const rid = String(roomId || "").trim();
    const mid = String(memberId || "").trim();
    if (!rid || !mid) return;
    if (st.conn !== "connected" || !st.authed) {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (kind === "group") {
      const g = st.groups.find((x) => x.id === rid);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может удалять участников" });
        return;
      }
      openConfirmModal({
        title: "Удалить участника?",
        message: `Удалить ${mid} из чата?`,
        confirmLabel: "Удалить",
        danger: true,
        action: { kind: "group_member_remove", groupId: rid, memberId: mid },
      });
      return;
    }
    if (kind === "board") {
      const b = st.boards.find((x) => x.id === rid);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может удалять участников" });
        return;
      }
      openConfirmModal({
        title: "Удалить участника?",
        message: `Удалить ${mid} из доски?`,
        confirmLabel: "Удалить",
        danger: true,
        action: { kind: "board_member_remove", boardId: rid, memberId: mid },
      });
    }
  };

  const onBlockToggle = (memberId: string) => {
    const st = store.get();
    const mid = String(memberId || "").trim();
    if (!mid) return;
    if (st.conn !== "connected" || !st.authed) {
      store.set({ status: "Нет соединения" });
      return;
    }
    const nextValue = !st.blocked.includes(mid);
    send({ type: "block_set", peer: mid, value: nextValue });
    showToast(nextValue ? `Заблокировано: ${mid}` : `Разблокировано: ${mid}`, {
      kind: nextValue ? "warn" : "info",
      undo: () => send({ type: "block_set", peer: mid, value: !nextValue }),
    });
  };

  const onRoomWriteToggle = (kind: TargetRef["kind"], roomId: string, memberId: string, value: boolean) => {
    const st = store.get();
    const rid = String(roomId || "").trim();
    const mid = String(memberId || "").trim();
    if (!rid || !mid) return;
    if (kind !== "group") return;
    if (st.conn !== "connected" || !st.authed) {
      store.set({ status: "Нет соединения" });
      return;
    }
    const g = st.groups.find((x) => x.id === rid);
    const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
    if (!isOwner) {
      store.set({ status: "Только владелец может менять права" });
      return;
    }
    if (mid === st.selfId) {
      store.set({ status: "Нельзя запретить писать владельцу" });
      return;
    }
    send({ type: "group_post_set", group_id: rid, member_id: mid, value });
    showToast(value ? `Запрет писать: ${mid}` : `Разрешено писать: ${mid}`, {
      kind: value ? "warn" : "info",
      undo: () => send({ type: "group_post_set", group_id: rid, member_id: mid, value: !value }),
    });
  };

  const onRoomRefresh = (kind: TargetRef["kind"], roomId: string) => {
    const st = store.get();
    const rid = String(roomId || "").trim();
    if (!rid || st.conn !== "connected" || !st.authed) {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (kind === "group") send({ type: "group_info", group_id: rid });
    else if (kind === "board") send({ type: "board_info", board_id: rid });
  };

  const onRoomInfoSave = (kind: TargetRef["kind"], roomId: string, description: string, rules: string) => {
    saveRoomInfo(kind, roomId, description, rules);
  };

  const onRoomLeave = (kind: TargetRef["kind"], roomId: string) => {
    const st = store.get();
    const rid = String(roomId || "").trim();
    if (!rid) return;
    if (st.conn !== "connected" || !st.authed) {
      store.set({ status: "Нет соединения" });
      return;
    }
    const entry = kind === "group" ? st.groups.find((x) => x.id === rid) : st.boards.find((x) => x.id === rid);
    const name = String(entry?.name || rid);
    const ownerId = String(entry?.owner_id || "");
    const isOwner = Boolean(ownerId && st.selfId && String(ownerId) === String(st.selfId));
    if (isOwner) {
      store.set({ status: `Создатель не может покинуть ${kind === "group" ? "чат" : "доску"} — удалите её` });
      return;
    }
    if (kind === "group") {
      openConfirmModal({
        title: "Покинуть чат?",
        message: `Покинуть чат «${name}»?`,
        confirmLabel: "Выйти",
        danger: true,
        action: { kind: "group_leave", groupId: rid },
      });
    } else if (kind === "board") {
      openConfirmModal({
        title: "Покинуть доску?",
        message: `Покинуть доску «${name}»?`,
        confirmLabel: "Выйти",
        danger: true,
        action: { kind: "board_leave", boardId: rid },
      });
    }
  };

  const onRoomDisband = (kind: TargetRef["kind"], roomId: string) => {
    const st = store.get();
    const rid = String(roomId || "").trim();
    if (!rid) return;
    if (st.conn !== "connected" || !st.authed) {
      store.set({ status: "Нет соединения" });
      return;
    }
    const entry = kind === "group" ? st.groups.find((x) => x.id === rid) : st.boards.find((x) => x.id === rid);
    const name = String(entry?.name || rid);
    const ownerId = String(entry?.owner_id || "");
    const isOwner = Boolean(ownerId && st.selfId && String(ownerId) === String(st.selfId));
    if (!isOwner) {
      store.set({ status: "Только владелец может удалить чат/доску" });
      return;
    }
    if (kind === "group") {
      openConfirmModal({
        title: "Удалить чат?",
        message: `Удалить чат «${name}» для всех?`,
        confirmLabel: "Удалить",
        danger: true,
        action: { kind: "group_disband", groupId: rid },
      });
    } else if (kind === "board") {
      openConfirmModal({
        title: "Удалить доску?",
        message: `Удалить доску «${name}» для всех?`,
        confirmLabel: "Удалить",
        danger: true,
        action: { kind: "board_disband", boardId: rid },
      });
    }
  };

  return {
    onRoomMemberRemove,
    onBlockToggle,
    onRoomWriteToggle,
    onRoomRefresh,
    onRoomInfoSave,
    onRoomLeave,
    onRoomDisband,
  };
}
