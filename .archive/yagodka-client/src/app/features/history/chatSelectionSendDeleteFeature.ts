import { updateOutboxEntry } from "../../../helpers/chat/outbox";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

type Selection = { key: string; messages: ChatMessage[]; ids: string[] } | null;

export interface ChatSelectionSendDeleteFeatureDeps {
  store: Store<AppState>;
  resolveChatSelection: (st: AppState) => Selection;
  messageSelectionKey: (msg: ChatMessage) => string | null;
  showToast: (message: string, opts?: { kind?: "info" | "success" | "warn" | "error" }) => void;
  scheduleSaveOutbox: () => void;
  drainOutbox: () => void;
  sendMessageDelete: (messageId: number) => void;
  savePinnedMessages: (userId: string, pinned: Record<string, number[]>) => void;
  outboxScheduleGraceMs: number;
}

export interface ChatSelectionSendDeleteFeature {
  handleChatSelectionSendNow: () => void;
  handleChatSelectionDelete: () => void;
}

export function createChatSelectionSendDeleteFeature(deps: ChatSelectionSendDeleteFeatureDeps): ChatSelectionSendDeleteFeature {
  const {
    store,
    resolveChatSelection,
    messageSelectionKey,
    showToast,
    scheduleSaveOutbox,
    drainOutbox,
    sendMessageDelete,
    savePinnedMessages,
    outboxScheduleGraceMs,
  } = deps;

  const handleChatSelectionSendNow = () => {
    const st = store.get();
    const selection = resolveChatSelection(st);
    if (!selection) return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const now = Date.now();
    const localIds: string[] = [];
    for (const msg of selection.messages) {
      if (msg?.kind !== "out") continue;
      const lid = typeof msg.localId === "string" ? msg.localId.trim() : "";
      if (!lid) continue;
      const scheduleAt = typeof msg.scheduleAt === "number" && Number.isFinite(msg.scheduleAt) ? Math.trunc(msg.scheduleAt) : 0;
      if ((scheduleAt && scheduleAt > now + outboxScheduleGraceMs) || msg.whenOnline) localIds.push(lid);
    }
    if (!localIds.length) {
      showToast("Нет запланированных сообщений в выборе", { kind: "info" });
      return;
    }
    const key = selection.key;
    store.set((prev) => {
      let outbox = prev.outbox;
      let conversations = prev.conversations;
      const cur = conversations[key] || [];
      let nextConv: ChatMessage[] | null = null;
      for (const lid of localIds) {
        outbox = updateOutboxEntry(outbox, key, lid, (entry) => {
          const { whenOnline, scheduleAt, ...rest } = entry as any;
          return rest;
        });
        if (Array.isArray(cur) && cur.length) {
          const idx = cur.findIndex((msg) => msg.kind === "out" && typeof msg.localId === "string" && msg.localId === lid);
          if (idx >= 0) {
            if (!nextConv) nextConv = [...cur];
            const { scheduleAt, whenOnline, ...rest } = nextConv[idx] as any;
            nextConv[idx] = { ...rest, status: nextConv[idx].status === "sent" ? nextConv[idx].status : "queued" };
          }
        }
      }
      if (nextConv) conversations = { ...conversations, [key]: nextConv };
      return { ...prev, outbox, conversations };
    });
    scheduleSaveOutbox();
    drainOutbox();
    showToast(`Отправляем сейчас: ${localIds.length}`, { kind: "info" });
  };

  const handleChatSelectionDelete = () => {
    const st = store.get();
    const selection = resolveChatSelection(st);
    if (!selection) return;
    const { key, messages, ids } = selection;
    const idSet = new Set(ids);
    const canRemoteDelete = Boolean(st.authed && st.conn === "connected");
    const outgoingIds = canRemoteDelete
      ? messages
          .filter((msg) => msg.kind === "out" && typeof msg.id === "number" && msg.id > 0 && st.selfId && String(msg.from) === String(st.selfId))
          .map((msg) => Math.trunc(Number(msg.id)))
      : [];
    let nextPinnedSnapshot: Record<string, number[]> | null = null;
    store.set((prev) => {
      const conv = prev.conversations[key] || [];
      if (!conv.length) return { ...prev, chatSelection: null };
      const nextConv = conv.filter((msg) => {
        const selId = messageSelectionKey(msg);
        return !(selId && idSet.has(selId));
      });
      let nextPinned = prev.pinnedMessages;
      let nextActive = prev.pinnedMessageActive;
      const curPinned = prev.pinnedMessages[key];
      if (Array.isArray(curPinned) && curPinned.length) {
        const remaining = new Set<number>();
        for (const msg of nextConv) {
          const id = typeof msg.id === "number" && Number.isFinite(msg.id) ? Math.trunc(msg.id) : 0;
          if (id > 0) remaining.add(id);
        }
        const nextList = curPinned.filter((id) => remaining.has(id));
        if (nextList.length !== curPinned.length) {
          nextPinned = { ...prev.pinnedMessages };
          nextActive = { ...prev.pinnedMessageActive };
          if (nextList.length) {
            nextPinned[key] = nextList;
            if (!nextList.includes(nextActive[key])) nextActive[key] = nextList[0];
          } else {
            delete nextPinned[key];
            delete nextActive[key];
          }
          nextPinnedSnapshot = nextPinned;
        }
      }
      return {
        ...prev,
        conversations: { ...prev.conversations, [key]: nextConv },
        pinnedMessages: nextPinned,
        pinnedMessageActive: nextActive,
        chatSelection: null,
      };
    });
    if (nextPinnedSnapshot && st.selfId) savePinnedMessages(st.selfId, nextPinnedSnapshot);
    outgoingIds.forEach((id) => sendMessageDelete(id));
  };

  return {
    handleChatSelectionSendNow,
    handleChatSelectionDelete,
  };
}
