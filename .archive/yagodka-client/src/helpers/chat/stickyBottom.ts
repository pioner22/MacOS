export interface ChatStickyBottomState {
  key: string;
  active: boolean;
  at: number;
  scrollTop: number;
}

type ChatStickyHostLike = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight"> & {
  getAttribute?: (name: string) => string | null;
};

export function getChatMaxScrollTop(host: Pick<ChatStickyHostLike, "scrollHeight" | "clientHeight">): number {
  return Math.max(0, host.scrollHeight - host.clientHeight);
}

export function isChatHostNearBottom(host: Pick<ChatStickyHostLike, "scrollTop" | "scrollHeight" | "clientHeight">, slackPx = 24): boolean {
  return host.scrollTop >= getChatMaxScrollTop(host) - slackPx;
}

export function createChatStickyBottomState(
  host: Pick<ChatStickyHostLike, "scrollTop">,
  key: string,
  active: boolean,
  at = Date.now()
): ChatStickyBottomState {
  return {
    key: String(key || "").trim(),
    active,
    at,
    scrollTop: Math.max(0, Number(host.scrollTop) || 0),
  };
}

export function isChatStickyBottomActive(
  host: ChatStickyHostLike,
  state: { key?: string | null; active?: boolean; scrollTop?: number | null } | null | undefined,
  key?: string | null,
  slackPx = 24
): boolean {
  const resolvedKey = String(key ?? host.getAttribute?.("data-chat-key") ?? "").trim();
  if (!resolvedKey) return false;
  if (!state || state.active !== true || String(state.key || "").trim() !== resolvedKey) return false;
  const recordedTop = Number(state.scrollTop);
  if (Number.isFinite(recordedTop)) return Math.abs(host.scrollTop - recordedTop) <= slackPx;
  return isChatHostNearBottom(host, slackPx);
}
