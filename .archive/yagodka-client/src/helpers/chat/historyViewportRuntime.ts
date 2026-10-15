import { captureChatShiftAnchor, type ChatShiftAnchor, type UnreadDividerAnchor } from "./historyViewportAnchors";
import type { ChatStickyBottomState } from "./stickyBottom";

export interface ChatHistoryViewportRuntimeState {
  stickyBottom: ChatStickyBottomState | null;
  pendingBottomStickKey: string | null;
  pendingBottomStickUntil: number;
  shiftAnchor: ChatShiftAnchor | null;
  viewerReturnAnchor: ChatShiftAnchor | null;
  compensatedAt: number;
  virtualAvgHeights: Map<string, number>;
  unreadAnchors: Map<string, UnreadDividerAnchor>;
  unreadClearArmed: Set<string>;
  linesObserver: ResizeObserver | null;
  linesObserverRaf: number | null;
  linesObserved: HTMLElement | null;
}

type ChatHistoryViewportHost = HTMLElement & {
  __chatHistoryViewportRuntime?: ChatHistoryViewportRuntimeState | null;
};

function createRuntimeState(): ChatHistoryViewportRuntimeState {
  return {
    stickyBottom: null,
    pendingBottomStickKey: null,
    pendingBottomStickUntil: 0,
    shiftAnchor: null,
    viewerReturnAnchor: null,
    compensatedAt: 0,
    virtualAvgHeights: new Map(),
    unreadAnchors: new Map(),
    unreadClearArmed: new Set(),
    linesObserver: null,
    linesObserverRaf: null,
    linesObserved: null,
  };
}

export const CHAT_PENDING_BOTTOM_STICK_MS = 1500;

function normalizePendingBottomStickKey(key?: string | null): string {
  return String(key || "").trim();
}

export function getChatHistoryViewportRuntime(host: HTMLElement): ChatHistoryViewportRuntimeState {
  const runtimeHost = host as ChatHistoryViewportHost;
  if (!runtimeHost.__chatHistoryViewportRuntime) runtimeHost.__chatHistoryViewportRuntime = createRuntimeState();
  return runtimeHost.__chatHistoryViewportRuntime;
}

export function markChatPendingBottomStick(
  host: HTMLElement,
  key: string,
  now = Date.now(),
  ttlMs = CHAT_PENDING_BOTTOM_STICK_MS
): boolean {
  const normalizedKey = normalizePendingBottomStickKey(key);
  if (!normalizedKey) return false;
  const ttl = Math.max(0, Math.trunc(Number(ttlMs) || 0));
  const runtime = getChatHistoryViewportRuntime(host);
  runtime.pendingBottomStickKey = normalizedKey;
  runtime.pendingBottomStickUntil = Math.max(Number(runtime.pendingBottomStickUntil || 0), now + ttl);
  return true;
}

export function clearChatPendingBottomStick(host: HTMLElement, key?: string | null): void {
  const runtime = getChatHistoryViewportRuntime(host);
  const normalizedKey = normalizePendingBottomStickKey(key);
  if (normalizedKey && runtime.pendingBottomStickKey !== normalizedKey) return;
  runtime.pendingBottomStickKey = null;
  runtime.pendingBottomStickUntil = 0;
}

export function isChatPendingBottomStickActive(host: HTMLElement, key: string, now = Date.now()): boolean {
  const normalizedKey = normalizePendingBottomStickKey(key);
  const runtime = getChatHistoryViewportRuntime(host);
  if (!normalizedKey || runtime.pendingBottomStickKey !== normalizedKey) return false;
  const until = Number(runtime.pendingBottomStickUntil || 0);
  if (!Number.isFinite(until) || until <= now) {
    clearChatPendingBottomStick(host, normalizedKey);
    return false;
  }
  return true;
}

export function captureAndStoreChatShiftAnchor(host: HTMLElement, key: string): ChatShiftAnchor | null {
  const anchor = captureChatShiftAnchor(host, key);
  getChatHistoryViewportRuntime(host).shiftAnchor = anchor;
  return anchor;
}

export function captureAndStoreViewerReturnAnchor(host: HTMLElement, key: string): ChatShiftAnchor | null {
  const anchor = captureChatShiftAnchor(host, key);
  getChatHistoryViewportRuntime(host).viewerReturnAnchor = anchor;
  return anchor;
}

export function disconnectChatHistoryViewportObserver(host: HTMLElement): void {
  const runtime = getChatHistoryViewportRuntime(host);
  const observer = runtime.linesObserver;
  if (observer && typeof observer.disconnect === "function") {
    try {
      observer.disconnect();
    } catch {
      // ignore
    }
  }
  runtime.linesObserved = null;
}

export function resetChatHistoryViewportRuntime(host: HTMLElement): void {
  const runtime = getChatHistoryViewportRuntime(host);
  disconnectChatHistoryViewportObserver(host);
  runtime.stickyBottom = null;
  runtime.pendingBottomStickKey = null;
  runtime.pendingBottomStickUntil = 0;
  runtime.shiftAnchor = null;
  runtime.viewerReturnAnchor = null;
  runtime.compensatedAt = 0;
  runtime.virtualAvgHeights.clear();
  runtime.unreadAnchors.clear();
  runtime.unreadClearArmed.clear();
  runtime.linesObserver = null;
  runtime.linesObserverRaf = null;
}
