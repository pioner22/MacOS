import type { AppState, ChatMessage } from "../../stores/types";

export function upsertConversation(state: AppState, key: string, msg: ChatMessage): AppState {
  const prev = state.conversations[key] ?? [];
  let next: ChatMessage[];
  if (msg.id !== undefined && msg.id !== null) {
    const i = prev.findIndex((m) => m.id === msg.id);
    if (i >= 0) {
      next = [...prev];
      const cur = prev[i];
      next[i] = {
        ...msg,
        ...(msg.localId !== undefined ? {} : { localId: cur.localId }),
        ...(msg.reply !== undefined ? {} : { reply: cur.reply }),
        ...(msg.forward !== undefined ? {} : { forward: cur.forward }),
      };
    } else {
      next = [...prev, msg];
    }
  } else {
    next = [...prev, msg];
  }
  return {
    ...state,
    conversations: { ...state.conversations, [key]: next },
  };
}
