export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export type PinnedBarHiddenMap = Record<string, string>;

const PINNED_BAR_HIDDEN_VERSION = 1;
const MAX_KEYS = 400;
const MAX_SIG_LEN = 900;

function storageKey(userId: string, version: number): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_pinned_bar_hidden_v${version}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

export function pinnedIdsSignature(ids: number[]): string {
  const safe = Array.isArray(ids) ? ids : [];
  const out: number[] = [];
  for (const rawId of safe) {
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? Math.trunc(rawId) : Number(rawId);
    if (!Number.isFinite(id) || id <= 0) continue;
    const n = Math.trunc(id);
    if (!n || n <= 0) continue;
    if (out.includes(n)) continue;
    out.push(n);
    if (out.length >= 50) break;
  }
  return out.join(",");
}

export function sanitizePinnedBarHidden(raw: unknown): PinnedBarHiddenMap {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: PinnedBarHiddenMap = {};
  const keys = Object.keys(src);
  for (const k of keys) {
    const key = String(k || "").trim();
    if (!key || key.length > 96) continue;
    const sig = String(src[k] || "").trim();
    if (!sig) continue;
    out[key] = sig.length > MAX_SIG_LEN ? sig.slice(0, MAX_SIG_LEN) : sig;
    if (Object.keys(out).length >= MAX_KEYS) break;
  }
  return out;
}

export function parsePinnedBarHiddenPayload(raw: string | null): PinnedBarHiddenMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const obj = parsed as any;
    if (obj.v !== PINNED_BAR_HIDDEN_VERSION) return {};
    return sanitizePinnedBarHidden(obj.hidden);
  } catch {
    return {};
  }
}

export function serializePinnedBarHiddenPayload(map: PinnedBarHiddenMap): string {
  return JSON.stringify({ v: PINNED_BAR_HIDDEN_VERSION, hidden: sanitizePinnedBarHidden(map) });
}

export function loadPinnedBarHiddenForUser(userId: string, storage?: StorageLike | null): PinnedBarHiddenMap {
  const st = storage ?? defaultStorage();
  if (!st) return {};
  try {
    const key = storageKey(userId, PINNED_BAR_HIDDEN_VERSION);
    if (!key) return {};
    const cur = parsePinnedBarHiddenPayload(st.getItem(key));
    const legacyKey = storageKey(userId, 0);
    if (legacyKey) st.removeItem(legacyKey);
    return cur;
  } catch {
    return {};
  }
}

export function savePinnedBarHiddenForUser(userId: string, map: PinnedBarHiddenMap, storage?: StorageLike | null): void {
  const key = storageKey(userId, PINNED_BAR_HIDDEN_VERSION);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizePinnedBarHidden(map);
    if (!Object.keys(sanitized).length) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializePinnedBarHiddenPayload(sanitized));
  } catch {
    // ignore
  }
}

