import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { rememberFileHttpBearer } from "../../../helpers/files/fileHttpAuth";
import { registerPwaReloadBlocker } from "../../../helpers/pwa/reloadSafety";
import { canDrainFilePrefetch, canDrainFileRuntime, resolveFileGetEnqueuePolicy } from "./fileRuntimePolicy";

type FileGetPriority = "high" | "prefetch";

type DeviceCapsLike = {
  constrained: boolean;
  slowNetwork: boolean;
  prefetchAllowed: boolean;
  fileGetMax: number;
  fileGetPrefetch: number;
  fileGetTimeoutMs: number;
};

export type HttpFileUrlInfo = {
  url: string;
  name: string;
  size: number;
  mime: string | null;
  sha256: string | null;
  duration_s: number | null;
  media_w: number | null;
  media_h: number | null;
  thumb_url: string | null;
  thumb_mime: string | null;
  thumb_w: number | null;
  thumb_h: number | null;
};

export interface FileGetFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => boolean;
  deviceCaps: DeviceCapsLike;
  isFileHttpDisabled: () => boolean;
  isUploadActive: (fileId: string) => boolean;
  isDownloadActive: (fileId: string) => boolean;
  resolveFileMeta: (fileId: string) => { name: string; size: number; mime: string | null };
}

export interface FileGetFeature {
  drain: () => void;
  enqueue: (fileId: string, opts?: { priority?: FileGetPriority; silent?: boolean }) => void;
  finish: (fileId: string) => void;
  touch: (fileId: string) => void;
  dropQueue: (fileId: string) => void;
  clearNotFoundRetry: (fileId: string) => void;
  scheduleNotFoundRetry: (
    fileId: string,
    opts?: { priority?: FileGetPriority; silent?: boolean; attempts?: number }
  ) => boolean;
  clearAcceptRetry: (fileId: string) => void;
  scheduleAcceptRetry: (fileId: string, attempts?: number) => void;
  requestFreshHttpDownloadUrl: (fileId: string) => Promise<HttpFileUrlInfo>;
  tryResolveHttpWaiterFromFileUrl: (msg: any) => boolean;
  rejectHttpWaiter: (fileId: string, err: Error) => void;
  isSilent: (fileId: string) => boolean;
  markSilent: (fileId: string) => void;
  clearSilent: (fileId: string) => void;
  hasPendingActivityForUpdate: () => boolean;
  reset: () => void;
}

