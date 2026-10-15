const PREFS_VERSION = 1;
const MB = 1024 * 1024;

export interface AutoDownloadPrefs {
  photoMaxBytes: number;
  videoMaxBytes: number;
  fileMaxBytes: number;
}

export const DEFAULT_AUTO_DOWNLOAD_PREFS: AutoDownloadPrefs = {
  photoMaxBytes: 1 * MB,
  videoMaxBytes: 15 * MB,
  fileMaxBytes: 3 * MB,
};

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_auto_download_prefs_v${PREFS_VERSION}:${id}`;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function clampBytes(raw: unknown, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  // Hard upper cap to avoid runaway values from corrupted storage.
  return Math.min(250 * MB, rounded);
}

function normalizePrefs(raw: unknown): AutoDownloadPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AUTO_DOWNLOAD_PREFS };
  const obj = raw as any;
  return {
    photoMaxBytes: clampBytes(obj.photoMaxBytes, DEFAULT_AUTO_DOWNLOAD_PREFS.photoMaxBytes),
    videoMaxBytes: clampBytes(obj.videoMaxBytes, DEFAULT_AUTO_DOWNLOAD_PREFS.videoMaxBytes),
    fileMaxBytes: clampBytes(obj.fileMaxBytes, DEFAULT_AUTO_DOWNLOAD_PREFS.fileMaxBytes),
  };
}

export function loadAutoDownloadPrefs(userId: string): AutoDownloadPrefs {
  const key = storageKey(userId);
  if (!key) return { ...DEFAULT_AUTO_DOWNLOAD_PREFS };
  const st = defaultStorage();
  if (!st) return { ...DEFAULT_AUTO_DOWNLOAD_PREFS };
  try {
    const raw = st.getItem(key);
    if (!raw) return { ...DEFAULT_AUTO_DOWNLOAD_PREFS };
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUTO_DOWNLOAD_PREFS };
  }
}

export function saveAutoDownloadPrefs(userId: string, prefs: AutoDownloadPrefs): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = defaultStorage();
  if (!st) return;
  try {
    st.setItem(key, JSON.stringify(normalizePrefs(prefs)));
  } catch {
    // ignore
  }
}
