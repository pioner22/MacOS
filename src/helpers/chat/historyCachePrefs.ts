const PREFS_VERSION = 1;

export interface HistoryCachePrefs {
  keepLatestPerConvo: number;
  userSetKeepLatestPerConvo?: boolean;
}

export const HISTORY_KEEP_PRESETS: Array<{ label: string; keep: number }> = [
  { label: "1 000 сообщений", keep: 1000 },
  { label: "3 000 сообщений", keep: 3000 },
  { label: "6 000 сообщений", keep: 6000 },
  { label: "15 000 сообщений", keep: 15000 },
];

const DEFAULT_KEEP_LATEST = 3000;
const IOS_DEFAULT_KEEP_LATEST = 1000;

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

function defaultPrefs(): HistoryCachePrefs {
  const appleMobile = isAppleMobile();
  return {
    keepLatestPerConvo: appleMobile ? IOS_DEFAULT_KEEP_LATEST : DEFAULT_KEEP_LATEST,
    userSetKeepLatestPerConvo: false,
  };
}

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_history_cache_prefs_v${PREFS_VERSION}:${id}`;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function normalizePrefs(raw: unknown): HistoryCachePrefs {
  const defaults = defaultPrefs();
  if (!raw || typeof raw !== "object") return { ...defaults };
  const obj = raw as any;

  const rawKeep = Number(obj.keepLatestPerConvo ?? defaults.keepLatestPerConvo);
  const keepLatestPerConvo =
    Number.isFinite(rawKeep) && rawKeep > 0 ? Math.round(rawKeep) : defaults.keepLatestPerConvo;

  const allowed = new Set(HISTORY_KEEP_PRESETS.map((p) => p.keep));
  const normalizedKeep = allowed.has(keepLatestPerConvo) ? keepLatestPerConvo : defaults.keepLatestPerConvo;

  const storedUserSet = obj.userSetKeepLatestPerConvo;
  const inferredUserSet = keepLatestPerConvo !== defaults.keepLatestPerConvo;
  const userSetKeepLatestPerConvo =
    typeof storedUserSet === "boolean" ? storedUserSet : Boolean(obj.keepLatestPerConvo !== undefined && inferredUserSet);

  const appleMobile = isAppleMobile();
  const finalKeep = (() => {
    if (!appleMobile || userSetKeepLatestPerConvo) return normalizedKeep;
    return Math.min(normalizedKeep, IOS_DEFAULT_KEEP_LATEST);
  })();

  return {
    keepLatestPerConvo: finalKeep,
    userSetKeepLatestPerConvo,
  };
}

export function loadHistoryCachePrefs(userId: string): HistoryCachePrefs {
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

export function saveHistoryCachePrefs(userId: string, prefs: HistoryCachePrefs): void {
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

