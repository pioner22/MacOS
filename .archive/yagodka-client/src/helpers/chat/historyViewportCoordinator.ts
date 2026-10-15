import { clampVirtualAvg, getVirtualMaxStart, getVirtualStart } from "./virtualHistory";
import { getChatHistoryViewportRuntime } from "./historyViewportRuntime";

export function shiftVirtualStartForPrepend(
  prevStart: number | null | undefined,
  prependShift: number | null | undefined
): number | null {
  if (typeof prevStart !== "number" || !Number.isFinite(prevStart)) return null;
  const current = Number(prevStart);
  const shift = Number(prependShift);
  if (!Number.isFinite(shift) || shift <= 0) return Math.max(0, Math.trunc(current));
  return Math.max(0, Math.trunc(current) + Math.max(0, Math.trunc(shift)));
}

export function resolveVirtualStartForIndex(msgsLength: number, idx: number, windowSize: number): number {
  const targetIdx = Number(idx);
  if (!Number.isFinite(targetIdx) || targetIdx < 0) return 0;
  const window = Math.max(1, Math.trunc(Number(windowSize) || 0));
  const maxStart = getVirtualMaxStart(msgsLength, window);
  return Math.max(0, Math.min(maxStart, Math.trunc(targetIdx) - Math.floor(window / 2)));
}

export function resolveVirtualStartForScroll(opts: {
  msgsLength: number;
  currentStart: number | null | undefined;
  scrollTop: number;
  avgHint: number | null | undefined;
  overscan: number;
  windowSize: number;
  stickToBottom?: boolean;
}): { currentStart: number; targetStart: number; changed: boolean } {
  const window = Math.max(1, Math.trunc(Number(opts.windowSize) || 0));
  const maxStart = getVirtualMaxStart(opts.msgsLength, window);
  const currentStart = getVirtualStart(opts.msgsLength, opts.currentStart, window);
  if (opts.stickToBottom) {
    return { currentStart, targetStart: maxStart, changed: currentStart !== maxStart };
  }
  const avg = clampVirtualAvg(opts.avgHint);
  const overscan = Math.max(0, Math.trunc(Number(opts.overscan) || 0));
  let targetStart = Math.floor((Number(opts.scrollTop) || 0) / avg) - overscan;
  targetStart = Math.max(0, Math.min(maxStart, targetStart));
  return { currentStart, targetStart, changed: currentStart !== targetStart };
}

export function markHistoryViewportCompensation(host: HTMLElement): void {
  getChatHistoryViewportRuntime(host).compensatedAt = Date.now();
}

export function historyViewportRecentlyCompensated(host: HTMLElement, thresholdMs: number, now = Date.now()): boolean {
  const value = Number(getChatHistoryViewportRuntime(host).compensatedAt ?? 0);
  return Number.isFinite(value) && value > 0 && now - value < Math.max(0, Math.trunc(Number(thresholdMs) || 0));
}
