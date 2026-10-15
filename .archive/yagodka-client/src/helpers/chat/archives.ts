export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const ARCHIVE_VERSION = 1;
const MAX_ARCHIVED = 500;

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_archived_v${ARCHIVE_VERSION}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

export function sanitizeArchived(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const key = v.trim();
    if (!key || key.length > 96) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_ARCHIVED) break;
  }
  return out;
}

export function parseArchivedPayload(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as any;
    if (obj.v !== ARCHIVE_VERSION) return [];
    return sanitizeArchived(obj.archived);
  } catch {
    return [];
  }
}

export function serializeArchivedPayload(archived: string[]): string {
  return JSON.stringify({ v: ARCHIVE_VERSION, archived: sanitizeArchived(archived) });
}

export function loadArchivedForUser(userId: string, storage?: StorageLike | null): string[] {
  const key = storageKey(userId);
  if (!key) return [];
  const st = storage ?? defaultStorage();
  if (!st) return [];
  try {
    return parseArchivedPayload(st.getItem(key));
  } catch {
    return [];
  }
}

export function saveArchivedForUser(userId: string, archived: string[], storage?: StorageLike | null): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizeArchived(archived);
    if (!sanitized.length) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializeArchivedPayload(sanitized));
  } catch {
    // ignore
  }
}

export function toggleArchived(archived: string[], key: string): string[] {
  const k = String(key || "").trim();
  if (!k) return archived;
  const exists = archived.includes(k);
  if (exists) return archived.filter((x) => x !== k);
  return [k, ...archived];
}

