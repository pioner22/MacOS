import { getCachedFileBlob, putCachedFileBlob } from "../../../helpers/files/fileBlobCache";
import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";

type ThumbEntry = {
  url: string;
  mime: string | null;
  ts: number;
  w?: number | null;
  h?: number | null;
  mediaW?: number | null;
  mediaH?: number | null;
};

type PreviewTransferItem = {
  fileId: string;
  name: string;
  size: number;
  mime: string | null;
  kind?: "image" | "video" | "audio";
  direction: "in" | "out";
  peer: string;
  room: string | null;
};

function activeViewerUsesUrl(state: AppState, fileId: string, url: string): boolean {
  const fid = String(fileId || "").trim();
  const targetUrl = String(url || "").trim();
  const modal = state.modal;
  if (!fid || !targetUrl || !modal || modal.kind !== "file_viewer") return false;
  return String(modal.fileId || "").trim() === fid && String(modal.url || "").trim() === targetUrl;
}

function revokePreviewUrlIfUnused(state: AppState, fileId: string, url: string): void {
  const targetUrl = String(url || "").trim();
  if (!targetUrl || activeViewerUsesUrl(state, fileId, targetUrl)) return;
  try {
    URL.revokeObjectURL(targetUrl);
  } catch {
    // ignore
  }
}

export interface CachedPreviewRestoreFeatureDeps {
  store: Store<AppState>;
  thumbCacheId: (fileId: string) => string;
  shouldAttemptCachedPreview: (cacheKey: string) => boolean;
  shouldAttemptCachedThumb: (cacheKey: string) => boolean;
  probeImageDimensions: (blob: Blob) => Promise<{ w: number | null; h: number | null }>;
  scheduleSaveFileTransfers: () => void;
  fileThumbMaxEntries: number;
}

export interface CachedPreviewRestoreFeature {
  restoreCachedThumbsIntoStateBatch: (fileIds: string[]) => Promise<Set<string>>;
  restoreCachedPreviewsIntoTransfersBatch: (items: PreviewTransferItem[]) => Promise<Set<string>>;
}

