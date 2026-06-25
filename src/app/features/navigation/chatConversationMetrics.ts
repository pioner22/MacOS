import { isIOS } from "../../../helpers/ui/iosInputAssistant";
import type { AppState, ChatMessage } from "../../../stores/types";

const IOS_INACTIVE_CONV_LIMIT = 120;
const DEFAULT_INACTIVE_CONV_LIMIT = 300;

function trimConversation(conv: ChatMessage[], limit: number): { list: ChatMessage[]; cursor: number | null } {
  if (!Array.isArray(conv) || conv.length <= limit) return { list: conv, cursor: null };
  const next = conv.slice(Math.max(0, conv.length - limit));
  let minId: number | null = null;
  for (const m of next) {
    const id = m?.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    minId = minId === null ? id : Math.min(minId, id);
  }
  return { list: next, cursor: minId };
}

export function applyConversationLimits(
  prev: AppState,
  activeKey: string
): { conversations: Record<string, ChatMessage[]>; historyCursor: Record<string, number> } | null {
  const inactiveLimit = isIOS() ? IOS_INACTIVE_CONV_LIMIT : DEFAULT_INACTIVE_CONV_LIMIT;
  let conversations = prev.conversations;
  let historyCursor = prev.historyCursor;
  let changed = false;
  for (const [key, conv] of Object.entries(prev.conversations || {})) {
    if (key === activeKey) continue;
    if (!Array.isArray(conv) || conv.length <= inactiveLimit) continue;
    const trimmed = trimConversation(conv, inactiveLimit);
    if (trimmed.list === conv) continue;
    if (!changed) {
      conversations = { ...prev.conversations };
      historyCursor = { ...prev.historyCursor };
      changed = true;
    }
    conversations[key] = trimmed.list;
    if (trimmed.cursor && Number.isFinite(trimmed.cursor)) historyCursor[key] = trimmed.cursor;
  }
  return changed ? { conversations, historyCursor } : null;
}

export function computeRoomUnread(key: string, st: AppState): number {
  if (!key.startsWith("room:")) return 0;
  const conv = st.conversations?.[key] || [];
  if (!Array.isArray(conv) || conv.length === 0) return 0;
  const marker = st.lastRead?.[key];
  const lastReadId = Number(marker?.id ?? 0);
  const lastReadTs = Number(marker?.ts ?? 0);
  if (lastReadId <= 0 && lastReadTs <= 0) return 0;
  let count = 0;
  for (let i = conv.length - 1; i >= 0; i -= 1) {
    const msg = conv[i];
    if (!msg || msg.kind !== "in") continue;
    const msgId = Number(msg.id ?? 0);
    const msgTs = Number(msg.ts ?? 0);
    if (lastReadId > 0) {
      if (Number.isFinite(msgId) && msgId > lastReadId) {
        count += 1;
        continue;
      }
      if (Number.isFinite(msgId) && msgId <= lastReadId) break;
      if (lastReadTs > 0 && msgTs > lastReadTs) {
        count += 1;
        continue;
      }
      if (lastReadTs > 0 && msgTs <= lastReadTs) break;
      continue;
    }
    if (lastReadTs > 0) {
      if (msgTs > lastReadTs) {
        count += 1;
        continue;
      }
      if (msgTs > 0 && msgTs <= lastReadTs) break;
    }
  }
  return count;
}
