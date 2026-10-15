export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const DRAFTS_VERSION = 1;
// Keep in sync with message max length (server/client): 4000.
const MAX_DRAFT_LEN = 4000;
const MAX_DRAFTS = 60;

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_chat_drafts_v${DRAFTS_VERSION}:${id}`;
}

function sanitizeDraftText(text: string): string | null {
  if (!text) return null;
  if (!text.trim()) return null;
  if (text.length <= MAX_DRAFT_LEN) return text;
  return text.slice(0, MAX_DRAFT_LEN);
}

export function sanitizeDraftMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [kRaw, vRaw] of entries) {
    if (typeof kRaw !== "string") continue;
    const k = kRaw.trim();
    if (!k || k.length > 96) continue;
    if (typeof vRaw !== "string") continue;
    const v = sanitizeDraftText(vRaw);
    if (!v) continue;
    out[k] = v;
    if (Object.keys(out).length >= MAX_DRAFTS) break;
  }
  return out;
}

export function parseDraftsPayload(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const obj = parsed as any;
    if (obj.v !== DRAFTS_VERSION) return {};
    return sanitizeDraftMap(obj.drafts);
  } catch {
    return {};
  }
}

export function serializeDraftsPayload(drafts: Record<string, string>): string {
  return JSON.stringify({ v: DRAFTS_VERSION, drafts: sanitizeDraftMap(drafts) });
}

export function updateDraftMap(prev: Record<string, string>, convKey: string, text: string): Record<string, string> {
  const key = String(convKey || "").trim();
  if (!key) return prev;
  const safeText = sanitizeDraftText(String(text ?? ""));
  if (!safeText) {
    if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  }
  if (prev[key] === safeText) return prev;
  return { ...prev, [key]: safeText };
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

export function loadDraftsForUser(userId: string, storage?: StorageLike | null): Record<string, string> {
  const key = storageKey(userId);
  if (!key) return {};
  const st = storage ?? defaultStorage();
  if (!st) return {};
  try {
    return parseDraftsPayload(st.getItem(key));
  } catch {
    return {};
  }
}

export function saveDraftsForUser(userId: string, drafts: Record<string, string>, storage?: StorageLike | null): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizeDraftMap(drafts);
    if (Object.keys(sanitized).length === 0) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializeDraftsPayload(sanitized));
  } catch {
    // ignore
  }
}

