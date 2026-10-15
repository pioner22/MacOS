import type { OutboxEntry } from "../../stores/types";

export type OutboxMap = Record<string, OutboxEntry[]>;

const OUTBOX_STORAGE_PREFIX = "yagodka_outbox_v1:";
const OUTBOX_MAX_CONVERSATIONS = 80;
const OUTBOX_MAX_PER_CONV = 60;
const OUTBOX_TEXT_MAX = 4000;

function storageKeyForUser(userId: string): string {
  return `${OUTBOX_STORAGE_PREFIX}${userId}`;
}

function isValidConvKey(key: string): boolean {
  return key.startsWith("dm:") || key.startsWith("room:");
}

function normalizeId(raw: unknown): string | null {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) return null;
  if (id.length > 64) return null;
  return id;
}

function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) return null;
  if (text.length > OUTBOX_TEXT_MAX) return text.slice(0, OUTBOX_TEXT_MAX);
  return text;
}

function normalizeTs(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeScheduleAt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function sanitizeEntry(raw: any, key: string): OutboxEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const localId = normalizeId(raw.localId);
  const ts = normalizeTs(raw.ts);
  const text = normalizeText(raw.text);
  if (!localId || ts === null || !text) return null;

  const to = key.startsWith("dm:") ? normalizeId(raw.to) : null;
  const room = key.startsWith("room:") ? normalizeId(raw.room) : null;
  if (key.startsWith("dm:") && !to) return null;
  if (key.startsWith("room:") && !room) return null;

  const statusRaw = raw.status;
  const status: OutboxEntry["status"] | undefined =
    statusRaw === "sending" ? "sending" : statusRaw === "queued" ? "queued" : statusRaw === "sent" ? "sent" : undefined;
  const attemptsRaw = raw.attempts;
  const attempts = Number.isFinite(attemptsRaw) ? Math.max(0, Math.min(999, Math.trunc(attemptsRaw))) : undefined;
  const lastAttemptAtRaw = raw.lastAttemptAt;
  const lastAttemptAt = Number.isFinite(lastAttemptAtRaw) ? Math.max(0, Math.trunc(lastAttemptAtRaw)) : undefined;
  const whenOnline = Boolean(raw.whenOnline);
  const silent = Boolean(raw.silent);
  const scheduleAt = normalizeScheduleAt(raw.scheduleAt);

  return {
    localId,
    ts,
    text,
    ...(to ? { to } : {}),
    ...(room ? { room } : {}),
    ...(status ? { status } : {}),
    ...(attempts !== undefined ? { attempts } : {}),
    ...(lastAttemptAt !== undefined ? { lastAttemptAt } : {}),
    ...(whenOnline ? { whenOnline: true } : {}),
    ...(silent ? { silent: true } : {}),
    ...(scheduleAt !== null ? { scheduleAt } : {}),
  };
}

export function sanitizeOutboxMap(raw: any): OutboxMap {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const entries: Array<{ key: string; list: OutboxEntry[]; lastTs: number }> = [];
  for (const [keyRaw, value] of Object.entries(obj)) {
    const key = typeof keyRaw === "string" ? keyRaw.trim() : "";
    if (!key || !isValidConvKey(key) || key.length > 96) continue;
    const arr = Array.isArray(value) ? value : [];
    const list: OutboxEntry[] = [];
    const seen = new Set<string>();
    for (const it of arr) {
      const ent = sanitizeEntry(it, key);
      if (!ent) continue;
      if (seen.has(ent.localId)) continue;
      seen.add(ent.localId);
      list.push(ent);
    }
    if (!list.length) continue;
    list.sort((a, b) => a.ts - b.ts);
    const lastTs = list[list.length - 1]?.ts ?? 0;
    entries.push({ key, list, lastTs });
  }

  entries.sort((a, b) => b.lastTs - a.lastTs);
  const limited = entries.slice(0, OUTBOX_MAX_CONVERSATIONS);
  const out: OutboxMap = {};
  for (const { key, list } of limited) {
    const trimmed = list.length > OUTBOX_MAX_PER_CONV ? list.slice(list.length - OUTBOX_MAX_PER_CONV) : list;
    out[key] = trimmed;
  }
  return out;
}

export function loadOutboxForUser(userId: string): OutboxMap {
  const id = String(userId || "").trim();
  if (!id) return {};
  try {
    const raw = localStorage.getItem(storageKeyForUser(id));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return sanitizeOutboxMap(parsed);
  } catch {
    return {};
  }
}

export function saveOutboxForUser(userId: string, outbox: OutboxMap) {
  const id = String(userId || "").trim();
  if (!id) return;
  try {
    const sanitized = sanitizeOutboxMap(outbox);
    localStorage.setItem(storageKeyForUser(id), JSON.stringify(sanitized));
  } catch {
    // ignore
  }
}

export function makeOutboxLocalId(): string {
  try {
    const uuid = (globalThis.crypto as any)?.randomUUID?.();
    if (typeof uuid === "string" && uuid) return uuid;
  } catch {
    // ignore
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function addOutboxEntry(outbox: OutboxMap, key: string, entry: OutboxEntry): OutboxMap {
  const k = String(key || "").trim();
  if (!k || !isValidConvKey(k)) return outbox;
  if (!entry || typeof entry !== "object") return outbox;
  const list = Array.isArray(outbox[k]) ? outbox[k] : [];
  if (list.some((e) => e.localId === entry.localId)) return outbox;
  const next = [...list, entry];
  next.sort((a, b) => a.ts - b.ts);
  const trimmed = next.length > OUTBOX_MAX_PER_CONV ? next.slice(next.length - OUTBOX_MAX_PER_CONV) : next;
  return { ...outbox, [k]: trimmed };
}

export function updateOutboxEntry(
  outbox: OutboxMap,
  key: string,
  localId: string,
  update: (entry: OutboxEntry) => OutboxEntry
): OutboxMap {
  const k = String(key || "").trim();
  const lid = String(localId || "").trim();
  if (!k || !lid || !isValidConvKey(k)) return outbox;
  const list = Array.isArray(outbox[k]) ? outbox[k] : [];
  const idx = list.findIndex((e) => e.localId === lid);
  if (idx < 0) return outbox;
  const next = [...list];
  next[idx] = update(next[idx]);
  return { ...outbox, [k]: next };
}

export function removeOutboxEntry(outbox: OutboxMap, key: string, localId: string): OutboxMap {
  const k = String(key || "").trim();
  const lid = String(localId || "").trim();
  if (!k || !lid || !isValidConvKey(k)) return outbox;
  const list = Array.isArray(outbox[k]) ? outbox[k] : [];
  if (!list.length) return outbox;
  const next = list.filter((e) => e.localId !== lid);
  if (next.length === list.length) return outbox;
  const out: OutboxMap = { ...outbox };
  if (next.length) out[k] = next;
  else delete out[k];
  return out;
}
