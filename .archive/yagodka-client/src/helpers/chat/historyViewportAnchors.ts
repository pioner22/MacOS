import { messageSelectionKey } from "./chatSelection";
import type { ChatMessage } from "../../stores/types";

export type ChatShiftAnchor = {
  key: string;
  msgKey?: string;
  msgId?: number;
  rectTop: number;
  scrollTop: number;
};

export type UnreadDividerAnchor = {
  msgKey?: string;
  msgId?: number;
};

export function unreadAnchorForMessage(msg: ChatMessage): UnreadDividerAnchor {
  const msgKey = messageSelectionKey(msg);
  const rawId = msg?.id;
  const msgId = typeof rawId === "number" && Number.isFinite(rawId) && rawId > 0 ? rawId : undefined;
  return { ...(msgKey ? { msgKey } : {}), ...(msgId ? { msgId } : {}) };
}

export function findUnreadAnchorIndex(msgs: ChatMessage[], anchor: UnreadDividerAnchor): number {
  if (!Array.isArray(msgs) || msgs.length === 0) return -1;
  if (anchor.msgKey) {
    const idx = msgs.findIndex((m) => messageSelectionKey(m) === anchor.msgKey);
    if (idx >= 0) return idx;
  }
  if (anchor.msgId !== undefined) {
    const idx = msgs.findIndex((m) => {
      const raw = m?.id;
      return typeof raw === "number" && Number.isFinite(raw) && raw === anchor.msgId;
    });
    if (idx >= 0) return idx;
  }
  return -1;
}

export function captureChatShiftAnchor(host: HTMLElement, key: string): ChatShiftAnchor | null {
  const lines = host.firstElementChild as HTMLElement | null;
  if (!lines) return null;
  const hostRect = host.getBoundingClientRect();
  const children = Array.from(lines.children) as HTMLElement[];
  let fallback: HTMLElement | null = null;
  let firstVisible: { element: HTMLElement; rect: DOMRect } | null = null;
  for (const child of children) {
    if (!child.classList.contains("msg")) continue;
    if (!fallback) fallback = child;
    const rect = child.getBoundingClientRect();
    if (rect.bottom >= hostRect.top && rect.top <= hostRect.bottom) {
      firstVisible = { element: child, rect };
      break;
    } else if (fallback && rect.top > hostRect.bottom) {
      break;
    }
  }
  const picked = firstVisible ?? (fallback ? { element: fallback, rect: fallback.getBoundingClientRect() } : null);
  if (!picked) return null;
  const msgKey = String(picked.element.getAttribute("data-msg-key") || "").trim();
  const rawMsgId = picked.element.getAttribute("data-msg-id");
  const msgId = rawMsgId ? Number(rawMsgId) : NaN;
  return {
    key,
    msgKey: msgKey || undefined,
    msgId: Number.isFinite(msgId) ? msgId : undefined,
    rectTop: picked.rect.top,
    scrollTop: host.scrollTop,
  };
}

export function findChatShiftAnchorElement(host: HTMLElement, anchor: ChatShiftAnchor): HTMLElement | null {
  const lines = host.firstElementChild as HTMLElement | null;
  if (!lines) return null;
  const children = Array.from(lines.children) as HTMLElement[];
  for (const child of children) {
    if (!child.classList.contains("msg")) continue;
    if (anchor.msgKey) {
      if (child.getAttribute("data-msg-key") === anchor.msgKey) return child;
      continue;
    }
    if (anchor.msgId !== undefined) {
      const raw = child.getAttribute("data-msg-id");
      if (!raw) continue;
      const msgId = Number(raw);
      if (Number.isFinite(msgId) && msgId === anchor.msgId) return child;
    }
  }
  return null;
}
