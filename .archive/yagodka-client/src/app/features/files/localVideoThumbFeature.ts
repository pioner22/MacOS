import { clampMediaAspectRatio, setCachedMediaAspectRatio } from "../../../helpers/chat/mediaAspectCache";
import { isVideoLikeFile } from "../../../helpers/files/mediaKind";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface LocalVideoThumbFeatureDeps {
  store: Store<AppState>;
  prefetchAllowed: boolean;
  constrained: boolean;
  slowNetwork: boolean;
  fileThumbMaxEntries: number;
  thumbCacheId: (fileId: string) => string;
  enqueueFileGet: (fileId: string, opts?: { priority?: "high" | "prefetch"; silent?: boolean }) => void;
  shouldCachePreview: (name: string, mime: string, size: number) => boolean;
  enforceFileCachePolicy: (userId: string, opts?: { force?: boolean }) => Promise<void> | void;
  putCachedFileBlob: (
    userId: string,
    cacheKey: string,
    blob: Blob,
    meta: { name: string; mime: string | null; size: number; w?: number; h?: number; mediaW?: number; mediaH?: number }
  ) => Promise<void> | void;
}

export interface LocalVideoThumbFeature {
  clearFileThumb: (fileId: string) => void;
  setFileThumb: (
    fileId: string,
    url: string,
    mime: string | null,
    meta?: { w?: number | null; h?: number | null; mediaW?: number | null; mediaH?: number | null }
  ) => void;
  clearThumbPollRetry: (fileId: string) => void;
  scheduleThumbPollRetry: (fileId: string) => void;
  maybeSetLocalOutgoingVideoPoster: (fileId: string, file: File) => void;
  maybeSetVideoPosterFromBlob: (
    fileId: string,
    blob: Blob,
    meta?: { name?: string | null; mime?: string | null }
  ) => void;
}

type FileThumbEntry = {
  url: string;
  mime: string | null;
  ts: number;
  w?: number | null;
  h?: number | null;
  mediaW?: number | null;
  mediaH?: number | null;
};

function activeViewerUsesUrl(state: AppState, fileId: string, url: string): boolean {
  const fid = String(fileId || "").trim();
  const targetUrl = String(url || "").trim();
  const modal = state.modal;
  if (!fid || !targetUrl || !modal || modal.kind !== "file_viewer") return false;
  return String(modal.fileId || "").trim() === fid && String(modal.url || "").trim() === targetUrl;
}

function revokeThumbUrlIfUnused(state: AppState, fileId: string, url: string): void {
  const targetUrl = String(url || "").trim();
  if (!targetUrl || activeViewerUsesUrl(state, fileId, targetUrl)) return;
  try {
    URL.revokeObjectURL(targetUrl);
  } catch {
    // ignore
  }
}

