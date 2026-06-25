import { isPinnedMessage, togglePinnedMessage } from "../../../helpers/chat/pinnedMessages";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

type Selection = { key: string; messages: any[]; ids: string[] } | null;

export interface ChatSelectionPinFeatureDeps {
  store: Store<AppState>;
  resolveChatSelection: (st: AppState) => Selection;
  savePinnedMessages: (userId: string, pinned: Record<string, number[]>) => void;
}

export interface ChatSelectionPinFeature {
  handleChatSelectionPin: () => void;
}

export function createChatSelectionPinFeature(deps: ChatSelectionPinFeatureDeps): ChatSelectionPinFeature {
  const { store, resolveChatSelection, savePinnedMessages } = deps;

  const handleChatSelectionPin = () => {
    const st = store.get();
    const selection = resolveChatSelection(st);
    if (!selection) return;
    const { key, messages } = selection;
    const msgIds = messages
      .map((msg) => (typeof msg.id === "number" && Number.isFinite(msg.id) ? Math.trunc(msg.id) : 0))
      .filter((id) => id > 0);
    if (!msgIds.length) return;
    const allPinned = msgIds.every((id) => isPinnedMessage(st.pinnedMessages, key, id));
    let nextPinned = st.pinnedMessages;
    let changed = false;
    for (const id of msgIds) {
      const pinned = isPinnedMessage(nextPinned, key, id);
      if (allPinned) {
        if (pinned) {
          nextPinned = togglePinnedMessage(nextPinned, key, id);
          changed = true;
        }
      } else if (!pinned) {
        nextPinned = togglePinnedMessage(nextPinned, key, id);
        changed = true;
      }
    }
    if (!changed) return;
    const nextList = nextPinned[key] || [];
    const nextActive = { ...st.pinnedMessageActive };
    if (nextList.length) {
      if (!nextList.includes(nextActive[key])) nextActive[key] = nextList[0];
    } else {
      delete nextActive[key];
    }
    store.set({ pinnedMessages: nextPinned, pinnedMessageActive: nextActive, chatSelection: null });
    if (st.selfId) savePinnedMessages(st.selfId, nextPinned);
  };

  return {
    handleChatSelectionPin,
  };
}