export function createFileGetFeature(deps: FileGetFeatureDeps): FileGetFeature {
  const { store, send, deviceCaps, isFileHttpDisabled, isUploadActive, isDownloadActive, resolveFileMeta } = deps;

  const FILE_GET_MAX_CONCURRENCY = deviceCaps.fileGetMax;
  const FILE_GET_PREFETCH_CONCURRENCY = deviceCaps.fileGetPrefetch;
  const FILE_GET_TIMEOUT_MS = deviceCaps.fileGetTimeoutMs;

  const fileGetQueueHigh: string[] = [];
  const fileGetQueuePrefetch: string[] = [];
  const fileGetQueueMeta = new Map<string, { priority: FileGetPriority; silent: boolean }>();
  const fileGetInFlight = new Map<string, { priority: FileGetPriority; silent: boolean }>();
  const fileGetPrefetchInFlight = new Set<string>();
  const fileGetStartedAtMs = new Map<string, number>();
  const fileGetTimeouts = new Map<string, number>();
  const fileGetTimeoutTouchedAt = new Map<string, number>();
  const silentFileGets = new Set<string>();

  const HTTP_FILE_URL_REFRESH_TIMEOUT_MS = 12_000;
  const httpFileUrlWaiters = new Map<
    string,
    {
      promise: Promise<HttpFileUrlInfo>;
      resolve: (info: HttpFileUrlInfo) => void;
      reject: (err: Error) => void;
      timer: number | null;
    }
  >();

  const FILE_ACCEPT_RETRY_BASE_MS = 1200;
  const FILE_ACCEPT_RETRY_MAX = 4;
  const FILE_ACCEPT_RETRY_MAX_MS = 15_000;
  const fileAcceptRetries = new Map<string, { attempts: number; timer: number | null }>();

  const FILE_GET_NOT_FOUND_RETRY_BASE_MS = deviceCaps.slowNetwork ? 1400 : deviceCaps.constrained ? 1100 : 850;
  const FILE_GET_NOT_FOUND_RETRY_MAX = 6;
  const FILE_GET_NOT_FOUND_RETRY_MAX_MS = 20_000;
  const fileGetNotFoundRetries = new Map<
    string,
    { attempts: number; timer: number | null; silent: boolean; priority: FileGetPriority }
  >();
  const debugHook = (kind: string, data?: any) => {
    try {
      const dbg = (globalThis as any).__yagodka_debug_monitor;
      if (!dbg || typeof dbg.push !== "function") return;
      dbg.push(String(kind || "file.get"), data);
    } catch {
      // ignore
    }
  };
  const queueState = () => ({
    queued_high: fileGetQueueHigh.length,
    queued_prefetch: fileGetQueuePrefetch.length,
    inflight: fileGetInFlight.size,
    inflight_prefetch: fileGetPrefetchInFlight.size,
    waiters: httpFileUrlWaiters.size,
    accept_retry: fileAcceptRetries.size,
    not_found_retry: fileGetNotFoundRetries.size,
  });

  const hasPendingActivityForUpdate = (): boolean =>
    Boolean(
      fileGetQueueHigh.length ||
        fileGetQueuePrefetch.length ||
        fileGetQueueMeta.size ||
        fileGetInFlight.size ||
        fileGetPrefetchInFlight.size ||
        httpFileUrlWaiters.size ||
        fileAcceptRetries.size ||
        fileGetNotFoundRetries.size
    );
  registerPwaReloadBlocker("file_get", hasPendingActivityForUpdate);

  const isFileGetQueued = (fileId: string): boolean =>
    fileGetQueueMeta.has(fileId) || fileGetQueueHigh.includes(fileId) || fileGetQueuePrefetch.includes(fileId);

  const dropQueue = (fileId: string) => {
    const fid = String(fileId || "").trim();
    fileGetQueueMeta.delete(fileId);
    const highIdx = fileGetQueueHigh.indexOf(fid);
    if (highIdx >= 0) fileGetQueueHigh.splice(highIdx, 1);
    const prefIdx = fileGetQueuePrefetch.indexOf(fid);
    if (prefIdx >= 0) fileGetQueuePrefetch.splice(prefIdx, 1);
    if (fid) {
      debugHook("file.get.drop_queue", {
        fileId: fid,
        ...queueState(),
      });
    }
  };

  const clearTimeoutFor = (fileId: string) => {
    const timer = fileGetTimeouts.get(fileId);
    if (timer === undefined) return;
    fileGetTimeouts.delete(fileId);
    fileGetStartedAtMs.delete(fileId);
    try {
      window.clearTimeout(timer);
    } catch {
      // ignore
    }
  };

  const armTimeoutFor = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    clearTimeoutFor(fid);
    const timer = window.setTimeout(() => {
      fileGetTimeouts.delete(fid);
      if (fileGetInFlight.has(fid)) {
        const startedAt = fileGetStartedAtMs.get(fid);
        const elapsed = startedAt ? Date.now() - startedAt : 0;
        fileGetInFlight.delete(fid);
        fileGetPrefetchInFlight.delete(fid);
        silentFileGets.delete(fid);
        fileGetTimeoutTouchedAt.delete(fid);
        debugHook("file.get.timeout", {
          fileId: fid,
          timeout_ms: FILE_GET_TIMEOUT_MS,
          elapsed_ms: Math.max(0, Number(elapsed) || 0),
          ...queueState(),
        });
        drain();
      }
    }, FILE_GET_TIMEOUT_MS);
    fileGetTimeouts.set(fid, timer);
  };

  const touchTimeoutFor = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    if (!fileGetInFlight.has(fid)) return;
    const now = Date.now();
    const last = fileGetTimeoutTouchedAt.get(fid) ?? 0;
    if (last && now - last < 1500) return;
    fileGetTimeoutTouchedAt.set(fid, now);
    armTimeoutFor(fid);
  };

  const finish = (fileId: string) => {
    const meta = fileGetInFlight.get(fileId);
    if (!meta) return;
    fileGetInFlight.delete(fileId);
    const startedAt = fileGetStartedAtMs.get(fileId);
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    debugHook("file.get.finish", {
      fileId,
      reason: "done",
      duration_ms: Math.max(0, Number(elapsed) || 0),
      ...queueState(),
    });
    if (meta.priority === "prefetch") fileGetPrefetchInFlight.delete(fileId);
    clearTimeoutFor(fileId);
    fileGetTimeoutTouchedAt.delete(fileId);
    drain();
  };

  const clearNotFoundRetry = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const entry = fileGetNotFoundRetries.get(fid);
    if (entry?.timer) {
      try {
        window.clearTimeout(entry.timer);
      } catch {
        // ignore
      }
    }
    fileGetNotFoundRetries.delete(fid);
  };

  const enqueue = (fileId: string, opts?: { priority?: FileGetPriority; silent?: boolean }) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const priority = opts?.priority ?? "high";
    const silent = Boolean(opts?.silent);
    const decision = resolveFileGetEnqueuePolicy({
      priority,
      silent,
      prefetchAllowed: deviceCaps.prefetchAllowed,
      state: store.get(),
    });
    if (!decision.allow) {
      debugHook("file.get.enqueue.skip", { fileId: fid, reason: decision.reason, priority, silent, ...queueState() });
      return;
    }
    if (isDownloadActive(fid)) {
      debugHook("file.get.enqueue.skip", { fileId: fid, reason: "download_active", priority, silent, ...queueState() });
      return;
    }
    if (fileGetInFlight.has(fid) || isFileGetQueued(fid)) {
      debugHook("file.get.enqueue.skip", {
        fileId: fid,
        reason: fileGetInFlight.has(fid) ? "already_inflight" : "already_queued",
        ...queueState(),
      });
      return;
    }
    fileGetQueueMeta.set(fid, { priority, silent });
    debugHook("file.get.enqueue", {
      fileId: fid,
      priority,
      silent,
      hidden: document.visibilityState === "hidden",
      uploadActive: Boolean(isUploadActive(fid)),
      ...queueState(),
    });
    if (priority === "prefetch") fileGetQueuePrefetch.push(fid);
    else fileGetQueueHigh.push(fid);
    drain();
  };

  const scheduleNotFoundRetry = (
    fileId: string,
    opts?: { priority?: FileGetPriority; silent?: boolean; attempts?: number }
  ): boolean => {
    const fid = String(fileId || "").trim();
    if (!fid) return false;
    const prev = fileGetNotFoundRetries.get(fid);
    const silent = opts?.silent ?? prev?.silent ?? false;
    const priority = opts?.priority ?? prev?.priority ?? (silent ? "prefetch" : "high");
    const attempts = opts?.attempts ?? prev?.attempts ?? 0;
    if (attempts > FILE_GET_NOT_FOUND_RETRY_MAX) {
      clearNotFoundRetry(fid);
      return false;
    }
    clearNotFoundRetry(fid);
    const delay =
      attempts <= 0
        ? FILE_GET_NOT_FOUND_RETRY_BASE_MS
        : Math.min(FILE_GET_NOT_FOUND_RETRY_MAX_MS, FILE_GET_NOT_FOUND_RETRY_BASE_MS * Math.pow(2, attempts));
    const jitter = Math.round(delay * (0.15 + Math.random() * 0.15));
    const timer = window.setTimeout(() => {
      const st = store.get();
      if (st.conn !== "connected" || !st.authed) {
        clearNotFoundRetry(fid);
        return;
      }
      const hasThumb = Boolean(st.fileThumbs?.[fid]?.url);
      const hasUrl = st.fileTransfers.some((t) => String(t.id || "").trim() === fid && Boolean(t.url));
      if ((silent && hasThumb) || hasUrl) {
        clearNotFoundRetry(fid);
        return;
      }
      const uploading = isUploadActive(fid);
      if (uploading) {
        debugHook("file.get.notfound.retry_deferred", {
          fileId: fid,
          reason: "upload_active",
          attempts,
          ...queueState(),
        });
        scheduleNotFoundRetry(fid, { silent, priority, attempts: attempts + 1 });
        return;
      }
      fileGetNotFoundRetries.set(fid, { attempts: attempts + 1, timer: null, silent, priority });
      enqueue(fid, { priority, silent });
    }, delay + jitter);
    debugHook("file.get.notfound.retry", {
      fileId: fid,
      attempts,
      priority,
      silent,
      delay_ms: delay + jitter,
      ...queueState(),
    });
    fileGetNotFoundRetries.set(fid, { attempts, timer, silent, priority });
    return true;
  };

  const start = (fileId: string, priority: FileGetPriority) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    if (fileGetInFlight.has(fid)) return;
    const meta = fileGetQueueMeta.get(fid);
    const silent = Boolean(meta?.silent);
    fileGetQueueMeta.delete(fid);
    const uploading = isUploadActive(fid);
    if (uploading) {
      scheduleNotFoundRetry(fid, { priority, silent });
      if (!silent) store.set({ status: "Файл ещё загружается на сервер" });
      debugHook("file.get.start_deferred", {
        fileId: fid,
        reason: "upload_active",
        priority,
        ...queueState(),
      });
      return;
    }
    clearNotFoundRetry(fid);
    fileGetInFlight.set(fid, { priority, silent });
    fileGetStartedAtMs.set(fid, Date.now());
    debugHook("file.get.start", {
      fileId: fid,
      priority,
      silent,
      ...queueState(),
    });
    if (priority === "prefetch") fileGetPrefetchInFlight.add(fid);
    if (silent) silentFileGets.add(fid);
    const fileHttpDisabled = isFileHttpDisabled();
    const wantsHttp = silent || !fileHttpDisabled;
    debugHook("file.get.transport", {
      fileId: fid,
      silent,
      fileHttpDisabled,
      transport: wantsHttp ? "http" : "ws",
      ...(wantsHttp && fileHttpDisabled ? { note: "silent_forced_http" } : {}),
    });
    const ok = send({ type: "file_get", file_id: fid, ...(wantsHttp ? { transport: "http" } : {}) });
    debugHook("file.get.send", { fileId: fid, ok: Boolean(ok), transport: wantsHttp ? "http" : "ws" });
    if (!ok) {
      fileGetInFlight.delete(fid);
      fileGetStartedAtMs.delete(fid);
      fileGetTimeouts.delete(fid);
      fileGetTimeoutTouchedAt.delete(fid);
      fileGetPrefetchInFlight.delete(fid);
      if (silent) clearSilent(fid);
      if (meta?.silent) {
        clearSilent(fid);
      }
      debugHook("file.get.send_fail", { fileId: fid });
      return;
    }
    armTimeoutFor(fid);
  };

  const drain = () => {
    const st = store.get();
    if (!canDrainFileRuntime(st)) return;
    const canPrefetch = canDrainFilePrefetch(st, { prefetchAllowed: deviceCaps.prefetchAllowed });
    while (fileGetQueueHigh.length && fileGetInFlight.size < FILE_GET_MAX_CONCURRENCY) {
      const fileId = fileGetQueueHigh.shift();
      if (!fileId) continue;
      start(fileId, "high");
    }
    while (
      fileGetQueuePrefetch.length &&
      canPrefetch &&
      fileGetInFlight.size < FILE_GET_MAX_CONCURRENCY &&
      fileGetPrefetchInFlight.size < FILE_GET_PREFETCH_CONCURRENCY
    ) {
      const fileId = fileGetQueuePrefetch.shift();
      if (!fileId) continue;
      start(fileId, "prefetch");
    }
  };

  const clearAcceptRetry = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const entry = fileAcceptRetries.get(fid);
    if (entry?.timer) {
      try {
        window.clearTimeout(entry.timer);
      } catch {
        // ignore
      }
    }
    fileAcceptRetries.delete(fid);
  };

  const scheduleAcceptRetry = (fileId: string, attempts = 0) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    if (attempts > FILE_ACCEPT_RETRY_MAX) {
      clearAcceptRetry(fid);
      return;
    }
    clearAcceptRetry(fid);
    const delay =
      attempts <= 0
        ? FILE_ACCEPT_RETRY_BASE_MS
        : Math.min(FILE_ACCEPT_RETRY_MAX_MS, FILE_ACCEPT_RETRY_BASE_MS * Math.pow(2, attempts));
    const timer = window.setTimeout(() => {
      if (isDownloadActive(fid)) {
        clearAcceptRetry(fid);
        return;
      }
      enqueue(fid, { priority: "high" });
      fileAcceptRetries.set(fid, { attempts: attempts + 1, timer: null });
    }, delay);
    fileAcceptRetries.set(fid, { attempts, timer });
  };

  const requestFreshHttpDownloadUrl = (fileId: string): Promise<HttpFileUrlInfo> => {
    const fid = String(fileId || "").trim();
    if (!fid) return Promise.reject(new Error("missing_file_id"));
    const existing = httpFileUrlWaiters.get(fid);
    if (existing) {
      debugHook("file.get.url_waiter_reuse", { fileId: fid, ...queueState() });
      return existing.promise;
    }
    debugHook("file.get.url_waiter_begin", { fileId: fid, ...queueState() });
    let resolveRef: ((info: HttpFileUrlInfo) => void) | null = null;
    let rejectRef: ((err: Error) => void) | null = null;
    const promise = new Promise<HttpFileUrlInfo>((resolve, reject) => {
      resolveRef = resolve;
      rejectRef = reject;
    });
    const entry = {
      promise,
      resolve: (info: HttpFileUrlInfo) => resolveRef?.(info),
      reject: (err: Error) => rejectRef?.(err),
      timer: null as number | null,
    };
    const timer = window.setTimeout(() => {
      const cur = httpFileUrlWaiters.get(fid);
      if (cur) httpFileUrlWaiters.delete(fid);
      try {
        cur?.reject(new Error("file_url_refresh_timeout"));
        debugHook("file.get.url_timeout", { fileId: fid, timeout_ms: HTTP_FILE_URL_REFRESH_TIMEOUT_MS, ...queueState() });
      } catch {
        // ignore
      }
    }, HTTP_FILE_URL_REFRESH_TIMEOUT_MS);
    entry.timer = timer;
    debugHook("file.get.url_waiter_set", { fileId: fid, timeout_ms: HTTP_FILE_URL_REFRESH_TIMEOUT_MS, ...queueState() });
    httpFileUrlWaiters.set(fid, entry);
    try {
      debugHook("file.get.url_send", { fileId: fid, reason: "refresh" });
      send({ type: "file_get", file_id: fid, transport: "http" });
    } catch {
      window.clearTimeout(timer);
      httpFileUrlWaiters.delete(fid);
      debugHook("file.get.url_send_fail", { fileId: fid });
      return Promise.reject(new Error("file_url_refresh_send_failed"));
    }
    return promise;
  };

  const tryResolveHttpWaiterFromFileUrl = (msg: any): boolean => {
    const fileId = String(msg?.file_id ?? "").trim();
    if (!fileId) return false;
    const waiter = httpFileUrlWaiters.get(fileId);
    if (!waiter) return false;
    const url = typeof msg?.url === "string" ? String(msg.url).trim() : "";
    const thumbUrl = typeof msg?.thumb_url === "string" ? String(msg.thumb_url).trim() : "";
    const authToken = typeof msg?.auth_token === "string" ? String(msg.auth_token).trim() : "";
    const thumbAuthToken = typeof msg?.thumb_auth_token === "string" ? String(msg.thumb_auth_token).trim() : "";
    if (url && authToken) {
      rememberFileHttpBearer(url, authToken, {
        base: typeof window !== "undefined" && typeof window.location?.href === "string" ? window.location.href : null,
      });
    }
    if (thumbUrl && thumbAuthToken) {
      rememberFileHttpBearer(thumbUrl, thumbAuthToken, {
        base: typeof window !== "undefined" && typeof window.location?.href === "string" ? window.location.href : null,
      });
    }
    httpFileUrlWaiters.delete(fileId);
    const startedAt = fileGetStartedAtMs.get(fileId);
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    debugHook("file.get.url_resolve", {
      fileId,
      hasUrl: Boolean(url),
      hasThumb: Boolean(thumbUrl),
      elapsed_ms: Math.max(0, Number(elapsed) || 0),
      ...queueState(),
    });
    if (waiter.timer) {
      try {
        window.clearTimeout(waiter.timer);
      } catch {
        // ignore
      }
    }
    try {
      if (!url) throw new Error("missing_url");
      const metaFallback = resolveFileMeta(fileId);
      const nameRaw = typeof msg?.name === "string" ? msg.name.trim() : "";
      const name = nameRaw || metaFallback.name || "файл";
      const size = Number(msg?.size ?? 0) || metaFallback.size || 0;
      const mimeRaw = msg?.mime;
      const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : metaFallback.mime;
      const shaRaw = typeof msg?.sha256 === "string" ? msg.sha256.trim() : "";
      const sha256 = shaRaw ? shaRaw.toLowerCase() : null;
      const durNum = Number(msg?.duration_s ?? 0);
      const duration_s = Number.isFinite(durNum) && durNum > 0 ? durNum : null;
      const mw = Number(msg?.media_w ?? 0);
      const mh = Number(msg?.media_h ?? 0);
      const media_w = Number.isFinite(mw) && mw > 0 ? mw : null;
      const media_h = Number.isFinite(mh) && mh > 0 ? mh : null;
      const tw = Number(msg?.thumb_w ?? 0);
      const th = Number(msg?.thumb_h ?? 0);
      const thumb_w = Number.isFinite(tw) && tw > 0 ? tw : null;
      const thumb_h = Number.isFinite(th) && th > 0 ? th : null;
      const thumbMimeRaw = msg?.thumb_mime;
      const thumb_mime = typeof thumbMimeRaw === "string" && thumbMimeRaw.trim() ? String(thumbMimeRaw).trim() : null;
      waiter.resolve({
        url,
        name,
        size,
        mime: mime ?? null,
        sha256,
        duration_s,
        media_w,
        media_h,
        thumb_url: thumbUrl || null,
        thumb_mime,
        thumb_w,
        thumb_h,
      });
    } catch {
      try {
        waiter.reject(new Error("missing_url"));
      } catch {
        // ignore
      }
    }
    return true;
  };

  const rejectHttpWaiter = (fileId: string, err: Error) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const waiter = httpFileUrlWaiters.get(fid);
    if (!waiter) return;
    debugHook("file.get.url_reject", { fileId: fid, reason: String(err?.message || err) });
    httpFileUrlWaiters.delete(fid);
    if (waiter.timer) {
      try {
        window.clearTimeout(waiter.timer);
      } catch {
        // ignore
      }
    }
    try {
      waiter.reject(err);
    } catch {
      // ignore
    }
  };

  const isSilent = (fileId: string): boolean => {
    const fid = String(fileId || "").trim();
    return Boolean(fid && silentFileGets.has(fid));
  };

  const markSilent = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    silentFileGets.add(fid);
  };

  const clearSilent = (fileId: string) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    silentFileGets.delete(fid);
  };

  const reset = () => {
    fileGetQueueHigh.length = 0;
    fileGetQueuePrefetch.length = 0;
    fileGetQueueMeta.clear();
    fileGetStartedAtMs.clear();
    for (const fid of fileGetInFlight.keys()) {
      clearTimeoutFor(fid);
    }
    fileGetInFlight.clear();
    fileGetPrefetchInFlight.clear();
    fileGetTimeouts.clear();
    fileGetTimeoutTouchedAt.clear();
    silentFileGets.clear();

    for (const fid of fileAcceptRetries.keys()) {
      clearAcceptRetry(fid);
    }
    for (const fid of fileGetNotFoundRetries.keys()) {
      clearNotFoundRetry(fid);
    }

    for (const [fid, waiter] of httpFileUrlWaiters.entries()) {
      if (waiter.timer) {
        try {
          window.clearTimeout(waiter.timer);
        } catch {
          // ignore
        }
      }
      try {
        waiter.reject(new Error("reset"));
      } catch {
        // ignore
      }
      httpFileUrlWaiters.delete(fid);
    }
    debugHook("file.get.reset", queueState());
  };

  return {
    drain,
    enqueue,
    finish,
    touch: touchTimeoutFor,
    dropQueue,
    clearNotFoundRetry,
    scheduleNotFoundRetry,
    clearAcceptRetry,
    scheduleAcceptRetry,
    requestFreshHttpDownloadUrl,
    tryResolveHttpWaiterFromFileUrl,
    rejectHttpWaiter,
    isSilent,
    markSilent,
    clearSilent,
    hasPendingActivityForUpdate,
    reset,
  };
}
