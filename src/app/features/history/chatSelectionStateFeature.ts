import { conversationKey } from "../../../helpers/chat/conversationKey";
import { messageSelectionKey } from "../../../helpers/chat/chatSelection";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

export interface ChatSelectionStateFeatureDeps {
  store: Store<AppState>;
  resetSelectionAnchor: () => void;
}

export interface ChatSelectionStateFeature {
  isChatMessageSelectable: (msg: ChatMessage | null | undefined) => msg is ChatMessage;
  clearChatSelection: () => void;
  toggleChatSelection: (key: string, msg: ChatMessage) => void;
  addChatSelectionRange: (key: string, fromIdx: number, toIdx: number) => void;
  setChatSelectionRangeValue: (key: string, fromIdx: number, toIdx: number, value: boolean) => void;
  setChatSelectionValueAtIdx: (key: string, idx: number, value: boolean) => void;
  resolveChatSelection: (st: AppState) => { key: string; messages: ChatMessage[]; ids: string[] } | null;
}

export function createChatSelectionStateFeature(deps: ChatSelectionStateFeatureDeps): ChatSelectionStateFeature {
  const { store, resetSelectionAnchor } = deps;

  const isChatMessageSelectable = (msg: ChatMessage | null | undefined): msg is ChatMessage => {
    if (!msg) return false;
    if (msg.kind === "sys") return false;
    if (msg.attachment?.kind === "action") return false;
    if (msg.status === "sending" || msg.status === "queued" || msg.status === "error") return false;
    return true;
  };

  const clearChatSelection = () => {
    resetSelectionAnchor();
    store.set((prev) => {
      if (!prev.chatSelection) return prev;
      return { ...prev, chatSelection: null };
    });
  };

  const toggleChatSelection = (key: string, msg: ChatMessage) => {
    const selId = messageSelectionKey(msg);
    if (!selId) return;
    store.set((prev) => {
      const current = prev.chatSelection;
      const sameKey = current && current.key === key;
      const ids = sameKey ? [...current.ids] : [];
      const idx = ids.indexOf(selId);
      if (idx >= 0) ids.splice(idx, 1);
      else ids.push(selId);
      if (!ids.length) return { ...prev, chatSelection: null };
      return { ...prev, chatSelection: { key, ids } };
    });
  };

  const addChatSelectionRange = (key: string, fromIdx: number, toIdx: number) => {
    const st = store.get();
    const conv = st.conversations[key] || [];
    const start = Math.max(0, Math.min(fromIdx, toIdx));
    const end = Math.min(conv.length - 1, Math.max(fromIdx, toIdx));
    if (end < start) return;
    const nextIds = new Set<string>(st.chatSelection && st.chatSelection.key === key ? st.chatSelection.ids : []);
    for (let i = start; i <= end; i += 1) {
      const msg = conv[i];
      if (!isChatMessageSelectable(msg)) continue;
      const selId = messageSelectionKey(msg);
      if (!selId) continue;
      nextIds.add(selId);
    }
    const ids = Array.from(nextIds);
    store.set((prev) => ({ ...prev, chatSelection: ids.length ? { key, ids } : null }));
  };

  const setChatSelectionRangeValue = (key: string, fromIdx: number, toIdx: number, value: boolean) => {
    const st = store.get();
    const conv = st.conversations[key] || [];
    const start = Math.max(0, Math.min(fromIdx, toIdx));
    const end = Math.min(conv.length - 1, Math.max(fromIdx, toIdx));
    if (end < start) return;
    const nextIds = new Set<string>(st.chatSelection && st.chatSelection.key === key ? st.chatSelection.ids : []);
    for (let i = start; i <= end; i += 1) {
      const msg = conv[i];
      if (!isChatMessageSelectable(msg)) continue;
      const selId = messageSelectionKey(msg);
      if (!selId) continue;
      if (value) nextIds.add(selId);
      else nextIds.delete(selId);
    }
    const ids = Array.from(nextIds);
    store.set((prev) => ({ ...prev, chatSelection: ids.length ? { key, ids } : null }));
  };

  const setChatSelectionValueAtIdx = (key: string, idx: number, value: boolean) => {
    const st = store.get();
    const conv = st.conversations[key] || [];
    if (idx < 0 || idx >= conv.length) return;
    const msg = conv[idx];
    if (!isChatMessageSelectable(msg)) return;
    const selId = messageSelectionKey(msg);
    if (!selId) return;
    const idsSet = new Set<string>(st.chatSelection && st.chatSelection.key === key ? st.chatSelection.ids : []);
    if (value) idsSet.add(selId);
    else idsSet.delete(selId);
    const ids = Array.from(idsSet);
    store.set((prev) => ({ ...prev, chatSelection: ids.length ? { key, ids } : null }));
  };

  const resolveChatSelection = (st: AppState): { key: string; messages: ChatMessage[]; ids: string[] } | null => {
    const key = st.selected ? conversationKey(st.selected) : "";
    const selection = st.chatSelection;
    if (!key || !selection || selection.key !== key || !selection.ids.length) return null;
    const conv = st.conversations[key] || [];
    const selected = conv.filter((m) => {
      if (!isChatMessageSelectable(m)) return false;
      const selId = messageSelectionKey(m);
      return Boolean(selId && selection.ids.includes(selId));
    });
    if (!selected.length) return null;
    const ids = selected
      .map((m) => {
        const id = Number(m.id ?? 0);
        return Number.isFinite(id) && id > 0 ? String(id) : "";
      })
      .filter(Boolean);
    if (!ids.length) return null;
    return { key, messages: selected, ids };
  };

  return {
    isChatMessageSelectable,
    clearChatSelection,
    toggleChatSelection,
    addChatSelectionRange,
    setChatSelectionRangeValue,
    setChatSelectionValueAtIdx,
    resolveChatSelection,
  };
}
