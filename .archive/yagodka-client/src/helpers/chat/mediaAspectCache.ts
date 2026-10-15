const MEDIA_ASPECT_RATIO_MIN = 0.4;
const MEDIA_ASPECT_RATIO_MAX = 3.2;
const MEDIA_ASPECT_RATIO_MAX_ENTRIES = 2000;

const STORAGE_VERSION = 1;
const STORAGE_KEY = `yagodka_media_aspect_cache_v${STORAGE_VERSION}`;

const mediaAspectCache = new Map<string, number>();
let loadedFromStorage = false;
let persistTimer: number | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function ensureLoadedFromStorage(): void {
  if (loadedFromStorage) return;
  loadedFromStorage = true;
  const st = storage();
  if (!st) return;
  try {
    const raw = st.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.v !== STORAGE_VERSION) return;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const it of entries) {
      if (!Array.isArray(it) || it.length < 2) continue;
      const fileId = String(it[0] || "").trim();
      const ratio = Number(it[1]);
      if (!fileId) continue;
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      mediaAspectCache.set(fileId, clampMediaAspectRatio(ratio));
      if (mediaAspectCache.size >= MEDIA_ASPECT_RATIO_MAX_ENTRIES) break;
    }
  } catch {
    // ignore
  }
}

function schedulePersist(): void {
  const st = storage();
  if (!st) return;
  if (persistTimer !== null) return;
  persistTimer = globalThis.setTimeout(() => {
    persistTimer = null;
    try {
      const entries = Array.from(mediaAspectCache.entries());
      st.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, entries }));
    } catch {
      // ignore
    }
  }, 900) as unknown as number;
}

export function clampMediaAspectRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(MEDIA_ASPECT_RATIO_MAX, Math.max(MEDIA_ASPECT_RATIO_MIN, ratio));
}

export function getCachedMediaAspectRatio(fileId: string): number | null {
  ensureLoadedFromStorage();
  const id = String(fileId || "").trim();
  if (!id) return null;
  const value = mediaAspectCache.get(id);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function setCachedMediaAspectRatio(fileId: string, ratio: number): number | null {
  ensureLoadedFromStorage();
  const id = String(fileId || "").trim();
  if (!id) return null;
  const clamped = clampMediaAspectRatio(ratio);
  mediaAspectCache.set(id, clamped);
  while (mediaAspectCache.size > MEDIA_ASPECT_RATIO_MAX_ENTRIES) {
    const first = mediaAspectCache.keys().next().value as string | undefined;
    if (!first) break;
    mediaAspectCache.delete(first);
  }
  schedulePersist();
  return clamped;
}