export function createCachedPreviewRestoreFeature(
  deps: CachedPreviewRestoreFeatureDeps
): CachedPreviewRestoreFeature {
  const {
    store,
    thumbCacheId,
    shouldAttemptCachedPreview,
    shouldAttemptCachedThumb,
    probeImageDimensions,
    scheduleSaveFileTransfers,
    fileThumbMaxEntries,
  } = deps;

  const trimThumbsToLimit = (thumbs: Record<string, ThumbEntry>): Record<string, ThumbEntry> => {
    const keys = Object.keys(thumbs);
    if (keys.length <= fileThumbMaxEntries) return thumbs;
    const sorted = keys.map((k) => ({ k, ts: Number(thumbs[k]?.ts ?? 0) || 0 })).sort((a, b) => a.ts - b.ts);
    const drop = sorted.slice(0, Math.max(0, keys.length - fileThumbMaxEntries)).map((x) => x.k);
    if (!drop.length) return thumbs;
    const next = { ...thumbs };
    for (const key of drop) {
      const entry = next[key];
      if (entry?.url) {
        revokePreviewUrlIfUnused(store.get(), key, entry.url);
      }
      delete next[key];
    }
    return next;
  };

  const restoreCachedThumbsIntoStateBatch = async (fileIds: string[]): Promise<Set<string>> => {
    const st = store.get();
    if (!st.authed || !st.selfId) return new Set();
    const uid = st.selfId;
    const existingWithUrl = new Set(
      Object.entries(st.fileThumbs || {})
        .filter(([, entry]) => Boolean(entry?.url))
        .map(([fid]) => fid)
    );

    const restored = new Map<
      string,
      { url: string; mime: string | null; w?: number | null; h?: number | null; mediaW?: number | null; mediaH?: number | null }
    >();
    for (const fileId of fileIds) {
      const fid = String(fileId || "").trim();
      if (!fid || restored.has(fid) || existingWithUrl.has(fid)) continue;
      const cacheKey = `thumb:${uid}:${fid}`;
      if (!shouldAttemptCachedThumb(cacheKey)) continue;
      const cached = await getCachedFileBlob(uid, thumbCacheId(fid));
      if (!cached) continue;

      let w = cached.w ?? null;
      let h = cached.h ?? null;
      if ((!w || !h) && cached.blob) {
        try {
          const probed = await probeImageDimensions(cached.blob);
          w = probed.w ?? null;
          h = probed.h ?? null;
          if ((!cached.w || !cached.h) && w && h) {
            void putCachedFileBlob(uid, thumbCacheId(fid), cached.blob, {
              mime: cached.mime || null,
              size: cached.size || cached.blob.size || 0,
              w,
              h,
              mediaW: cached.mediaW ?? null,
              mediaH: cached.mediaH ?? null,
            });
          }
        } catch {
          // ignore
        }
      }

      let url: string | null = null;
      try {
        url = URL.createObjectURL(cached.blob);
      } catch {
        url = null;
      }
      if (!url) continue;

      restored.set(fid, {
        url,
        mime: cached.mime || null,
        w,
        h,
        mediaW: cached.mediaW ?? null,
        mediaH: cached.mediaH ?? null,
      });
      if (restored.size >= 18) break;
    }

    if (!restored.size) return new Set();
    const restoredIds = new Set(restored.keys());

    store.set((prev) => {
      const now = Date.now();
      let nextThumbs: Record<string, ThumbEntry> = { ...(prev.fileThumbs || {}) };
      for (const fid of restoredIds) {
        const payload = restored.get(fid) || null;
        const nextUrl = payload?.url || "";
        if (!nextUrl) continue;
        const existing = nextThumbs[fid];
        if (existing?.url && existing.url !== nextUrl) {
          revokePreviewUrlIfUnused(prev, fid, existing.url);
        }
        nextThumbs[fid] = {
          url: nextUrl,
          mime: payload?.mime ?? null,
          ts: now,
          w: payload?.w ?? existing?.w ?? null,
          h: payload?.h ?? existing?.h ?? null,
          mediaW: payload?.mediaW ?? existing?.mediaW ?? null,
          mediaH: payload?.mediaH ?? existing?.mediaH ?? null,
        };
      }
      nextThumbs = trimThumbsToLimit(nextThumbs);
      return { ...prev, fileThumbs: nextThumbs };
    });

    return restoredIds;
  };

  const restoreCachedPreviewsIntoTransfersBatch = async (items: PreviewTransferItem[]): Promise<Set<string>> => {
    const st = store.get();
    if (!st.authed || !st.selfId) return new Set();
    const uid = st.selfId;

    const existingWithUrl = new Set(
      (st.fileTransfers || [])
        .filter((t) => String(t.id || "").trim() && Boolean(t.url))
        .map((t) => String(t.id || "").trim())
    );

    const restored = new Map<string, { url: string; item: PreviewTransferItem }>();
    for (const item of items) {
      const fid = String(item.fileId || "").trim();
      if (!fid || restored.has(fid) || existingWithUrl.has(fid)) continue;
      const cacheKey = `${uid}:${fid}`;
      if (!shouldAttemptCachedPreview(cacheKey)) continue;
      const cached = await getCachedFileBlob(uid, fid);
      if (!cached) continue;

      let url: string | null = null;
      try {
        url = URL.createObjectURL(cached.blob);
      } catch {
        url = null;
      }
      if (!url) continue;

      restored.set(fid, { url, item: { ...item, fileId: fid } });
      if (restored.size >= 14) break;
    }

    if (!restored.size) return new Set();
    const restoredIds = new Set(restored.keys());

    store.set((prev) => {
      let changed = false;
      const nextTransfers = prev.fileTransfers.map((t): FileTransferEntry => {
        const fid = String(t.id || "").trim();
        if (!fid || !restoredIds.has(fid)) return t;
        const nextUrl = restored.get(fid)?.url || "";
        if (!nextUrl) return t;
        if (t.url && t.url !== nextUrl) {
          try {
            URL.revokeObjectURL(t.url);
          } catch {
            // ignore
          }
        }
        const meta = restored.get(fid)?.item || null;
        changed = true;
        return {
          ...t,
          status: "complete",
          progress: 100,
          ...(meta && (!t.name || t.name === "файл") ? { name: meta.name } : {}),
          ...(meta && (!t.size || t.size <= 0) ? { size: meta.size } : {}),
          ...(meta && (!t.mime || !t.mime.trim()) ? { mime: meta.mime } : {}),
          url: nextUrl,
        };
      });

      const present = new Set(nextTransfers.map((t) => String(t.id || "").trim()).filter(Boolean));
      const added: FileTransferEntry[] = [];
      for (const fid of restoredIds) {
        if (present.has(fid)) continue;
        const meta = restored.get(fid)?.item || null;
        const url = restored.get(fid)?.url || "";
        if (!meta || !url) continue;
        added.push({
          localId: `ft-cache-${fid}`,
          id: fid,
          name: meta.name || "файл",
          size: Number(meta.size || 0) || 0,
          mime: meta.mime || null,
          direction: meta.direction,
          peer: meta.peer || "—",
          room: meta.room,
          status: "complete",
          progress: 100,
          url,
        });
      }

      if (!changed && !added.length) return prev;
      return applyFileTransferMutation(prev, added.length ? [...added, ...nextTransfers] : nextTransfers);
    });

    scheduleSaveFileTransfers();
    return restoredIds;
  };

  return {
    restoreCachedThumbsIntoStateBatch,
    restoreCachedPreviewsIntoTransfersBatch,
  };
}
