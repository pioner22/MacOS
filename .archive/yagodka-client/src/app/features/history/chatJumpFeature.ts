import { getChatHistoryViewportRuntime } from "../../../helpers/chat/historyViewportRuntime";
import { createChatStickyBottomState } from "../../../helpers/chat/stickyBottom";

export interface ChatJumpFeatureDeps {
  chatRoot: HTMLElement;
  chatHost: HTMLElement;
}

export interface ChatJumpFeature {
  smoothScrollChatHostTo: (targetTop: number) => void;
  scrollToChatMsgIdx: (idx: number) => void;
  jumpToChatMsgIdx: (idx: number) => void;
  jumpToBottom: (scheduleChatJumpVisibility: () => void) => void;
}

export function createChatJumpFeature(deps: ChatJumpFeatureDeps): ChatJumpFeature {
  const { chatRoot, chatHost } = deps;

  const smoothScrollChatHostTo = (targetTop: number) => {
    const host = chatHost;
    const maxTop = Math.max(0, host.scrollHeight - host.clientHeight);
    const nextTop = Math.max(0, Math.min(maxTop, targetTop));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      host.scrollTop = nextTop;
      return;
    }
    const start = host.scrollTop;
    const delta = nextTop - start;
    if (Math.abs(delta) < 1) return;
    const phiInv = 0.618;
    const minDuration = 220;
    const maxDuration = 900;
    const duration = Math.min(maxDuration, Math.max(minDuration, Math.abs(delta) * phiInv));
    const startTime = performance.now();
    const hostState = host as any;
    hostState.__phiScrollToken = (hostState.__phiScrollToken || 0) + 1;
    const token = hostState.__phiScrollToken;
    const ease = (t: number) => {
      if (t <= phiInv) {
        const p = t / phiInv;
        return p * p * phiInv;
      }
      const p = (t - phiInv) / (1 - phiInv);
      return phiInv + (1 - phiInv) * (1 - (1 - p) * (1 - p));
    };
    const tick = (now: number) => {
      if (hostState.__phiScrollToken !== token) return;
      const progress = Math.min(1, (now - startTime) / duration);
      host.scrollTop = start + delta * ease(progress);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const centerChatRow = (row: HTMLElement) => {
    const host = chatHost;
    const hostRect = host.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rowCenter = rowRect.top - hostRect.top + host.scrollTop + rowRect.height / 2;
    smoothScrollChatHostTo(rowCenter - host.clientHeight / 2);
  };

  const scrollToChatMsgIdx = (idx: number) => {
    const msgIdx = Number(idx);
    if (!Number.isFinite(msgIdx) || msgIdx < 0) return;
    const row = chatRoot.querySelector(`[data-msg-idx='${msgIdx}']`) as HTMLElement | null;
    if (!row) return;
    try {
      row.scrollIntoView({ block: "center" });
    } catch {
      // ignore
    }
  };

  const jumpToChatMsgIdx = (idx: number) => {
    const msgIdx = Number(idx);
    if (!Number.isFinite(msgIdx) || msgIdx < 0) return;
    const tryJump = () => {
      const row = chatRoot.querySelector(`[data-msg-idx='${msgIdx}']`) as HTMLElement | null;
      if (!row) return false;
      try {
        centerChatRow(row);
      } catch {
        row.scrollIntoView();
      }
      row.classList.add("msg-jump");
      window.setTimeout(() => row.classList.remove("msg-jump"), 900);
      return true;
    };
    if (tryJump()) return;
    window.setTimeout(() => {
      if (tryJump()) return;
      window.setTimeout(tryJump, 160);
    }, 0);
  };

  const jumpToBottom = (scheduleChatJumpVisibility: () => void) => {
    const host = chatHost;
    const key = String(host.getAttribute("data-chat-key") || "");
    const unreadDivider = host.querySelector(".msg-unread") as HTMLElement | null;
    if (unreadDivider) {
      const hostRect = host.getBoundingClientRect();
      const dividerRect = unreadDivider.getBoundingClientRect();
      const dividerTop = dividerRect.top - hostRect.top + host.scrollTop;
        const viewportBottom = host.scrollTop + host.clientHeight;
        if (dividerTop > viewportBottom - 12) {
          smoothScrollChatHostTo(dividerTop - 12);
          if (key) getChatHistoryViewportRuntime(host).stickyBottom = createChatStickyBottomState(host, key, false);
          scheduleChatJumpVisibility();
          return;
        }
      }
      smoothScrollChatHostTo(Math.max(0, host.scrollHeight - host.clientHeight));
    if (key) getChatHistoryViewportRuntime(host).stickyBottom = createChatStickyBottomState(host, key, true);
    scheduleChatJumpVisibility();
  };

  return {
    smoothScrollChatHostTo,
    scrollToChatMsgIdx,
    jumpToChatMsgIdx,
    jumpToBottom,
  };
}
