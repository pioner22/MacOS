import { conversationKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface PinnedMessagesUiFeatureDeps {
  store: Store<AppState>;
  chatRoot: HTMLElement;
  persistPinnedMessages: (selfId: string, pinnedMessages: AppState["pinnedMessages"]) => void;
}

export interface PinnedMessagesUiFeature {
  unpinActiveForSelected: () => boolean;
  jumpToActiveForSelected: () => boolean;
  activatePrevForSelected: () => boolean;
  activateNextForSelected: () => boolean;
}

export function createPinnedMessagesUiFeature(deps: PinnedMessagesUiFeatureDeps): PinnedMessagesUiFeature {
  const { store, chatRoot, persistPinnedMessages } = deps;

  const getSelectedPinnedState = () => {
    const st = store.get();
    const key = st.selected ? conversationKey(st.selected) : "";
    const ids = key ? st.pinnedMessages[key] : null;
    if (!key || !Array.isArray(ids) || !ids.length) return null;
    return { st, key, ids };
  };

  const resolveActivePinnedId = (activeRaw: unknown, ids: number[]): number => {
    if (typeof activeRaw === "number" && ids.includes(activeRaw)) return activeRaw;
    return ids[0];
  };

  const unpinActiveForSelected = () => {
    const pinned = getSelectedPinnedState();
    if (!pinned) return false;
    const { st, key, ids } = pinned;
    const activeId = resolveActivePinnedId(st.pinnedMessageActive[key], ids);
    const nextList = ids.filter((id) => id !== activeId);
    const nextPinned = { ...st.pinnedMessages };
    const nextActive = { ...st.pinnedMessageActive };
    if (nextList.length) {
      nextPinned[key] = nextList;
      if (nextActive[key] === activeId || !nextList.includes(nextActive[key])) nextActive[key] = nextList[0];
    } else {
      delete nextPinned[key];
      delete nextActive[key];
    }
    store.set({ pinnedMessages: nextPinned, pinnedMessageActive: nextActive });
    if (st.selfId) persistPinnedMessages(st.selfId, nextPinned);
    return true;
  };

  const jumpToActiveForSelected = () => {
    const pinned = getSelectedPinnedState();
    if (!pinned) return false;
    const { st, key, ids } = pinned;
    const activeId = resolveActivePinnedId(st.pinnedMessageActive[key], ids);
    const messages = st.conversations[key] || [];
    const idx = messages.findIndex((msg) => typeof msg.id === "number" && msg.id === activeId);
    if (idx < 0) return false;
    const row = chatRoot.querySelector(`[data-msg-idx="${idx}"]`) as HTMLElement | null;
    if (!row) return false;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    } catch {
      row.scrollIntoView();
    }
    row.classList.add("msg-jump");
    window.setTimeout(() => row.classList.remove("msg-jump"), 900);
    return true;
  };

  const activatePrevForSelected = () => {
    const pinned = getSelectedPinnedState();
    if (!pinned || pinned.ids.length < 2) return false;
    const { key, ids, st } = pinned;
    const curIdx = typeof st.pinnedMessageActive[key] === "number" ? ids.indexOf(st.pinnedMessageActive[key]) : -1;
    const base = curIdx >= 0 ? curIdx : 0;
    const nextIdx = (base - 1 + ids.length) % ids.length;
    const nextId = ids[nextIdx];
    store.set((prev) => ({ ...prev, pinnedMessageActive: { ...prev.pinnedMessageActive, [key]: nextId } }));
    return true;
  };

  const activateNextForSelected = () => {
    const pinned = getSelectedPinnedState();
    if (!pinned || pinned.ids.length < 2) return false;
    const { key, ids, st } = pinned;
    const curIdx = typeof st.pinnedMessageActive[key] === "number" ? ids.indexOf(st.pinnedMessageActive[key]) : -1;
    const base = curIdx >= 0 ? curIdx : 0;
    const nextIdx = (base + 1) % ids.length;
    const nextId = ids[nextIdx];
    store.set((prev) => ({ ...prev, pinnedMessageActive: { ...prev.pinnedMessageActive, [key]: nextId } }));
    return true;
  };

  return {
    unpinActiveForSelected,
    jumpToActiveForSelected,
    activatePrevForSelected,
    activateNextForSelected,
  };
}
