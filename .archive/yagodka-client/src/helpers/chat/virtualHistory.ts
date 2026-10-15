export const HISTORY_VIRTUAL_THRESHOLD = 320;
export const HISTORY_VIRTUAL_WINDOW = 240;
export const HISTORY_VIRTUAL_OVERSCAN = 80;
export const HISTORY_VIRTUAL_AVG_FALLBACK = 56;
export const HISTORY_VIRTUAL_AVG_MIN = 24;
export const HISTORY_VIRTUAL_AVG_MAX = 140;

export function shouldVirtualize(total: number, searchActive: boolean, threshold = HISTORY_VIRTUAL_THRESHOLD): boolean {
  if (searchActive) return false;
  return total > threshold;
}

export function clampVirtualAvg(value?: number | null): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : HISTORY_VIRTUAL_AVG_FALLBACK;
  return Math.max(HISTORY_VIRTUAL_AVG_MIN, Math.min(HISTORY_VIRTUAL_AVG_MAX, v));
}

export function getVirtualMaxStart(total: number, windowSize = HISTORY_VIRTUAL_WINDOW): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, total - windowSize);
}

export function getVirtualStart(total: number, start?: number | null, windowSize = HISTORY_VIRTUAL_WINDOW): number {
  const maxStart = getVirtualMaxStart(total, windowSize);
  if (typeof start !== "number" || !Number.isFinite(start)) return maxStart;
  return Math.max(0, Math.min(maxStart, Math.floor(start)));
}

export function getVirtualEnd(total: number, start: number, windowSize = HISTORY_VIRTUAL_WINDOW): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(total, Math.max(0, start) + windowSize);
}
