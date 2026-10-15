import type { ChatFolderEntry } from "../../stores/types";
import type { StorageLike } from "./pins";

const FOLDERS_VERSION = 1;
const MAX_FOLDERS = 20;
const MAX_KEYS_PER_FOLDER = 500;

const FOLDER_ID_RE = /^[a-z0-9_-]{1,40}$/;

export interface ChatFoldersSnapshot {
  v: number;
  active: string;
  folders: ChatFolderEntry[];
}

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_chat_folders_v${FOLDERS_VERSION}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

function sanitizeChatKeys(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const key = v.trim();
    if (!key || key.length > 96) continue;
    if (!key.startsWith("dm:") && !key.startsWith("room:")) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

function sanitizeFolder(raw: unknown): ChatFolderEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as any;
  const idRaw = String(obj.id || "").trim().toLowerCase();
  if (!idRaw || idRaw === "all" || idRaw === "archive") return null;
  if (!FOLDER_ID_RE.test(idRaw)) return null;
  const titleRaw = String(obj.title || "").trim();
  const title = titleRaw ? (titleRaw.length > 32 ? titleRaw.slice(0, 32) : titleRaw) : "Папка";
  const emojiRaw = typeof obj.emoji === "string" ? obj.emoji.trim() : "";
  const emoji = emojiRaw && emojiRaw.length <= 16 ? emojiRaw : null;
  const include = sanitizeChatKeys(obj.include, MAX_KEYS_PER_FOLDER);
  const exclude = sanitizeChatKeys(obj.exclude, MAX_KEYS_PER_FOLDER);
  const ex = exclude.length ? new Set(exclude) : null;
  const finalInclude = ex ? include.filter((k) => !ex.has(k)) : include;
  return {
    id: idRaw,
    title,
    ...(emoji ? { emoji } : {}),
    include: finalInclude,
    exclude,
  };
}

export function sanitizeChatFoldersSnapshot(raw: unknown): ChatFoldersSnapshot {
  const base: ChatFoldersSnapshot = { v: FOLDERS_VERSION, active: "all", folders: [] };
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as any;
  const foldersRaw = obj.folders;
  const folders: ChatFolderEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(foldersRaw)) {
    for (const item of foldersRaw) {
      const folder = sanitizeFolder(item);
      if (!folder) continue;
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      folders.push(folder);
      if (folders.length >= MAX_FOLDERS) break;
    }
  }
  const activeRaw = String(obj.active || "").trim().toLowerCase();
  const active = (() => {
    if (!activeRaw) return "all";
    if (activeRaw === "all" || activeRaw === "archive") return activeRaw;
    if (!FOLDER_ID_RE.test(activeRaw)) return "all";
    if (!folders.some((f) => f.id === activeRaw)) return "all";
    return activeRaw;
  })();
  return { v: FOLDERS_VERSION, active, folders };
}

export function parseChatFoldersPayload(raw: string | null): ChatFoldersSnapshot {
  if (!raw) return { v: FOLDERS_VERSION, active: "all", folders: [] };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { v: FOLDERS_VERSION, active: "all", folders: [] };
    const obj = parsed as any;
    if (obj.v !== FOLDERS_VERSION) return { v: FOLDERS_VERSION, active: "all", folders: [] };
    return sanitizeChatFoldersSnapshot(obj);
  } catch {
    return { v: FOLDERS_VERSION, active: "all", folders: [] };
  }
}

export function serializeChatFoldersPayload(snap: ChatFoldersSnapshot): string {
  const sanitized = sanitizeChatFoldersSnapshot(snap);
  return JSON.stringify({ v: FOLDERS_VERSION, active: sanitized.active, folders: sanitized.folders });
}

export function loadChatFoldersForUser(userId: string, storage?: StorageLike | null): ChatFoldersSnapshot {
  const key = storageKey(userId);
  if (!key) return { v: FOLDERS_VERSION, active: "all", folders: [] };
  const st = storage ?? defaultStorage();
  if (!st) return { v: FOLDERS_VERSION, active: "all", folders: [] };
  try {
    return parseChatFoldersPayload(st.getItem(key));
  } catch {
    return { v: FOLDERS_VERSION, active: "all", folders: [] };
  }
}

export function saveChatFoldersForUser(userId: string, snap: ChatFoldersSnapshot, storage?: StorageLike | null): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizeChatFoldersSnapshot(snap);
    if (!sanitized.folders.length && sanitized.active === "all") {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializeChatFoldersPayload(sanitized));
  } catch {
    // ignore
  }
}

