import type { BoardScheduledPost } from "../../stores/types";

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const BOARD_SCHEDULE_VERSION = 1;
const MAX_TEXT_LEN = 4000;
const MAX_ITEMS = 40;
const MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_board_schedule_v${BOARD_SCHEDULE_VERSION}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

function sanitizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trimEnd();
  if (!text.trim()) return null;
  if (text.length <= MAX_TEXT_LEN) return text;
  return text.slice(0, MAX_TEXT_LEN);
}

function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > 96) return null;
  return id;
}

function sanitizeBoardId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > 96) return null;
  return id;
}

export function sanitizeBoardSchedule(raw: unknown, opts?: { nowMs?: number }): BoardScheduledPost[] {
  const nowMs = typeof opts?.nowMs === "number" && Number.isFinite(opts.nowMs) ? Math.max(0, Math.trunc(opts.nowMs)) : Date.now();
  const maxAt = nowMs + MAX_DELAY_MS;
  const maxCreatedAgeMs = MAX_DELAY_MS + 12 * 60 * 60 * 1000; // 7 days + 12h grace

  const list = Array.isArray(raw) ? raw : [];
  const out: BoardScheduledPost[] = [];
  const seen = new Set<string>();
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const obj = it as any;
    const id = sanitizeId(obj.id);
    if (!id || seen.has(id)) continue;
    const boardId = sanitizeBoardId(obj.boardId);
    if (!boardId) continue;
    const text = sanitizeText(obj.text);
    if (!text) continue;
    const scheduleAt = typeof obj.scheduleAt === "number" && Number.isFinite(obj.scheduleAt) ? Math.max(0, Math.trunc(obj.scheduleAt)) : 0;
    const createdAt = typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt) ? Math.max(0, Math.trunc(obj.createdAt)) : 0;
    if (!scheduleAt) continue;
    if (scheduleAt > maxAt) continue;
    if (!createdAt) continue;
    if (nowMs - createdAt > maxCreatedAgeMs) continue;

    seen.add(id);
    out.push({ id, boardId, text, scheduleAt, createdAt });
    if (out.length >= MAX_ITEMS) break;
  }

  out.sort((a, b) => a.scheduleAt - b.scheduleAt);
  return out;
}

export function parseBoardSchedulePayload(raw: string | null, opts?: { nowMs?: number }): BoardScheduledPost[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as any;
    if (obj.v !== BOARD_SCHEDULE_VERSION) return [];
    return sanitizeBoardSchedule(obj.items, opts);
  } catch {
    return [];
  }
}

export function serializeBoardSchedulePayload(items: BoardScheduledPost[]): string {
  return JSON.stringify({ v: BOARD_SCHEDULE_VERSION, items: sanitizeBoardSchedule(items) });
}

export function loadBoardScheduleForUser(userId: string, storage?: StorageLike | null, opts?: { nowMs?: number }): BoardScheduledPost[] {
  const key = storageKey(userId);
  if (!key) return [];
  const st = storage ?? defaultStorage();
  if (!st) return [];
  try {
    return parseBoardSchedulePayload(st.getItem(key), opts);
  } catch {
    return [];
  }
}

export function saveBoardScheduleForUser(userId: string, items: BoardScheduledPost[], storage?: StorageLike | null): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizeBoardSchedule(items);
    if (!sanitized.length) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializeBoardSchedulePayload(sanitized));
  } catch {
    // ignore
  }
}

export function maxBoardScheduleDelayMs(): number {
  return MAX_DELAY_MS;
}

