import { setCachedMediaAspectRatio } from "../../../helpers/chat/mediaAspectCache";
import { shouldApplyPendingFileViewerResult } from "../../../helpers/chat/fileViewerScope";
import { base64ToBytes } from "../../../helpers/files/base64";
import { liftFileHttpTokenToBearer, rememberFileHttpBearer } from "../../../helpers/files/fileHttpAuth";
import { resumableHttpDownload } from "../../../helpers/files/fileHttpDownload";
import { putCachedFileBlob } from "../../../helpers/files/fileBlobCache";
import { MISSING_FILE_STATUS, isTerminalMissingVisualTransfer } from "../../../helpers/files/fileMissingState";
import { guessMimeTypeByName } from "../../../helpers/files/mimeGuess";
import { getDeliveryRetryPolicy } from "../../../helpers/runtime/deliveryCoordinator";
import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import { handleProgressiveAudioFileUrl } from "./fileProgressiveAudio";
import {
  createFileHttpDownloadRuntime,
  type FileHttpDownloadPriority,
  type FileHttpDownloadQueueMeta,
} from "./fileHttpDownloadRuntime";
import {
  getSilentFileUrlPlan,
  shouldHydrateSilentFullBlob,
  type AutoDownloadKind,
  type FileDownloadFeature,
  type FileDownloadFeatureDeps,
} from "./fileDownloadTypes";
import { resolveViewerPreviewFallbackUrl } from "./fileViewerUpgradeFallback";
export {
  getSilentFileUrlPlan,
  shouldHydrateSilentFullBlob,
  type AutoDownloadKind,
  type DownloadState,
  type FileDownloadFeature,
  type FileDownloadFeatureDeps,
} from "./fileDownloadTypes";
export function createFileDownloadFeature(deps: FileDownloadFeatureDeps): FileDownloadFeature {
  const {
    store,
    send,
    reportIncident,
    deviceCaps,
    downloadByFileId,
    disableFileHttp,
    nextTransferId,
    updateTransferByFileId,
    scheduleSaveFileTransfers,
    resolveFileMeta,
    shouldCacheFile,
    shouldCachePreview,
    enforceFileCachePolicy,
    thumbCacheId,
    canAutoDownloadFullFile,
    resolveAutoDownloadKind,
    isSilentFileGet,
    clearSilentFileGet,
    clearFileAcceptRetry,
    clearFileGetNotFoundRetry,
    scheduleFileGetNotFoundRetry,
    finishFileGet,
    touchFileGetTimeout,
    dropFileGetQueue,
    tryResolveHttpFileUrlWaiter,
    requestFreshHttpDownloadUrl,
    rejectHttpFileUrlWaiter,
    scheduleThumbPollRetry,
    clearThumbPollRetry,
    setFileThumb,
    maybeSetVideoPosterFromBlob,
    probeImageDimensions,
    pendingFileDownloads,
    triggerBrowserDownload,
    takePendingFileViewer,
    clearPendingFileViewer,
    buildFileViewerModalState,
    postStreamChunk,
    postStreamEnd,
    postStreamError,
    clearCachedPreviewAttempt,
    clearPreviewPrefetchAttempt,
    isUploadActive,
    abortUploadByFileId,
  } = deps;

  const HTTP_MAX_CONCURRENCY = deviceCaps.slowNetwork ? 1 : deviceCaps.constrained ? 2 : 3;
  const HTTP_PREFETCH_CONCURRENCY = deviceCaps.slowNetwork ? 0 : 1;
  const debugHook = (kind: string, data?: any) => {
    try {
      const dbg = (globalThis as any).__yagodka_debug_monitor;
      if (!dbg || typeof dbg.push !== "function") return;
      dbg.push(String(kind || "file").trim() || "file", data);
    } catch {
      // ignore
    }
  };

  const httpRuntime = createFileHttpDownloadRuntime({
    getState: () => store.get(),
    prefetchAllowed: deviceCaps.prefetchAllowed,
    maxConcurrency: HTTP_MAX_CONCURRENCY,
    prefetchConcurrency: HTTP_PREFETCH_CONCURRENCY,
    isUserRequested: (fileId) => pendingFileDownloads.has(fileId),
    debugHook,
    onStart: startHttpDownloadTask,
  });

  function startHttpDownloadTask(params: {
    fileId: string;
    priority: FileHttpDownloadPriority;
    meta: FileHttpDownloadQueueMeta;
    controller: AbortController;
    resetToken: number;
  }) {
    const { fileId: fid, priority, meta, controller, resetToken: token } = params;
    void (async () => {
      try {
        const retryPolicy = getDeliveryRetryPolicy("file_download_http", deviceCaps);
        const download = downloadByFileId.get(fid);
        if (!download) throw new Error("missing_download_state");

        const result = await resumableHttpDownload({
          url: meta.url,
          offset: download.received,
          etag: download.etag ?? null,
          expectedSize: meta.size || 0,
          maxRetries: retryPolicy.maxRetries,
          baseDelayMs: retryPolicy.baseDelayMs,
          maxDelayMs: retryPolicy.maxDelayMs,
          maxUrlRefresh: 2,
          signal: controller.signal,
          refreshUrl: async () => (await requestFreshHttpDownloadUrl(fid)).url,
          onReset: (reason) => {
            const cur = downloadByFileId.get(fid);
            if (!cur) return;
            if (cur.streaming && cur.streamId) throw new Error(`http_download_reset_${reason}`);
            cur.chunks = [];
            cur.received = 0;
            cur.lastProgress = 0;
            cur.etag = null;
            debugHook("file.http.reset", { fileId: fid, reason });
            updateTransferByFileId(fid, (entry) => ({
              ...entry,
              status: "downloading",
              progress: 0,
              ...(meta.mime ? { mime: meta.mime } : {}),
            }));
          },
          onChunk: (chunk) => {
            const cur = downloadByFileId.get(fid);
            if (!cur) throw new Error("missing_download_state");
            if (cur.streaming && cur.streamId) {
              const okPost = postStreamChunk(cur.streamId, chunk);
              if (!okPost) throw new Error("stream_post_failed");
              return;
            }
            const buf = (chunk.buffer as ArrayBuffer).slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
            cur.chunks.push(buf);
          },
          onProgress: ({ received, total }) => {
            const cur = downloadByFileId.get(fid);
            if (!cur) return;
            cur.received = received;
            if (typeof total === "number" && Number.isFinite(total) && total > 0 && (!cur.size || cur.size <= 0)) {
              cur.size = Math.trunc(total);
            }
            touchFileGetTimeout(fid);
            const denom = cur.size > 0 ? cur.size : typeof total === "number" && total > 0 ? total : 0;
            const pct = denom > 0 ? Math.min(100, Math.round((cur.received / denom) * 100)) : 0;
            if (pct !== cur.lastProgress) {
              cur.lastProgress = pct;
              updateTransferByFileId(fid, (entry) => ({ ...entry, progress: pct, status: "downloading" }));
            }
          },
        });

        const final = downloadByFileId.get(fid);
        if (!final) throw new Error("missing_download_state");
        final.etag = result.etag ?? null;
        const userRequested = pendingFileDownloads.has(fid);
        const silent = Boolean(meta.silent && !userRequested);
        debugHook("file.http.complete", {
          fileId: fid,
          name: meta.name,
          size: final.size,
          received: result.received,
          total: result.total,
          mime: final.mime || result.mime || null,
          streaming: Boolean(final.streaming),
          silent,
          priority,
        });

        downloadByFileId.delete(fid);
        clearSilentFileGet(fid);
        finishFileGet(fid);
        if (!silent) {
          try {
            send({ type: "file_downloaded", file_id: fid });
          } catch {
            // ignore
          }
        }

        if (final.streaming && final.streamId) {
          postStreamEnd(final.streamId);
          updateTransferByFileId(fid, (entry) => ({
            ...entry,
            status: "complete",
            progress: 100,
            ...(meta.mime ? { mime: meta.mime } : {}),
          }));
          if (!silent) store.set({ status: `Скачивание завершено: ${meta.name}` });
          clearPendingFileViewer(fid);
          return;
        }

        const finalMime = meta.mime || final.mime || result.mime || guessMimeTypeByName(meta.name);
        const blob = new Blob(final.chunks, { type: finalMime || undefined });
        const objectUrl = URL.createObjectURL(blob);
        updateTransferByFileId(fid, (entry) => ({
          ...entry,
          status: "complete",
          progress: 100,
          url: objectUrl,
          ...(finalMime ? { mime: finalMime } : {}),
        }));
        if (!silent) store.set({ status: `Файл готов: ${meta.name}` });
        try {
          const st = store.get();
          if (st.selfId && shouldCacheFile(meta.name || "файл", finalMime, meta.size || blob.size || 0)) {
            void putCachedFileBlob(st.selfId, fid, blob, {
              name: meta.name || "файл",
              mime: finalMime,
              size: meta.size || blob.size || 0,
            });
            void enforceFileCachePolicy(st.selfId, { force: true });
            clearCachedPreviewAttempt(st.selfId, fid);
          }
        } catch {
          // ignore
        }
        try {
          const st = store.get();
          if (!st.fileThumbs?.[fid]?.url && resolveAutoDownloadKind(meta.name || "файл", finalMime, null) === "video") {
            maybeSetVideoPosterFromBlob(fid, blob, { name: meta.name || "видео", mime: finalMime || null });
          }
        } catch {
          // ignore
        }
        const pending = pendingFileDownloads.get(fid);
        if (pending) {
          pendingFileDownloads.delete(fid);
          triggerBrowserDownload(objectUrl, pending.name || meta.name || "файл");
        }
        const pv = takePendingFileViewer(fid);
        if (pv) {
          const viewerName = pv.name || meta.name || "файл";
          const viewerSize = pv.size || meta.size || blob.size || 0;
          const viewerMime = finalMime || pv.mime || null;
          const currentModal = store.get().modal;
          if (shouldApplyPendingFileViewerResult(currentModal, { fileId: fid, chatKey: pv.chatKey, msgIdx: pv.msgIdx })) {
            const fallbackUrl = resolveViewerPreviewFallbackUrl({ currentModal, nextUrl: objectUrl, name: viewerName, mime: viewerMime, resolveAutoDownloadKind });
            store.set({
              modal: buildFileViewerModalState({
                fileId: fid,
                url: objectUrl,
                name: viewerName,
                size: viewerSize,
                mime: viewerMime,
                caption: pv.caption || null,
                fallbackUrl,
                chatKey: pv.chatKey,
                msgIdx: pv.msgIdx,
              }),
            });
          }
        }
      } catch (err) {
        if (token !== httpRuntime.getResetToken() || httpRuntime.hasQuietAbort(fid)) {
          debugHook("file.http.abort.done", { fileId: fid, reason: "reset_or_quiet" });
          return;
        }
        const errMsg = err instanceof Error ? String(err.message || "") : String(err || "");
        const userRequested = pendingFileDownloads.has(fid);
        const silent = Boolean(meta.silent && !userRequested);
        const canFallback =
          !silent &&
          !httpRuntime.hasLegacyFallbackAttempted(fid) &&
          (err instanceof TypeError ||
            /^http_\\d+$/.test(errMsg) ||
            errMsg === "incomplete_body" ||
            errMsg === "range_not_satisfiable");
        if (canFallback) {
          httpRuntime.markLegacyFallbackAttempted(fid);
          debugHook("file.http.fallback", { fileId: fid, reason: errMsg, mode: "file_get" });
          disableFileHttp(errMsg || "http_download_failed");
          const cur = downloadByFileId.get(fid);
          if (cur) {
            cur.chunks = [];
            cur.received = 0;
            cur.lastProgress = 0;
            cur.etag = null;
          }
          updateTransferByFileId(fid, (entry) => ({ ...entry, status: "downloading", progress: 0, error: null }));
          store.set({ status: `HTTP-скачивание недоступно (${errMsg || "download_failed"}). Резервный канал…` });
          try {
            send({ type: "file_get", file_id: fid });
            touchFileGetTimeout(fid);
            return;
          } catch {
            // ignore
          }
        }
        debugHook("file.http.error", {
          fileId: fid,
          reason: errMsg,
          canFallback,
          silent,
          size: meta.size || 0,
        });
        rejectHttpFileUrlWaiter(fid, "download_failed");
        clearSilentFileGet(fid);
        finishFileGet(fid);
        pendingFileDownloads.delete(fid);
        clearPendingFileViewer(fid);
        reportIncident?.(
          "file_download_failed",
          {
            file_id: fid,
            name: meta.name || null,
            mime: meta.mime || null,
            size: meta.size || 0,
            reason: errMsg || "download_failed",
            user_requested: userRequested,
            silent,
            can_fallback: canFallback,
            priority,
            queued_ms: Math.max(0, Date.now() - meta.queuedAtMs),
          },
          {
            key: `file_download_failed:${fid}:${errMsg || "download_failed"}`,
            dedupeMs: 60_000,
          }
        );
        const download = downloadByFileId.get(fid);
        if (download?.streamId) postStreamError(download.streamId, "http_download_failed");
        downloadByFileId.delete(fid);
        updateTransferByFileId(fid, (entry) => ({ ...entry, status: "error", error: "download_failed" }));
        if (!silent) store.set({ status: "Ошибка файла: download_failed" });
      } finally {
        httpRuntime.finish(fid);
      }
    })();
  }

  let lastDrainConn = store.get().conn;
  let lastDrainAuthed = store.get().authed;
  let lastDrainLeader = store.get().netLeader;
  store.subscribe(() => {
    const st = store.get();
    const conn = st.conn;
    const authed = st.authed;
    const leader = st.netLeader;
    if (conn === lastDrainConn && authed === lastDrainAuthed && leader === lastDrainLeader) return;
    lastDrainConn = conn;
    lastDrainAuthed = authed;
    lastDrainLeader = leader;
    httpRuntime.scheduleDrain();
  });
  try {
    document.addEventListener("visibilitychange", () => httpRuntime.scheduleDrain(), { passive: true });
  } catch {
    // ignore
  }

  function handleFileDownloadBegin(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    if (!fileId) return true;
    clearFileAcceptRetry(fileId);
    const name = String(msg?.name ?? "файл");
    const size = Number(msg?.size ?? 0) || 0;
    const from = String(msg?.from ?? "").trim() || "—";
    const room = typeof msg?.room === "string" ? msg.room : null;
    const mimeRaw = msg?.mime;
    const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : null;
    const silent = isSilentFileGet(fileId);
    const existing = downloadByFileId.get(fileId);
    const streamId = existing?.streamId ? String(existing.streamId) : null;
    const streaming = Boolean(existing?.streaming && streamId);
    debugHook("file.download.begin", {
      fileId,
      name,
      size,
      from,
      room: room || null,
      kind: msg?.kind ? String(msg.kind) : null,
      streaming,
      silent,
    });
    downloadByFileId.set(fileId, {
      fileId,
      name,
      size,
      from,
      room,
      mime,
      chunks: [],
      received: 0,
      lastProgress: 0,
      streamId: streamId || null,
      streaming,
    });
    store.set((prev) => {
      const transfers = [...prev.fileTransfers];
      const idx = transfers.findIndex((entry) => entry.id === fileId && entry.direction === "in");
      if (idx >= 0) {
        transfers[idx] = {
          ...transfers[idx],
          name,
          size,
          peer: from,
          room,
          mime: mime || transfers[idx].mime || null,
          status: "downloading",
          progress: 0,
        };
      } else {
        transfers.unshift({
          localId: nextTransferId(),
          id: fileId,
          name,
          size,
          mime,
          direction: "in",
          peer: from,
          room,
          status: "downloading",
          progress: 0,
        });
      }
      return {
        ...applyFileTransferMutation(prev, transfers),
        fileOffersIn: prev.fileOffersIn.filter((entry) => entry.id !== fileId),
        ...(silent ? {} : { status: `Скачивание: ${name}` }),
      };
    });
    return true;
  }

  function handleFileUrl(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
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
    if (!fileId) return true;
    clearFileGetNotFoundRetry(fileId);
    const mwRaw = Number(msg?.media_w ?? 0);
    const mhRaw = Number(msg?.media_h ?? 0);
    const twRaw = Number(msg?.thumb_w ?? 0);
    const thRaw = Number(msg?.thumb_h ?? 0);
    const mediaW = Number.isFinite(mwRaw) && mwRaw > 0 ? Math.trunc(mwRaw) : null;
    const mediaH = Number.isFinite(mhRaw) && mhRaw > 0 ? Math.trunc(mhRaw) : null;
    const thumbW = Number.isFinite(twRaw) && twRaw > 0 ? Math.trunc(twRaw) : null;
    const thumbH = Number.isFinite(thRaw) && thRaw > 0 ? Math.trunc(thRaw) : null;

    if (tryResolveHttpFileUrlWaiter(msg)) return true;

    const silent = isSilentFileGet(fileId);
    if (!url && !(silent && thumbUrl)) {
      finishFileGet(fileId);
      return true;
    }
    clearFileAcceptRetry(fileId);
    try {
      const w = mediaW ?? thumbW ?? 0;
      const h = mediaH ?? thumbH ?? 0;
      if (w > 0 && h > 0) {
        setCachedMediaAspectRatio(fileId, w / Math.max(1, h));
      }
    } catch {
      // ignore
    }
    const metaFallback = resolveFileMeta(fileId);
    const name = typeof msg?.name === "string" && msg.name.trim() ? String(msg.name) : metaFallback.name;
    const size = Number(msg?.size ?? 0) || metaFallback.size || 0;
    const mimeRaw = msg?.mime;
    const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : metaFallback.mime;
    const thumbMimeRaw = msg?.thumb_mime;
    const thumbMime = typeof thumbMimeRaw === "string" && thumbMimeRaw.trim() ? String(thumbMimeRaw).trim() : null;
    debugHook("file.url", {
      fileId,
      hasUrl: Boolean(url),
      hasThumb: Boolean(thumbUrl),
      kind: msg?.kind ? String(msg.kind) : null,
      size,
      mime: mime || null,
    });

    const scheduleSilentThumbFetch = (opts: { clearOnFinish: boolean; kind: AutoDownloadKind }) => {
      void (async () => {
        try {
          const thumbAuth = liftFileHttpTokenToBearer(thumbUrl);
          const res = await fetch(thumbAuth.url || thumbUrl, {
            method: "GET",
            cache: "no-store",
            headers: thumbAuth.headers,
          });
          if (!res.ok) throw new Error(`http_${res.status}`);
          const blob = await res.blob();
          const finalMime = thumbMime || blob.type || "image/jpeg";
          let w = thumbW;
          let h = thumbH;
          if ((!w || !h) && blob) {
            try {
              const probed = await probeImageDimensions(blob);
              w = w || probed.w || null;
              h = h || probed.h || null;
            } catch {
              // ignore
            }
          }
          try {
            if (w && h) {
              setCachedMediaAspectRatio(fileId, w / Math.max(1, h));
            }
          } catch {
            // ignore
          }
          const objectUrl = URL.createObjectURL(blob);
          setFileThumb(fileId, objectUrl, finalMime, { w, h, mediaW, mediaH });
          clearThumbPollRetry(fileId);
          try {
            const st = store.get();
            if (st.selfId && shouldCachePreview(name || "файл", finalMime, blob.size || 0)) {
              void putCachedFileBlob(st.selfId, thumbCacheId(fileId), blob, {
                name: name || "файл",
                mime: finalMime,
                size: blob.size || 0,
                w,
                h,
                mediaW,
                mediaH,
              });
              void enforceFileCachePolicy(st.selfId, { force: true });
            }
          } catch {
            // ignore
          }
        } catch (err) {
          const errMsg = err instanceof Error ? String(err.message || "") : String(err || "");
          debugHook("file.thumb.error", {
            fileId,
            reason: errMsg || "thumb_fetch_failed",
            type: err instanceof Error ? String(err.name || "") : null,
          });
          if (opts.kind === "video") scheduleThumbPollRetry(fileId);
        } finally {
          if (opts.clearOnFinish) {
            clearSilentFileGet(fileId);
            finishFileGet(fileId);
          }
        }
      })();
    };

    const userRequested = pendingFileDownloads.has(fileId);
    const kindForUrl = resolveAutoDownloadKind(name, mime, msg?.kind ? String(msg.kind) : null);
    const pendingStream = Boolean(downloadByFileId.get(fileId)?.streaming);
    if (url && kindForUrl === "audio" && !pendingStream && (!userRequested || silent) && handleProgressiveAudioFileUrl({ store, fileId, url, name, size, mime, silent, nextTransferId, scheduleSaveFileTransfers, clearSilentFileGet, finishFileGet, updateTransferByFileId, send, touchFileGetTimeout, debugHook })) return true;

    if (silent) {
      try {
        const st = store.get();
        const kind = kindForUrl;
        const allowFullDownload = shouldHydrateSilentFullBlob({
          kind,
          name,
          mime,
          size,
          userId: st.selfId || null,
          shouldCachePreview,
          canAutoDownloadFullFile,
        });
        const plan = getSilentFileUrlPlan({
          hasUrl: Boolean(url),
          hasThumbUrl: Boolean(thumbUrl),
          kind,
          allowFullDownload,
        });
        if (plan.fetchThumb) {
          scheduleSilentThumbFetch({ clearOnFinish: !plan.fetchFull, kind });
        }
        if (plan.scheduleThumbPoll) {
          scheduleThumbPollRetry(fileId);
        }
        if (plan.finishWithoutNetwork) {
          clearSilentFileGet(fileId);
          finishFileGet(fileId);
          return true;
        }
        if (!plan.fetchFull) return true;
      } catch {
        // ignore
      }
    }

    if (httpRuntime.isQueuedOrActive(fileId)) return true;

    const existing = downloadByFileId.get(fileId);
    const streamId = existing?.streamId ? String(existing.streamId) : null;
    const streaming = Boolean(existing?.streaming && streamId);
    downloadByFileId.set(fileId, {
      fileId,
      name,
      size,
      from: existing?.from || "—",
      room: existing?.room ?? null,
      mime: mime ?? null,
      etag: existing?.etag ?? null,
      chunks: [],
      received: 0,
      lastProgress: 0,
      streamId: streamId || null,
      streaming,
    });
    updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "downloading", progress: 0, ...(mime ? { mime } : {}) }));
    if (!silent) store.set({ status: `Скачивание: ${name || fileId}` });

    const priority: FileHttpDownloadPriority = silent && !userRequested ? "prefetch" : "high";
    debugHook("file.http.enqueue", {
      fileId,
      name,
      size,
      stream: streaming,
      silent,
      priority,
      expectedMime: mime || null,
      ...httpRuntime.queueState(),
    });
    httpRuntime.enqueue(fileId, {
      url,
      name,
      size,
      mime: mime ?? null,
      silent: Boolean(silent && !userRequested),
      priority,
    });
    finishFileGet(fileId);
    return true;
  }

  function handleFileChunk(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    const download = fileId ? downloadByFileId.get(fileId) : null;
    if (!download) return true;
    const data = typeof msg?.data === "string" ? msg.data : "";
    if (!data) return true;
    const bytes = base64ToBytes(data);
    if (!bytes) return true;
    const silent = isSilentFileGet(fileId);
    const chunkLen = bytes.length;
    if (download.streaming && download.streamId) {
      const ok = postStreamChunk(download.streamId, bytes);
      if (!ok) {
        postStreamError(download.streamId, "stream_post_failed");
        debugHook("file.http.stream_error", { fileId, reason: "stream_post_failed" });
        downloadByFileId.delete(fileId);
        clearSilentFileGet(fileId);
        finishFileGet(fileId);
        updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "error", error: "stream_failed" }));
        if (!silent) store.set({ status: "Ошибка файла: stream_failed" });
        return true;
      }
    } else {
      const buf = (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      download.chunks.push(buf);
    }
    download.received += chunkLen;
    touchFileGetTimeout(fileId);
    const pct = download.size > 0 ? Math.min(100, Math.round((download.received / download.size) * 100)) : 0;
    if (pct !== download.lastProgress) {
      download.lastProgress = pct;
      updateTransferByFileId(fileId, (entry) => ({ ...entry, progress: pct, status: "downloading" }));
    }
    return true;
  }

  function handleFileDownloadComplete(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    if (!fileId) return true;
    clearFileAcceptRetry(fileId);
    finishFileGet(fileId);
    const silent = isSilentFileGet(fileId);
    const download = downloadByFileId.get(fileId);
    if (download) {
      debugHook("file.download.complete", {
        fileId,
        name: download.name,
        size: download.size,
        streaming: Boolean(download.streaming),
        status: "legacy",
      });
      downloadByFileId.delete(fileId);
      clearSilentFileGet(fileId);
      const isStreaming = Boolean(download.streaming && download.streamId);
      if (isStreaming && download.streamId) {
        postStreamEnd(download.streamId);
        updateTransferByFileId(fileId, (entry) => ({
          ...entry,
          status: "complete",
          progress: 100,
          ...(download.mime ? { mime: download.mime } : {}),
        }));
        if (!silent) store.set({ status: `Скачивание завершено: ${download.name}` });
        clearPendingFileViewer(fileId);
        return true;
      }
      const finalMime = download.mime || guessMimeTypeByName(download.name);
      const blob = new Blob(download.chunks, { type: finalMime || undefined });
      const objectUrl = URL.createObjectURL(blob);
      updateTransferByFileId(fileId, (entry) => ({
        ...entry,
        status: "complete",
        progress: 100,
        url: objectUrl,
        ...(finalMime ? { mime: finalMime } : {}),
      }));
      if (!silent) store.set({ status: `Файл готов: ${download.name}` });
      try {
        const st = store.get();
        if (st.selfId && shouldCacheFile(download.name || "файл", finalMime, download.size || blob.size || 0)) {
          void putCachedFileBlob(st.selfId, fileId, blob, {
            name: download.name || "файл",
            mime: finalMime,
            size: download.size || blob.size || 0,
          });
          void enforceFileCachePolicy(st.selfId, { force: true });
          clearCachedPreviewAttempt(st.selfId, fileId);
        }
      } catch {
        // ignore
      }
      try {
        const st = store.get();
        if (!st.fileThumbs?.[fileId]?.url && resolveAutoDownloadKind(download.name || "файл", finalMime, null) === "video") {
          maybeSetVideoPosterFromBlob(fileId, blob, { name: download.name || "видео", mime: finalMime || null });
        }
      } catch {
        // ignore
      }
      const pending = pendingFileDownloads.get(fileId);
      if (pending) {
        pendingFileDownloads.delete(fileId);
        triggerBrowserDownload(objectUrl, pending.name || download.name || "файл");
      }
      const pv = takePendingFileViewer(fileId);
      if (pv) {
        const viewerName = pv.name || download.name || "файл";
        const viewerSize = pv.size || download.size || blob.size || 0;
        const viewerMime = finalMime || pv.mime || null;
        const currentModal = store.get().modal;
        if (shouldApplyPendingFileViewerResult(currentModal, { fileId, chatKey: pv.chatKey, msgIdx: pv.msgIdx })) {
          const fallbackUrl = resolveViewerPreviewFallbackUrl({ currentModal, nextUrl: objectUrl, name: viewerName, mime: viewerMime, resolveAutoDownloadKind });
          store.set({
            modal: buildFileViewerModalState({
              fileId,
              url: objectUrl,
              name: viewerName,
              size: viewerSize,
              mime: viewerMime,
              caption: pv.caption || null,
              fallbackUrl,
              chatKey: pv.chatKey,
              msgIdx: pv.msgIdx,
            }),
          });
        }
      }
    } else {
      clearSilentFileGet(fileId);
      updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "complete", progress: 100 }));
    }
    return true;
  }

  function markFileTransferError(fileId: string, detail: string): void {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const fallback = resolveFileMeta(fid);
    const existing = store.get().fileTransfers.find((t) => String(t.id || "").trim() === fid) ?? null;
    const name = existing?.name || fallback.name || "файл";
    const size = existing?.size || fallback.size || 0;
    const mime = existing?.mime || fallback.mime || null;
    const direction = existing?.direction || "in";
    const peer = existing?.peer || "—";
    const room = typeof existing?.room === "string" ? existing.room : null;
    store.set((prev) => {
      const idx = prev.fileTransfers.findIndex((t) => String(t.id || "").trim() === fid);
      if (idx >= 0) {
        const next = prev.fileTransfers.map((entry, entryIdx) =>
          entryIdx === idx
            ? { ...entry, name, size, mime, status: "error" as const, progress: 0, error: detail, url: null }
            : entry
        );
        return applyFileTransferMutation(prev, next);
      }
      return applyFileTransferMutation(prev, [
        {
          localId: nextTransferId(), id: fid, name, size, mime, direction, peer, room,
          status: "error",
          progress: 0,
          error: detail,
        },
        ...prev.fileTransfers,
      ]);
    });
    scheduleSaveFileTransfers();
  }

  function handleFileError(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    const reason = String(msg?.reason ?? "ошибка");
    const peer = String(msg?.peer ?? "").trim();
    const detail = peer ? `${reason} (${peer})` : reason;
    const silent = fileId ? isSilentFileGet(fileId) : false;
    let terminalMissingVisual = false;
    debugHook("file.error", { fileId, reason: detail, silent, peer: peer || null });
    if (fileId) {
      httpRuntime.abort(fileId, `server:${detail}`);
      finishFileGet(fileId);
      dropFileGetQueue(fileId);
      const snap = store.get();
      const uid = snap.selfId;
      const transfer = snap.fileTransfers.find((t) => String(t.id || "").trim() === fileId) ?? null;
      if (uid) clearPreviewPrefetchAttempt(uid, fileId);
      pendingFileDownloads.delete(fileId);
      clearPendingFileViewer(fileId);
      const uploadActive = isUploadActive(fileId);
      if (reason === "not_found") {
        const waitingForUpload =
          uploadActive ||
          Boolean(transfer && transfer.direction === "out" && transfer.status === "uploading") ||
          Boolean(transfer && transfer.direction === "in" && (transfer.status === "offering" || transfer.status === "downloading"));
        if (waitingForUpload || silent) {
          const scheduled = scheduleFileGetNotFoundRetry(fileId, { priority: silent ? "prefetch" : "high", silent });
          if (transfer && transfer.status === "downloading") {
            updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "offering", progress: 0, error: null }));
          } else if (transfer && transfer.status === "error") {
            updateTransferByFileId(fileId, (entry) => ({
              ...entry,
              status: entry.direction === "out" ? "uploading" : "offering",
              error: null,
            }));
          }
          if (!silent) {
            store.set({ status: uploadActive ? "Загрузка продолжается…" : "Ожидаем файл от отправителя" });
          }
          if (uploadActive || scheduled) return true;
        }
      }
      clearSilentFileGet(fileId);
      abortUploadByFileId(fileId);
      const download = downloadByFileId.get(fileId);
      if (download?.streamId) postStreamError(download.streamId, detail);
      if (download) downloadByFileId.delete(fileId);
      clearFileAcceptRetry(fileId);
      markFileTransferError(fileId, detail);
      terminalMissingVisual = isTerminalMissingVisualTransfer(store.get().fileTransfers.find((t) => String(t.id || "").trim() === fileId));
    }
    if (!silent) store.set({ status: terminalMissingVisual ? MISSING_FILE_STATUS : `Ошибка файла: ${detail}` });
    return true;
  }

  return {
    handleMessage: (msg: any): boolean => {
      const t = String(msg?.type ?? "");
      if (t === "file_download_begin") return handleFileDownloadBegin(msg);
      if (t === "file_url") return handleFileUrl(msg);
      if (t === "file_chunk") return handleFileChunk(msg);
      if (t === "file_download_complete") return handleFileDownloadComplete(msg);
      if (t === "file_error") return handleFileError(msg);
      return false;
    },
    abortHttpDownload: (fileId: string, reason?: string, opts?: { quiet?: boolean }) => {
      httpRuntime.abort(fileId, reason, opts);
    },
    reset: () => {
      httpRuntime.reset();
      downloadByFileId.clear();
    },
  };
}
