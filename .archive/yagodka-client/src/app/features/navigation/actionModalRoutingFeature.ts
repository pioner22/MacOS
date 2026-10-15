import { conversationKey } from "../../../helpers/chat/conversationKey";
import { getActiveConversationKey } from "../../../helpers/navigation/mainConversationState";
import type { Store } from "../../../stores/store";
import type { ActionModalPayload, AppState, PageKind, TargetRef } from "../../../stores/types";

export interface ActionModalRoutingFeatureDeps {
  store: Store<AppState>;
  closeMobileSidebar: () => void;
  setPage: (page: PageKind) => void;
  selectTarget: (target: TargetRef) => void;
  scrollToChatMsgIdx: (idx: number) => void;
}

export interface ActionModalRoutingFeature {
  openActionModal: (payload: ActionModalPayload) => void;
}

export function createActionModalRoutingFeature(deps: ActionModalRoutingFeatureDeps): ActionModalRoutingFeature {
  const { store, closeMobileSidebar, setPage, selectTarget, scrollToChatMsgIdx } = deps;

  const jumpToMessage = (findIdx: (msgs: any[]) => number) => {
    const attempt = () => {
      const st = store.get();
      const key = getActiveConversationKey(st);
      if (!key) return;
      const msgs = (st.conversations && (st.conversations as any)[key]) || [];
      const idx = findIdx(Array.isArray(msgs) ? msgs : []);
      if (idx < 0) return;
      scrollToChatMsgIdx(idx);
    };
    queueMicrotask(attempt);
    window.setTimeout(attempt, 0);
    window.setTimeout(attempt, 120);
  };

  const jumpToLocalId = (localId: string) =>
    jumpToMessage((msgs) => msgs.findIndex((msg: any) => String(msg?.localId ?? "") === localId));
  const jumpToFileId = (fileId: string) =>
    jumpToMessage((msgs) =>
      msgs.findIndex((msg: any) => msg?.attachment?.kind === "file" && String(msg?.attachment?.fileId ?? "") === fileId)
    );

  const openActionModal = (payload: ActionModalPayload) => {
    closeMobileSidebar();

    if (payload.kind === "auth_in" || payload.kind === "auth_out") {
      setPage("main");
      selectTarget({ kind: "dm", id: payload.peer });
      jumpToLocalId(`action:${payload.kind}:${payload.peer}`);
      return;
    }
    if (payload.kind === "group_invite") {
      setPage("main");
      selectTarget({ kind: "dm", id: payload.from });
      jumpToLocalId(`action:group_invite:${payload.groupId}:${payload.from}`);
      return;
    }
    if (payload.kind === "group_join_request") {
      setPage("main");
      selectTarget({ kind: "dm", id: payload.from });
      jumpToLocalId(`action:group_join_request:${payload.groupId}:${payload.from}`);
      return;
    }
    if (payload.kind === "board_invite") {
      setPage("main");
      selectTarget({ kind: "dm", id: payload.from });
      jumpToLocalId(`action:board_invite:${payload.boardId}:${payload.from}`);
      return;
    }
    if (payload.kind === "file_offer") {
      setPage("main");
      const room = String(payload.room ?? "").trim();
      if (room) {
        const kind = room.startsWith("grp-") ? "group" : "board";
        selectTarget({ kind, id: room });
      } else {
        selectTarget({ kind: "dm", id: payload.from });
      }
      jumpToFileId(payload.fileId);
      return;
    }

    // Fallback should be unreachable but keeps runtime behavior safe.
    store.set({ modal: { kind: "action", payload } });
  };

  return {
    openActionModal,
  };
}
