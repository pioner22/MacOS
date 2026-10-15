import { dmKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

export interface GroupBoardJoinFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
}

export interface GroupBoardJoinFeature {
  joinGroup: (groupId: string) => void;
  joinBoard: (boardId: string) => void;
  acceptGroupInvite: (groupId: string, fromHint?: string) => void;
  declineGroupInvite: (groupId: string, fromHint?: string) => void;
}

function replaceGroupInviteActionMessage(
  prev: AppState,
  groupId: string,
  from: string,
  text: string
): { hasUpdate: boolean; conversations: AppState["conversations"] } {
  const peer = String(from || "").trim();
  if (!peer) {
    return { hasUpdate: false, conversations: prev.conversations };
  }
  const key = dmKey(peer);
  const conv = prev.conversations[key] || [];
  const localId = `action:group_invite:${groupId}:${peer}`;
  const idx = conv.findIndex((msg) => String(msg.localId || "") === localId);
  if (idx < 0) {
    return { hasUpdate: false, conversations: prev.conversations };
  }
  const nextConv: ChatMessage[] = [
    ...conv.slice(0, idx),
    { ...conv[idx], text, attachment: null },
    ...conv.slice(idx + 1),
  ];
  return {
    hasUpdate: true,
    conversations: { ...prev.conversations, [key]: nextConv },
  };
}

export function createGroupBoardJoinFeature(deps: GroupBoardJoinFeatureDeps): GroupBoardJoinFeature {
  const { store, send } = deps;

  const joinGroup = (groupId: string) => {
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (st.groups.some((group) => group.id === groupId)) {
      store.set({ status: `Вы уже участник: ${groupId}` });
      return;
    }
    send({ type: "group_join_request", group_id: groupId });
    store.set({ status: `Запрос на вступление: ${groupId}` });
  };

  const joinBoard = (boardId: string) => {
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (st.boards.some((board) => board.id === boardId)) {
      store.set({ status: `Вы уже участник: ${boardId}` });
      return;
    }
    send({ type: "board_join", board_id: boardId });
    store.set({ status: `Вступление в доску: ${boardId}` });
  };

  const acceptGroupInvite = (groupId: string, fromHint = "") => {
    send({ type: "group_invite_response", group_id: groupId, accept: true });
    store.set((prev) => {
      const invite = prev.pendingGroupInvites.find((item) => item.groupId === groupId);
      const from = String(fromHint || invite?.from || "").trim();
      const patched = replaceGroupInviteActionMessage(prev, groupId, from, `Приглашение принято: ${groupId}`);
      return {
        ...prev,
        pendingGroupInvites: prev.pendingGroupInvites.filter((item) => item.groupId !== groupId),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Принято приглашение: ${groupId}`,
      };
    });
  };

  const declineGroupInvite = (groupId: string, fromHint = "") => {
    send({ type: "group_invite_response", group_id: groupId, accept: false });
    store.set((prev) => {
      const invite = prev.pendingGroupInvites.find((item) => item.groupId === groupId);
      const from = String(fromHint || invite?.from || "").trim();
      const patched = replaceGroupInviteActionMessage(prev, groupId, from, `Приглашение отклонено: ${groupId}`);
      return {
        ...prev,
        pendingGroupInvites: prev.pendingGroupInvites.filter((item) => item.groupId !== groupId),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Отклонено приглашение: ${groupId}`,
      };
    });
  };

  return {
    joinGroup,
    joinBoard,
    acceptGroupInvite,
    declineGroupInvite,
  };
}
