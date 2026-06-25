export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const PINS_VERSION = 1;
const MAX_PINS = 200;

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_pins_v${PINS_VERSION}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

export function sanitizePins(raw: unknown): string[] {
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
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

export function parsePinsPayload(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as any;
    if (obj.v !== PINS_VERSION) return [];
    return sanitizePins(obj.pins);
  } catch {
    return [];
  }
}

export function serializePinsPayload(pins: string[]): string {
  return JSON.stringify({ v: PINS_VERSION, pins: sanitizePins(pins) });
}

export function loadPinsForUser(userId: string, storage?: StorageLike | null): string[] {
  const key = storageKey(userId);
  if (!key) return [];
  const st = storage ?? defaultStorage();
  if (!st) return [];
  try {
    return parsePinsPayload(st.getItem(key));
  } catch {
    return [];
  }
}

export function savePinsForUser(userId: string, pins: string[], storage?: StorageLike | null): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const sanitized = sanitizePins(pins);
    if (!sanitized.length) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, serializePinsPayload(sanitized));
  } catch {
    // ignore
  }
}

export function togglePin(pins: string[], key: string): string[] {
  const k = String(key || "").trim();
  if (!k) return pins;
  const exists = pins.includes(k);
  if (exists) return pins.filter((x) => x !== k);
  return [k, ...pins];
}

