export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export type PinnedMessagesMap = Record<string, number[]>;

const PINNED_MESSAGES_VERSION = 2;
const MAX_KEYS = 200;
const MAX_PER_KEY = 50;

function storageKey(userId: string, version: number): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_pinned_messages_v${version}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

export function sanitizePinnedMessages(raw: unknown): PinnedMessagesMap {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: PinnedMessagesMap = {};
  const keys = Object.keys(src);
  for (const k of keys) {
    const key = String(k || "").trim();
    if (!key || key.length > 96) continue;
    const v = src[k];
    const ids: number[] = [];
    const pushId = (rawId: unknown) => {
      const id = typeof rawId === "number" && Number.isFinite(rawId) ? Math.trunc(rawId) : Number(rawId);
      if (!Number.isFinite(id) || id <= 0) return;
      const n = Math.trunc(id);
      if (!n || n <= 0) return;
      if (ids.includes(n)) return;
      ids.push(n);
    };
    if (Array.isArray(v)) {
      for (const rawId of v) {
        pushId(rawId);
        if (ids.length >= MAX_PER_KEY) break;
      }
    } else {
      pushId(v);
    }
    if (!ids.length) continue;
    out[key] = ids;
    if (Object.keys(out).length >= MAX_KEYS) break;
  }
  return out;
}

export function parsePinnedMessagesPayload(raw: string | null): PinnedMessagesMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const obj = parsed as any;
    if (obj.v !== PINNED_MESSAGES_VERSION) return {};
    return sanitizePinnedMessages(obj.pinned);
  } catch {
    return {};
  }
}

export function serializePinnedMessagesPayload(map: PinnedMessagesMap): string {
  return JSON.stringify({ v: PINNED_MESSAGES_VERSION, pinned: sanitizePinnedMessages(map) });
}

export function loadPinnedMessagesForUser(userId: string, storage?: StorageLike | null): PinnedMessagesMap {
  const st = storage ?? defaultStorage();
  if (!st) return {};
  try {
    const key = storageKey(userId, PINNED_MESSAGES_VERSION);
    if (!key) return {};
    const cur = parsePinnedMessagesPayload(st.getItem(key));
    const legacyKey = storageKey(userId, 1);
    if (legacyKey) st.removeItem(legacyKey);
    return cur;
  } catch {
    return {};
  }
}

export function savePinnedMessagesForUser(userId: string, map: PinnedMessagesMap, storage?: StorageLike | null): void {
  const key = storageKey(userId, PINNED_MESSAGES_VERSION);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizePinnedMessages(map);
    if (!Object.keys(sanitized).length) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializePinnedMessagesPayload(sanitized));
  } catch {
    // ignore
  }
}

export function togglePinnedMessage(map: PinnedMessagesMap, key: string, msgId: number): PinnedMessagesMap {
  const k = String(key || "").trim();
  const id = Math.trunc(Number(msgId));
  if (!k || !Number.isFinite(id) || id <= 0) return map;
  const cur = Array.isArray(map[k]) ? map[k] : [];
  const existsIdx = cur.indexOf(id);
  if (existsIdx >= 0) {
    const nextList = [...cur.slice(0, existsIdx), ...cur.slice(existsIdx + 1)];
    const next = { ...map };
    if (!nextList.length) delete next[k];
    else next[k] = nextList;
    return next;
  }
  const nextList = [id, ...cur.filter((x) => x !== id)].slice(0, MAX_PER_KEY);
  return { ...map, [k]: nextList };
}

export function isPinnedMessage(map: PinnedMessagesMap, key: string, msgId: number): boolean {
  const k = String(key || "").trim();
  const id = Math.trunc(Number(msgId));
  if (!k || !Number.isFinite(id) || id <= 0) return false;
  const cur = map[k];
  return Array.isArray(cur) ? cur.includes(id) : false;
}

export function mergePinnedMessagesMaps(a: PinnedMessagesMap, b: PinnedMessagesMap): PinnedMessagesMap {
  const left = sanitizePinnedMessages(a);
  const right = sanitizePinnedMessages(b);
  const out: PinnedMessagesMap = { ...left };
  for (const k of Object.keys(right)) {
    const cur = right[k] || [];
    const prev = out[k] || [];
    if (!prev.length) {
      out[k] = cur.slice(0, MAX_PER_KEY);
      continue;
    }
    const seen = new Set<number>();
    const merged: number[] = [];
    for (const id of cur) {
      if (seen.has(id)) continue;
      merged.push(id);
      seen.add(id);
      if (merged.length >= MAX_PER_KEY) break;
    }
    for (const id of prev) {
      if (seen.has(id)) continue;
      merged.push(id);
      seen.add(id);
      if (merged.length >= MAX_PER_KEY) break;
    }
    if (merged.length) out[k] = merged;
  }
  return out;
}
