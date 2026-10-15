import { conversationKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";

export interface SearchHistoryActionsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  savePinsForUser: (selfId: string, pins: string[]) => void;
  savePinnedMessagesForUser: (selfId: string, pinnedMessages: any) => void;
}

export interface SearchHistoryActionsFeature {
  onSearchPinToggle: (targets: TargetRef[]) => void;
  onSearchHistoryDelete: (items: Array<{ target: TargetRef; idx: number }>, mode: "local" | "remote") => void;
}

export function createSearchHistoryActionsFeature(
  deps: SearchHistoryActionsFeatureDeps
): SearchHistoryActionsFeature {
  const { store, send, savePinsForUser, savePinnedMessagesForUser } = deps;

  const onSearchPinToggle = (targets: TargetRef[]) => {
    const list = Array.isArray(targets) ? targets : [];
    if (!list.length) return;
    const st = store.get();
    const keys = Array.from(new Set(list.map((t) => conversationKey(t)).filter(Boolean)));
    if (!keys.length) return;
    const allPinned = keys.every((k) => st.pinned.includes(k));
    let nextPins = st.pinned;
    let changed = false;
    for (const key of keys) {
      const isPinned = nextPins.includes(key);
      if (allPinned) {
        if (!isPinned) continue;
        nextPins = nextPins.filter((x) => x !== key);
        changed = true;
      } else if (!isPinned) {
        nextPins = [key, ...nextPins];
        changed = true;
      }
    }
    if (!changed) return;
    store.set({ pinned: nextPins });
    if (st.selfId) savePinsForUser(st.selfId, nextPins);
  };

  const onSearchHistoryDelete = (items: Array<{ target: TargetRef; idx: number }>, mode: "local" | "remote") => {
    if (!Array.isArray(items) || !items.length) return;
    const st = store.get();
    if (mode === "remote") {
      if (st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        return;
      }
    }
    const grouped = new Map<string, Array<{ target: TargetRef; idx: number }>>();
    for (const item of items) {
      const key = conversationKey(item.target);
      if (!key) continue;
      const list = grouped.get(key);
      if (list) list.push(item);
      else grouped.set(key, [item]);
    }
    if (!grouped.size) return;
    if (mode === "remote") {
      const ids: number[] = [];
      for (const [key, list] of grouped) {
        const conv = st.conversations[key];
        if (!Array.isArray(conv)) continue;
        for (const entry of list) {
          const msg = conv[entry.idx];
          const id = typeof msg?.id === "number" ? msg.id : null;
          if (id && id > 0) ids.push(id);
        }
      }
      if (!ids.length) return;
      ids.forEach((id) => send({ type: "message_delete", id }));
      return;
    }
    store.set((prev) => {
      const nextConversations = { ...prev.conversations };
      const nextPinned = { ...prev.pinnedMessages };
      const nextActive = { ...prev.pinnedMessageActive };
      for (const [key, list] of grouped) {
        const cur = nextConversations[key];
        if (!Array.isArray(cur) || !cur.length) continue;
        const removeIdx = new Set<number>();
        const removedIds = new Set<number>();
        for (const entry of list) {
          const idx = entry.idx;
          if (idx < 0 || idx >= cur.length) continue;
          removeIdx.add(idx);
          const msg = cur[idx];
          if (typeof msg?.id === "number") removedIds.add(msg.id);
        }
        if (!removeIdx.size) continue;
        nextConversations[key] = cur.filter((_, i) => !removeIdx.has(i));
        if (removedIds.size) {
          const pinned = nextPinned[key];
          if (Array.isArray(pinned) && pinned.length) {
            const nextList = pinned.filter((id) => !removedIds.has(id));
            if (nextList.length) {
              nextPinned[key] = nextList;
              if (!nextList.includes(nextActive[key])) nextActive[key] = nextList[0];
            } else {
              delete nextPinned[key];
              delete nextActive[key];
            }
          }
        }
      }
      if (prev.selfId) savePinnedMessagesForUser(prev.selfId, nextPinned);
      return {
        ...prev,
        conversations: nextConversations,
        pinnedMessages: nextPinned,
        pinnedMessageActive: nextActive,
      };
    });
  };

  return {
    onSearchPinToggle,
    onSearchHistoryDelete,
  };
}
