import type { FileTransferEntry, FileTransferStatus } from "../../stores/types";

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const FILE_TRANSFERS_VERSION = 1;
const MAX_ENTRIES = 200;
const TERMINAL_STATUSES = new Set<FileTransferStatus>(["complete", "uploaded", "error", "rejected"]);

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_file_transfers_v${FILE_TRANSFERS_VERSION}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

function normalizeStatus(raw: unknown): FileTransferStatus | null {
  const s = String(raw ?? "").trim();
  if (s === "offering") return "offering";
  if (s === "uploading") return "uploading";
  if (s === "uploaded") return "uploaded";
  if (s === "downloading") return "downloading";
  if (s === "complete") return "complete";
  if (s === "rejected") return "rejected";
  if (s === "error") return "error";
  return null;
}

function sanitizeEntry(raw: unknown, opts?: { terminalOnly?: boolean; persistable?: boolean }): FileTransferEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as any;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const terminalOnly = opts?.terminalOnly !== false;
  const persistable = opts?.persistable !== false;
  if (!id && terminalOnly) return null;

  const status = normalizeStatus(obj.status);
  if (!status || (terminalOnly && !TERMINAL_STATUSES.has(status))) return null;

  const localIdRaw = typeof obj.localId === "string" ? obj.localId.trim() : "";
  const localId = localIdRaw || (id ? `ft-${id}` : "");
  if (!localId) return null;

  const nameRaw = typeof obj.name === "string" ? obj.name : "";
  const name = nameRaw.trim() || "файл";

  const sizeNum = Number(obj.size ?? 0);
  const size = Number.isFinite(sizeNum) && sizeNum > 0 ? Math.round(sizeNum) : 0;

  const dir = String(obj.direction ?? "").trim();
  const direction = dir === "in" || dir === "out" ? (dir as "in" | "out") : null;
  if (!direction) return null;

  const peerRaw = typeof obj.peer === "string" ? obj.peer.trim() : "";
  const peer = peerRaw || "—";

  const roomRaw = obj.room;
  const room = typeof roomRaw === "string" ? roomRaw : roomRaw === null ? null : null;

  const progressNum = Number(obj.progress ?? 0);
  const progress =
    status === "complete" || status === "uploaded"
      ? 100
      : Number.isFinite(progressNum)
        ? Math.max(0, Math.min(100, Math.round(progressNum)))
        : 0;

  const errorRaw = typeof obj.error === "string" ? obj.error.trim() : "";
  const error = errorRaw || null;
  const mimeRaw = typeof obj.mime === "string" ? obj.mime.trim() : "";
  const mime = mimeRaw || null;
  const urlRaw = typeof obj.url === "string" ? obj.url.trim() : "";
  const url = urlRaw || null;
  const acceptedBy = normalizeStringList(obj.acceptedBy);
  const receivedBy = normalizeStringList(obj.receivedBy);

  return {
    localId,
    id: id || null,
    name,
    size,
    direction,
    peer,
    room,
    status,
    progress,
    ...(error ? { error } : {}),
    ...(mime ? { mime } : {}),
    ...(!persistable && url ? { url } : {}),
    ...(!persistable && acceptedBy.length ? { acceptedBy } : {}),
    ...(!persistable && receivedBy.length ? { receivedBy } : {}),
  };
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function sanitizeFileTransfers(raw: unknown): FileTransferEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FileTransferEntry[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    const entry = sanitizeEntry(it, { terminalOnly: true, persistable: true });
    if (!entry) continue;
    const key = String(entry.id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export function sanitizeRuntimeFileTransfers(raw: unknown): FileTransferEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FileTransferEntry[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    const entry = sanitizeEntry(it, { terminalOnly: false, persistable: false });
    if (!entry) continue;
    const id = String(entry.id || "").trim();
    const localId = String(entry.localId || "").trim();
    const key = id ? `id:${id}` : `local:${localId}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export function parseFileTransfersPayload(raw: string | null): FileTransferEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as any;
    if (obj.v !== FILE_TRANSFERS_VERSION) return [];
    return sanitizeFileTransfers(obj.transfers);
  } catch {
    return [];
  }
}

export function serializeFileTransfersPayload(transfers: FileTransferEntry[]): string {
  return JSON.stringify({ v: FILE_TRANSFERS_VERSION, transfers: sanitizeFileTransfers(transfers) });
}

export function loadFileTransfersForUser(userId: string, storage?: StorageLike | null): FileTransferEntry[] {
  const key = storageKey(userId);
  if (!key) return [];
  const st = storage ?? defaultStorage();
  if (!st) return [];
  try {
    return parseFileTransfersPayload(st.getItem(key));
  } catch {
    return [];
  }
}

export function saveFileTransfersForUser(userId: string, transfers: FileTransferEntry[], storage?: StorageLike | null): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizeFileTransfers(transfers);
    if (!sanitized.length) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializeFileTransfersPayload(sanitized));
  } catch {
    // ignore
  }
}