export function createLocalVideoThumbFeature(deps: LocalVideoThumbFeatureDeps): LocalVideoThumbFeature {
  const {
    store,
    prefetchAllowed,
    constrained,
    slowNetwork,
    fileThumbMaxEntries,
    thumbCacheId,
    enqueueFileGet,
    shouldCachePreview,
    enforceFileCachePolicy,
    putCachedFileBlob,
  } = deps;

  const thumbPollRetries = new Map<string, { attempts: number; timer: number | null; startedAt: number }>();
  const THUMB_POLL_BASE_MS = slowNetwork ? 1100 : constrained ? 750 : 450;
  const THUMB_POLL_MAX_DELAY_MS = slowNetwork ? 9000 : 8000;
  const THUMB_POLL_MAX_ATTEMPTS = slowNetwork ? 12 : constrained ? 14 : 16;
  const THUMB_POLL_MAX_WINDOW_MS = slowNetwork ? 240_000 : constrained ? 210_000 : 180_000;

  const localVideoPosterInFlight = new Set<string>();
  const LOCAL_VIDEO_POSTER_MAX_SIDE = 512;
  const MB = 1024 * 1024;
  const LOCAL_VIDEO_POSTER_MAX_BYTES = constrained ? 40 * MB : 200 * MB;

  const clearFileThumb = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    store.set((prev) => {
      const existing = prev.fileThumbs?.[fid] || null;
      if (!existing) return prev;
      revokeThumbUrlIfUnused(prev, fid, existing.url);
      const nextThumbs = { ...(prev.fileThumbs || {}) };
      delete nextThumbs[fid];
      return { ...prev, fileThumbs: nextThumbs };
    });
  };

  const setFileThumb = (
    fileId: string,
    url: string,
    mime: string | null,
    meta?: { w?: number | null; h?: number | null; mediaW?: number | null; mediaH?: number | null }
  ) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const nextUrl = String(url || "").trim();
    if (!nextUrl) return;
    const ts = Date.now();
    store.set((prev) => {
      const existing = prev.fileThumbs?.[fid] || null;
      if (existing?.url && existing.url !== nextUrl) {
        revokeThumbUrlIfUnused(prev, fid, existing.url);
      }
      let nextThumbs: Record<string, FileThumbEntry> = {
        ...(prev.fileThumbs || {}),
        [fid]: {
          url: nextUrl,
          mime: mime ?? null,
          ts,
          w: typeof meta?.w === "number" && Number.isFinite(meta.w) && meta.w > 0 ? Math.trunc(meta.w) : (existing?.w ?? null),
          h: typeof meta?.h === "number" && Number.isFinite(meta.h) && meta.h > 0 ? Math.trunc(meta.h) : (existing?.h ?? null),
          mediaW:
            typeof meta?.mediaW === "number" && Number.isFinite(meta.mediaW) && meta.mediaW > 0
              ? Math.trunc(meta.mediaW)
              : (existing?.mediaW ?? null),
          mediaH:
            typeof meta?.mediaH === "number" && Number.isFinite(meta.mediaH) && meta.mediaH > 0
              ? Math.trunc(meta.mediaH)
              : (existing?.mediaH ?? null),
        },
      };
      const keys = Object.keys(nextThumbs);
      if (keys.length > fileThumbMaxEntries) {
        const sorted = keys.map((k) => ({ k, ts: Number(nextThumbs[k]?.ts ?? 0) || 0 })).sort((a, b) => a.ts - b.ts);
        const drop = sorted.slice(0, Math.max(0, keys.length - fileThumbMaxEntries)).map((x) => x.k);
        if (drop.length) {
          nextThumbs = { ...nextThumbs };
          for (const key of drop) {
            const entry = nextThumbs[key];
            if (entry?.url) {
              revokeThumbUrlIfUnused(prev, key, entry.url);
            }
            delete nextThumbs[key];
          }
        }
      }
      return { ...prev, fileThumbs: nextThumbs };
    });
  };

  const clearThumbPollRetry = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const entry = thumbPollRetries.get(fid);
    if (entry?.timer) {
      try {
        window.clearTimeout(entry.timer);
      } catch {
        // ignore
      }
    }
    thumbPollRetries.delete(fid);
  };

  const scheduleThumbPollRetry = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    if (document.visibilityState === "hidden") return;
    const st = store.get();
    if (!st.authed || st.conn !== "connected" || !st.selfId) return;
    if (st.fileThumbs?.[fid]?.url) {
      clearThumbPollRetry(fid);
      return;
    }
    const now = Date.now();
    const existing = thumbPollRetries.get(fid) || null;
    if (existing?.timer) return;
    const startedAt = existing?.startedAt ?? now;
    const attempts = existing?.attempts ?? 0;
    if (attempts >= THUMB_POLL_MAX_ATTEMPTS || now - startedAt > THUMB_POLL_MAX_WINDOW_MS) {
      try {
        const dbg = (globalThis as any).__yagodka_debug_monitor;
        if (dbg && typeof dbg.push === "function") {
          dbg.push("file.thumb.poll.stop", {
            fileId: fid,
            attempts,
            elapsed_ms: Math.max(0, now - startedAt),
            reason: attempts >= THUMB_POLL_MAX_ATTEMPTS ? "max_attempts" : "window_exceeded",
          });
        }
      } catch {
        // ignore
      }
      clearThumbPollRetry(fid);
      return;
    }
    const base = attempts <= 0 ? THUMB_POLL_BASE_MS : Math.min(THUMB_POLL_MAX_DELAY_MS, THUMB_POLL_BASE_MS * Math.pow(2, attempts));
    const jitter = Math.round(base * (0.12 + Math.random() * 0.18));
    const delay = base + jitter;
    const timer = window.setTimeout(() => {
      const cur = thumbPollRetries.get(fid);
      if (cur) thumbPollRetries.set(fid, { attempts: cur.attempts + 1, timer: null, startedAt: cur.startedAt });
      const latest = store.get();
      if (!latest.authed || latest.conn !== "connected" || !latest.selfId) {
        clearThumbPollRetry(fid);
        return;
      }
      if (latest.fileThumbs?.[fid]?.url) {
        clearThumbPollRetry(fid);
        return;
      }
      enqueueFileGet(fid, { priority: prefetchAllowed ? "prefetch" : "high", silent: true });
    }, delay);
    thumbPollRetries.set(fid, { attempts, timer, startedAt });
  };

  const renderLocalVideoPosterJpeg = async (
    file: Blob,
    opts: { maxSide?: number; timeoutMs?: number } = {}
  ): Promise<{ blob: Blob; w: number; h: number; mediaW: number; mediaH: number } | null> => {
    const maxSide = Math.max(64, Math.min(2048, Math.trunc(Number(opts.maxSide ?? LOCAL_VIDEO_POSTER_MAX_SIDE) || LOCAL_VIDEO_POSTER_MAX_SIDE)));
    const timeoutMs = Math.max(600, Math.min(8000, Math.trunc(Number(opts.timeoutMs ?? 2800) || 2800)));
    let srcUrl: string | null = null;
    try {
      srcUrl = URL.createObjectURL(file);
    } catch {
      srcUrl = null;
    }
    if (!srcUrl) return null;

    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.src = srcUrl;

    const waitEvent = (event: string, ms: number) =>
      new Promise<void>((resolve, reject) => {
        let done = false;
        const onOk = () => {
          if (done) return;
          done = true;
          cleanup();
          resolve();
        };
        const onErr = () => {
          if (done) return;
          done = true;
          cleanup();
          reject(new Error("video_error"));
        };
        const timer = window.setTimeout(() => {
          if (done) return;
          done = true;
          cleanup();
          reject(new Error("timeout"));
        }, ms);
        const cleanup = () => {
          try {
            window.clearTimeout(timer);
          } catch {
            // ignore
          }
          video.removeEventListener(event, onOk);
          video.removeEventListener("error", onErr);
          video.removeEventListener("abort", onErr);
        };
        video.addEventListener(event, onOk);
        video.addEventListener("error", onErr);
        video.addEventListener("abort", onErr);
      });

    try {
      if (video.readyState < 1) await waitEvent("loadedmetadata", timeoutMs);
      const dur = Number.isFinite(video.duration) ? Number(video.duration) : 0;
      const seekTo = dur > 0 ? Math.min(1, Math.max(0, dur * 0.12)) : 0;
      if (seekTo > 0) {
        try {
          video.currentTime = seekTo;
        } catch {
          // ignore
        }
        try {
          await waitEvent("seeked", timeoutMs);
        } catch {
          // ignore
        }
      }
      if (video.readyState < 2) {
        try {
          await waitEvent("loadeddata", timeoutMs);
        } catch {
          // ignore
        }
      }
      const mediaW = Math.trunc(Number(video.videoWidth || 0) || 0);
      const mediaH = Math.trunc(Number(video.videoHeight || 0) || 0);
      if (!mediaW || !mediaH) return null;
      const scale = Math.min(1, maxSide / Math.max(mediaW, mediaH));
      const w = Math.max(1, Math.round(mediaW * scale));
      const h = Math.max(1, Math.round(mediaH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) return null;
      return { blob, w, h, mediaW, mediaH };
    } catch {
      return null;
    } finally {
      try {
        video.pause();
      } catch {
        // ignore
      }
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        // ignore
      }
      try {
        URL.revokeObjectURL(srcUrl);
      } catch {
        // ignore
      }
    }
  };

  const maybeSetVideoPosterFromBlob = (
    fileId: string,
    file: Blob,
    meta?: { name?: string | null; mime?: string | null }
  ) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    if (!file) return;
    const bytes = Number(file.size || 0) || 0;
    if (!bytes || bytes <= 0 || bytes > LOCAL_VIDEO_POSTER_MAX_BYTES) return;
    const fileName =
      typeof meta?.name === "string" && meta.name.trim()
        ? meta.name.trim()
        : typeof File !== "undefined" && file instanceof File
          ? String(file.name || "").trim()
          : "video";
    const mime =
      typeof meta?.mime === "string" && meta.mime.trim()
        ? meta.mime.trim()
        : typeof file.type === "string"
          ? String(file.type).trim()
          : "";
    if (!isVideoLikeFile(fileName, mime || null)) return;
    const st = store.get();
    if (st.fileThumbs?.[fid]?.url) return;
    if (localVideoPosterInFlight.has(fid)) return;
    localVideoPosterInFlight.add(fid);
    void (async () => {
      try {
        const rendered = await renderLocalVideoPosterJpeg(file);
        if (!rendered) return;
        const latest = store.get();
        if (latest.fileThumbs?.[fid]?.url) return;
        const ratio = rendered.mediaW / Math.max(1, rendered.mediaH);
        try {
          setCachedMediaAspectRatio(fid, clampMediaAspectRatio(ratio));
        } catch {
          // ignore
        }
        let url: string | null = null;
        try {
          url = URL.createObjectURL(rendered.blob);
        } catch {
          url = null;
        }
        if (!url) return;
        setFileThumb(fid, url, "image/jpeg", { w: rendered.w, h: rendered.h, mediaW: rendered.mediaW, mediaH: rendered.mediaH });
        try {
          if (latest.selfId && shouldCachePreview(fileName || "видео", "image/jpeg", rendered.blob.size || 0)) {
            void putCachedFileBlob(latest.selfId, thumbCacheId(fid), rendered.blob, {
              name: fileName || "thumb.jpg",
              mime: "image/jpeg",
              size: rendered.blob.size || 0,
              w: rendered.w,
              h: rendered.h,
              mediaW: rendered.mediaW,
              mediaH: rendered.mediaH,
            });
            void enforceFileCachePolicy(latest.selfId, { force: true });
          }
        } catch {
          // ignore
        }
      } catch {
        // ignore
      } finally {
        localVideoPosterInFlight.delete(fid);
      }
    })();
  };

  const maybeSetLocalOutgoingVideoPoster = (fileId: string, file: File) => {
    maybeSetVideoPosterFromBlob(fileId, file, { name: file?.name || null, mime: file?.type || null });
  };

  return {
    clearFileThumb,
    setFileThumb,
    clearThumbPollRetry,
    scheduleThumbPollRetry,
    maybeSetLocalOutgoingVideoPoster,
    maybeSetVideoPosterFromBlob,
  };
}
