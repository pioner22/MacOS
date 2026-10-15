import { dmKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

export interface RoomInviteResponsesFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
}

export interface RoomInviteResponsesFeature {
  acceptGroupJoin: (groupId: string, peer: string) => void;
  declineGroupJoin: (groupId: string, peer: string) => void;
  joinBoardFromInvite: (boardId: string) => void;
  declineBoardInvite: (boardId: string) => void;
}

function replaceDmActionMessage(
  prev: AppState,
  peer: string,
  localId: string,
  text: string
): { hasUpdate: boolean; conversations: AppState["conversations"] } {
  const id = String(peer || "").trim();
  if (!id) {
    return { hasUpdate: false, conversations: prev.conversations };
  }
  const key = dmKey(id);
  const conv = prev.conversations[key] || [];
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

export function createRoomInviteResponsesFeature(deps: RoomInviteResponsesFeatureDeps): RoomInviteResponsesFeature {
  const { store, send } = deps;

  const acceptGroupJoin = (groupId: string, peer: string) => {
    send({ type: "group_join_response", group_id: groupId, peer, accept: true });
    store.set((prev) => {
      const localId = `action:group_join_request:${groupId}:${peer}`;
      const patched = replaceDmActionMessage(prev, peer, localId, `Запрос принят: ${peer}`);
      return {
        ...prev,
        pendingGroupJoinRequests: prev.pendingGroupJoinRequests.filter((req) => !(req.groupId === groupId && req.from === peer)),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Принят запрос: ${peer}`,
      };
    });
  };

  const declineGroupJoin = (groupId: string, peer: string) => {
    send({ type: "group_join_response", group_id: groupId, peer, accept: false });
    store.set((prev) => {
      const localId = `action:group_join_request:${groupId}:${peer}`;
      const patched = replaceDmActionMessage(prev, peer, localId, `Запрос отклонён: ${peer}`);
      return {
        ...prev,
        pendingGroupJoinRequests: prev.pendingGroupJoinRequests.filter((req) => !(req.groupId === groupId && req.from === peer)),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Отклонён запрос: ${peer}`,
      };
    });
  };

  const joinBoardFromInvite = (boardId: string) => {
    send({ type: "board_invite_response", board_id: boardId, accept: true });
    store.set((prev) => {
      const invite = prev.pendingBoardInvites.find((item) => item.boardId === boardId);
      const from = String(invite?.from || "").trim();
      const localId = `action:board_invite:${boardId}:${from}`;
      const patched = replaceDmActionMessage(prev, from, localId, `Приглашение принято: ${boardId}`);
      return {
        ...prev,
        pendingBoardInvites: prev.pendingBoardInvites.filter((item) => item.boardId !== boardId),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Вступление в доску: ${boardId}`,
      };
    });
  };

  const declineBoardInvite = (boardId: string) => {
    send({ type: "board_invite_response", board_id: boardId, accept: false });
    store.set((prev) => {
      const invite = prev.pendingBoardInvites.find((item) => item.boardId === boardId);
      const from = String(invite?.from || "").trim();
      const localId = `action:board_invite:${boardId}:${from}`;
      const patched = replaceDmActionMessage(prev, from, localId, `Приглашение отклонено: ${boardId}`);
      return {
        ...prev,
        pendingBoardInvites: prev.pendingBoardInvites.filter((item) => item.boardId !== boardId),
        ...(patched.hasUpdate ? { conversations: patched.conversations } : {}),
        modal: null,
        status: `Отклонено приглашение: ${boardId}`,
      };
    });
  };

  return {
    acceptGroupJoin,
    declineGroupJoin,
    joinBoardFromInvite,
    declineBoardInvite,
  };
}
