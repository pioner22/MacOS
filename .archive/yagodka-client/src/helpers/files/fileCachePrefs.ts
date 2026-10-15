const PREFS_VERSION = 1;
const MB = 1024 * 1024;
const GB = 1024 * MB;
const DAY = 24 * 60 * 60 * 1000;

export interface FileCachePrefs {
  maxBytes: number;
  autoCleanMs: number;
  lastCleanAt: number;
  userSetMaxBytes?: boolean;
  userSetAutoCleanMs?: boolean;
}

export const CACHE_SIZE_PRESETS = [
  { label: "50 МБ", bytes: 50 * MB },
  { label: "100 МБ", bytes: 100 * MB },
  { label: "200 МБ", bytes: 200 * MB },
  { label: "500 МБ", bytes: 500 * MB },
  { label: "1 ГБ", bytes: 1 * GB },
  { label: "5 ГБ", bytes: 5 * GB },
  { label: "10 ГБ", bytes: 10 * GB },
  { label: "30 ГБ", bytes: 30 * GB },
];

export const CACHE_CLEAN_PRESETS = [
  { label: "Не очищать", ms: 0 },
  { label: "Раз в сутки", ms: 1 * DAY },
  { label: "Раз в неделю", ms: 7 * DAY },
  { label: "Раз в месяц", ms: 30 * DAY },
];

const LEGACY_DEFAULT_MAX_BYTES = 5 * GB;
const LEGACY_DEFAULT_AUTO_CLEAN_MS = 7 * DAY;
const DEFAULT_MAX_BYTES = 1 * GB;
const IOS_DEFAULT_MAX_BYTES = 200 * MB;
const IOS_DEFAULT_AUTO_CLEAN_MS = 1 * DAY;

function isAppleMobile(): boolean {
  try {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    const ua = String(nav?.userAgent || "");
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS often reports "Macintosh" but has touch points.
    if (/Macintosh/i.test(ua) && Number(nav?.maxTouchPoints || 0) > 1) return true;
    return false;
  } catch {
    return false;
  }
}

function defaultPrefs(): FileCachePrefs {
  const appleMobile = isAppleMobile();
  return {
    maxBytes: appleMobile ? IOS_DEFAULT_MAX_BYTES : DEFAULT_MAX_BYTES,
    autoCleanMs: appleMobile ? IOS_DEFAULT_AUTO_CLEAN_MS : LEGACY_DEFAULT_AUTO_CLEAN_MS,
    lastCleanAt: 0,
    userSetMaxBytes: false,
    userSetAutoCleanMs: false,
  };
}

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_file_cache_prefs_v${PREFS_VERSION}:${id}`;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function normalizePrefs(raw: unknown): FileCachePrefs {
  const defaults = defaultPrefs();
  if (!raw || typeof raw !== "object") return { ...defaults };
  const obj = raw as any;
  const rawMaxBytes = Number(obj.maxBytes ?? defaults.maxBytes);
  const rawAutoCleanMs = Number(obj.autoCleanMs ?? defaults.autoCleanMs);
  const lastCleanAt = Number(obj.lastCleanAt ?? 0);

  const storedUserSetMaxBytes = obj.userSetMaxBytes;
  const inferredUserSetMaxBytes =
    Number.isFinite(rawMaxBytes) && rawMaxBytes >= 0 && Math.round(rawMaxBytes) !== LEGACY_DEFAULT_MAX_BYTES;
  const userSetMaxBytes =
    typeof storedUserSetMaxBytes === "boolean" ? storedUserSetMaxBytes : Boolean(obj.maxBytes !== undefined && inferredUserSetMaxBytes);

  const storedUserSetAutoCleanMs = obj.userSetAutoCleanMs;
  const inferredUserSetAutoCleanMs =
    Number.isFinite(rawAutoCleanMs) && rawAutoCleanMs >= 0 && Math.round(rawAutoCleanMs) !== LEGACY_DEFAULT_AUTO_CLEAN_MS;
  const userSetAutoCleanMs =
    typeof storedUserSetAutoCleanMs === "boolean"
      ? storedUserSetAutoCleanMs
      : Boolean(obj.autoCleanMs !== undefined && inferredUserSetAutoCleanMs);

  const maxBytes = Number.isFinite(rawMaxBytes) && rawMaxBytes >= 0 ? Math.round(rawMaxBytes) : defaults.maxBytes;
  const autoCleanMs =
    Number.isFinite(rawAutoCleanMs) && rawAutoCleanMs >= 0 ? Math.round(rawAutoCleanMs) : defaults.autoCleanMs;
  const allowedMax = new Set(CACHE_SIZE_PRESETS.map((p) => p.bytes));
  const allowedClean = new Set(CACHE_CLEAN_PRESETS.map((p) => p.ms));
  const appleMobile = isAppleMobile();
  const normalizedMaxBytes = (() => {
    const fromPreset = allowedMax.has(maxBytes) ? maxBytes : defaults.maxBytes;
    if (!appleMobile || userSetMaxBytes) return fromPreset;
    return Math.min(fromPreset, IOS_DEFAULT_MAX_BYTES);
  })();
  const normalizedAutoCleanMs = (() => {
    const fromPreset = allowedClean.has(autoCleanMs) ? autoCleanMs : defaults.autoCleanMs;
    if (!appleMobile || userSetAutoCleanMs) return fromPreset;
    return Math.min(fromPreset, IOS_DEFAULT_AUTO_CLEAN_MS);
  })();
  return {
    maxBytes: normalizedMaxBytes,
    autoCleanMs: normalizedAutoCleanMs,
    lastCleanAt: Number.isFinite(lastCleanAt) && lastCleanAt > 0 ? Math.round(lastCleanAt) : 0,
    userSetMaxBytes,
    userSetAutoCleanMs,
  };
}

export function loadFileCachePrefs(userId: string): FileCachePrefs {
  const key = storageKey(userId);
  if (!key) return defaultPrefs();
  const st = defaultStorage();
  if (!st) return defaultPrefs();
  try {
    const raw = st.getItem(key);
    if (!raw) return defaultPrefs();
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return defaultPrefs();
  }
}

export function saveFileCachePrefs(userId: string, prefs: FileCachePrefs): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = defaultStorage();
  if (!st) return;
  try {
    const payload = JSON.stringify(normalizePrefs(prefs));
    st.setItem(key, payload);
  } catch {
    // ignore
  }
}
