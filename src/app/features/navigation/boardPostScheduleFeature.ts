import { conversationKey } from "../../../helpers/chat/conversationKey";
import { upsertConversation } from "../../../helpers/chat/upsertConversation";
import { addOutboxEntry, makeOutboxLocalId } from "../../../helpers/chat/outbox";
import { nowTs } from "../../../helpers/time";
import type { Store } from "../../../stores/store";
import type { AppState, BoardScheduledPost, TargetRef } from "../../../stores/types";

export interface BoardPostScheduleFeatureDeps {
  store: Store<AppState>;
  appMsgMaxLen: number;
  send: (payload: any) => boolean;
  markUserInput: () => void;
  markChatAutoScroll: (key: string, waitForHistory?: boolean) => void;
  scheduleSaveOutbox: () => void;
  showToast: (message: string, opts?: any) => void;
  saveBoardScheduleForUser: (userId: string, entries: BoardScheduledPost[]) => void;
}

export interface BoardPostScheduleFeature {
  openBoardPostModal: (boardId: string) => void;
  publishBoardPost: (text: string) => void;
  clearBoardScheduleTimer: () => void;
  armBoardScheduleTimer: () => void;
}

export function createBoardPostScheduleFeature(deps: BoardPostScheduleFeatureDeps): BoardPostScheduleFeature {
  const {
    store,
    appMsgMaxLen,
    send,
    markUserInput,
    markChatAutoScroll,
    scheduleSaveOutbox,
    showToast,
    saveBoardScheduleForUser,
  } = deps;

  let boardScheduleTimer: number | null = null;
  let boardScheduleNextAt = 0;

  const clearBoardScheduleTimer = () => {
    if (boardScheduleTimer !== null) {
      window.clearTimeout(boardScheduleTimer);
      boardScheduleTimer = null;
    }
    boardScheduleNextAt = 0;
  };

  const sendScheduledBoardPost = (boardId: string, text: string) => {
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    const bid = String(boardId || "").trim();
    const body = String(text || "").trimEnd();
    if (!bid || !body.trim()) return;

    const board = (st.boards || []).find((x) => x.id === bid);
    if (!board) {
      showToast(`Запланированный пост: доска не найдена (${bid})`, { kind: "warn" });
      return;
    }
    const owner = String(board.owner_id || "").trim();
    const me = String(st.selfId || "").trim();
    if (owner && me && owner !== me) {
      showToast("Запланированный пост: писать может только владелец", { kind: "warn" });
      return;
    }

    const target: TargetRef = { kind: "board", id: bid };
    const convKey = conversationKey(target);
    const localId = makeOutboxLocalId();
    const ts = nowTs();
    const nowMs = Date.now();
    const payload = { type: "send" as const, room: bid, text: body };
    const sent = st.conn === "connected" ? send(payload) : false;
    const initialStatus = sent ? ("sending" as const) : ("queued" as const);

    const localMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      room: bid,
      text: body,
      ts,
      localId,
      id: null,
      status: initialStatus,
    };

    store.set((prev) => {
      const next = upsertConversation(prev, convKey, localMsg);
      const outbox = addOutboxEntry(next.outbox, convKey, {
        localId,
        ts,
        text: body,
        room: bid,
        status: sent ? "sending" : "queued",
        attempts: sent ? 1 : 0,
        lastAttemptAt: sent ? nowMs : 0,
      });
      return { ...next, outbox };
    });
    scheduleSaveOutbox();
  };

  const drainBoardSchedule = () => {
    const st = store.get();
    if (!st.authed || !st.selfId) {
      clearBoardScheduleTimer();
      return;
    }
    const list = Array.isArray(st.boardScheduledPosts) ? st.boardScheduledPosts : [];
    if (!list.length) {
      clearBoardScheduleTimer();
      return;
    }
    const now = Date.now();
    const due = list.filter((x) => x.scheduleAt <= now + 1200);
    if (!due.length) {
      armBoardScheduleTimer();
      return;
    }
    const dueIds = new Set(due.map((x) => x.id));
    const remaining = list.filter((x) => !dueIds.has(x.id));

    for (const item of due.sort((a, b) => a.scheduleAt - b.scheduleAt)) {
      sendScheduledBoardPost(item.boardId, item.text);
    }

    store.set((prev) => ({ ...prev, boardScheduledPosts: remaining }));
    saveBoardScheduleForUser(st.selfId, remaining);
    if (due.length === 1) showToast("Опубликован запланированный пост", { kind: "success" });
    else showToast(`Опубликовано запланированных постов: ${due.length}`, { kind: "success" });

    armBoardScheduleTimer();
  };

  const armBoardScheduleTimer = () => {
    const st = store.get();
    if (!st.authed || !st.selfId) {
      clearBoardScheduleTimer();
      return;
    }
    const list = Array.isArray(st.boardScheduledPosts) ? st.boardScheduledPosts : [];
    if (!list.length) {
      clearBoardScheduleTimer();
      return;
    }
    const nextAt = list.reduce((min, item) => (item.scheduleAt && item.scheduleAt < min ? item.scheduleAt : min), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextAt) || nextAt <= 0) {
      clearBoardScheduleTimer();
      return;
    }
    if (boardScheduleTimer !== null && boardScheduleNextAt === nextAt) return;
    clearBoardScheduleTimer();
    boardScheduleNextAt = nextAt;
    const now = Date.now();
    const delay = Math.max(0, nextAt - now);
    boardScheduleTimer = window.setTimeout(() => {
      boardScheduleTimer = null;
      boardScheduleNextAt = 0;
      drainBoardSchedule();
    }, delay);
  };

  const openBoardPostModal = (boardId: string) => {
    const bid = String(boardId || "").trim();
    if (!bid) return;
    const st = store.get();
    if (st.modal && st.modal.kind !== "context_menu") return;
    markUserInput();
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const board = (st.boards || []).find((x) => x.id === bid);
    if (!board) {
      store.set({ status: `Доска не найдена: ${bid}` });
      return;
    }
    const owner = String(board.owner_id || "").trim();
    const me = String(st.selfId || "").trim();
    if (owner && me && owner !== me) {
      store.set({ status: "На доске писать может только владелец" });
      return;
    }
    store.set({ modal: { kind: "board_post", boardId: bid } });
  };

  const publishBoardPost = (text: string) => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "board_post") return;
    const boardId = String(modal.boardId || "").trim();
    const body = String(text ?? "").trimEnd();
    markUserInput();
    if (!boardId) {
      store.set({ status: "Некорректная доска" });
      return;
    }
    if (!body) return;
    if (body.length > appMsgMaxLen) {
      store.set({ status: `Слишком длинный пост (${body.length}/${appMsgMaxLen})` });
      return;
    }
    if (!st.authed || !st.selfId) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения: пост в очереди" });
    }
    const board = (st.boards || []).find((x) => x.id === boardId);
    if (!board) {
      store.set({ status: `Доска не найдена: ${boardId}` });
      return;
    }
    const owner = String(board.owner_id || "").trim();
    const me = String(st.selfId || "").trim();
    if (owner && me && owner !== me) {
      store.set({ status: "На доске писать может только владелец" });
      return;
    }

    const target: TargetRef = { kind: "board", id: boardId };
    const convKey = conversationKey(target);
    if (convKey) markChatAutoScroll(convKey, false);
    const localId = makeOutboxLocalId();
    const ts = nowTs();
    const nowMs = Date.now();
    const payload = { type: "send" as const, room: boardId, text: body };
    const sent = st.conn === "connected" ? send(payload) : false;
    const initialStatus = sent ? ("sending" as const) : ("queued" as const);

    const localMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      room: boardId,
      text: body,
      ts,
      localId,
      id: null,
      status: initialStatus,
    };

    store.set((prev) => {
      const next = upsertConversation(prev, convKey, localMsg);
      const outbox = addOutboxEntry(next.outbox, convKey, {
        localId,
        ts,
        text: body,
        room: boardId,
        status: sent ? "sending" : "queued",
        attempts: sent ? 1 : 0,
        lastAttemptAt: sent ? nowMs : 0,
      });
      return { ...next, outbox, modal: null };
    });
    scheduleSaveOutbox();

    store.set({ status: sent ? "Пост отправляется…" : "Нет соединения: пост в очереди" });
  };

  return {
    openBoardPostModal,
    publishBoardPost,
    clearBoardScheduleTimer,
    armBoardScheduleTimer,
  };
}
