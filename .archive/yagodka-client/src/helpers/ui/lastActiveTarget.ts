import type { TargetKind, TargetRef } from "../../stores/types";

const STORAGE_PREFIX = "yagodka_last_active_target_v1:";
const MAX_ID_LEN = 96;

function storageKeyForUser(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function normalizeId(raw: unknown): string | null {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) return null;
  if (id.length > MAX_ID_LEN) return null;
  return id;
}

function normalizeKind(raw: unknown): TargetKind | null {
  const kind = typeof raw === "string" ? raw.trim() : "";
  if (kind === "dm" || kind === "group" || kind === "board") return kind;
  return null;
}

export function normalizeTargetRef(raw: unknown): TargetRef | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as any;
  const kind = normalizeKind(obj.kind);
  const id = normalizeId(obj.id);
  if (!kind || !id) return null;
  return { kind, id };
}

export function parseLastActiveTargetPayload(raw: unknown): TargetRef | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as any;
    if (obj.v !== 1) return null;
    return normalizeTargetRef(obj.target);
  } catch {
    return null;
  }
}

export function serializeLastActiveTargetPayload(target: TargetRef, at: number = Date.now()): string {
  const t = normalizeTargetRef(target);
  if (!t) return JSON.stringify({ v: 1, target: null, at: Date.now() });
  const ts = Number.isFinite(at) && at > 0 ? Math.trunc(at) : Date.now();
  return JSON.stringify({ v: 1, target: t, at: ts });
}

export function loadLastActiveTarget(userId: string): TargetRef | null {
  const id = normalizeId(userId);
  if (!id) return null;
  try {
    const raw = localStorage.getItem(storageKeyForUser(id));
    if (!raw) return null;
    return parseLastActiveTargetPayload(raw);
  } catch {
    return null;
  }
}

export function saveLastActiveTarget(userId: string, target: TargetRef): void {
  const id = normalizeId(userId);
  if (!id) return;
  const t = normalizeTargetRef(target);
  if (!t) return;
  try {
    localStorage.setItem(storageKeyForUser(id), serializeLastActiveTargetPayload(t));
  } catch {
    // ignore
  }
}

export function clearLastActiveTarget(userId: string): void {
  const id = normalizeId(userId);
  if (!id) return;
  try {
    localStorage.removeItem(storageKeyForUser(id));
  } catch {
    // ignore
  }
}
