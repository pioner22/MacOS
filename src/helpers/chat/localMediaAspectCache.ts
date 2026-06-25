import { clampMediaAspectRatio } from "./mediaAspectCache";

const LOCAL_MEDIA_ASPECT_RATIO_MAX_ENTRIES = 2000;

const localMediaAspectCache = new Map<string, number>();

export function getCachedLocalMediaAspectRatio(localId: string): number | null {
  const id = String(localId || "").trim();
  if (!id) return null;
  const value = localMediaAspectCache.get(id);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function setCachedLocalMediaAspectRatio(localId: string, ratio: number): number | null {
  const id = String(localId || "").trim();
  if (!id) return null;
  const clamped = clampMediaAspectRatio(ratio);
  localMediaAspectCache.set(id, clamped);
  while (localMediaAspectCache.size > LOCAL_MEDIA_ASPECT_RATIO_MAX_ENTRIES) {
    const first = localMediaAspectCache.keys().next().value as string | undefined;
    if (!first) break;
    localMediaAspectCache.delete(first);
  }
  return clamped;
}

