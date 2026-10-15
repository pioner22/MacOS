import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";
import type { DeviceCaps } from "../navigation/deviceCaps";
import { createAutoDownloadCachePolicyFeature } from "./autoDownloadCachePolicyFeature";
import { createCachedPreviewRestoreFeature } from "./cachedPreviewRestoreFeature";
import { createFileDownloadActionsFeature, type FileDownloadActionsFeature } from "./fileDownloadActionsFeature";
import type { DownloadState } from "./fileDownloadFeature";
import { createFileGetFeature, type FileGetFeature } from "./fileGetFeature";
import { createFileTransferStateFeature } from "./fileTransferStateFeature";
import { createFileViewerCacheFeature } from "./fileViewerCacheFeature";
import { probeImageDimensions } from "./probeImageDimensions";

export type FileTransferBootstrap = {
  downloadByFileId: Map<string, DownloadState>;
  fileUploadMaxConcurrency: number;
  isFileHttpDisabled: () => boolean;
  disableFileHttp: (reason: string) => void;
  fileDownloadActions: FileDownloadActionsFeature;
  fileGet: FileGetFeature;
  cachedPreviewsAttempted: Map<string, number>;
  previewPrefetchAttempted: Map<string, number>;
  cachedThumbsAttempted: Map<string, number>;
  fileThumbMaxEntries: number;
  thumbCacheId: (fileId: string) => string;
  autoDownloadCachePolicyFeature: ReturnType<typeof createAutoDownloadCachePolicyFeature>;
  cachedPreviewRestoreFeature: ReturnType<typeof createCachedPreviewRestoreFeature>;
  fileTransferStateFeature: ReturnType<typeof createFileTransferStateFeature>;
  fileViewerCacheFeature: ReturnType<typeof createFileViewerCacheFeature>;
  previewAutoOverscan: number;
  previewAutoRestoreMaxBytes: number;
  previewAutoRetryMs: number;
  previewAutoFailRetryMs: number;
};

type Deps = {
  store: Store<AppState>;
  deviceCaps: DeviceCaps;
  send: (payload: any) => boolean;
  scheduleSaveFileTransfers: () => void;
  isUploadActive: (fileId: string) => boolean;
};

export function isBlockingFileDownloadState(
  fileId: string,
  downloadByFileId: Map<string, DownloadState>,
  transfer: Pick<FileTransferEntry, "status" | "url"> | null | undefined
): boolean {
  const fid = String(fileId || "").trim();
  if (!fid) return false;
  return downloadByFileId.has(fid) || transfer?.status === "downloading" || (transfer?.status === "complete" && Boolean(transfer.url));
}

export function initFileTransferBootstrap(deps: Deps): FileTransferBootstrap {
  const downloadByFileId = new Map<string, DownloadState>();
  const fileUploadMaxConcurrency = deps.deviceCaps.slowNetwork || deps.deviceCaps.constrained ? 1 : 2;

  let fileHttpDisabled = false;
  const isFileHttpDisabled = () => fileHttpDisabled;
  const disableFileHttp = (reason: string) => {
    if (fileHttpDisabled) return;
    fileHttpDisabled = true;
    try {
      console.warn("[files] HTTP data-plane disabled:", reason);
    } catch {
      // ignore
    }
    try {
      const dbg = (globalThis as any).__yagodka_debug_monitor;
      if (dbg && typeof dbg.push === "function") dbg.push("file.http.disabled", { reason: String(reason || "").trim() || "unknown" });
    } catch {
      // ignore
    }
  };

  let fileGet: FileGetFeature | null = null;
  const fileDownloadActions = createFileDownloadActionsFeature({
    store: deps.store,
    downloadByFileId,
    enqueueFileGet: (fileId, opts) => fileGet?.enqueue(fileId, opts),
    scheduleSaveFileTransfers: deps.scheduleSaveFileTransfers,
  });
  fileGet = createFileGetFeature({
    store: deps.store,
    send: deps.send,
    deviceCaps: deps.deviceCaps,
    isFileHttpDisabled,
    isUploadActive: deps.isUploadActive,
    isDownloadActive: (fileId) => {
      const fid = String(fileId || "").trim();
      if (!fid) return false;
      const transfer = deps.store.get().fileTransfers.find((t) => String(t.id || "").trim() === fid);
      return isBlockingFileDownloadState(fid, downloadByFileId, transfer);
    },
    resolveFileMeta: (fileId) => fileDownloadActions.resolveFileMeta(fileId),
  });

  const cachedPreviewsAttempted = new Map<string, number>();
  const previewPrefetchAttempted = new Map<string, number>();
  const cachedThumbsAttempted = new Map<string, number>();

  const previewAutoMaxBytes = deps.deviceCaps.slowNetwork
    ? 12 * 1024 * 1024
    : deps.deviceCaps.constrained
      ? 20 * 1024 * 1024
      : 32 * 1024 * 1024;
  const previewAutoRestoreMaxBytes = deps.deviceCaps.slowNetwork
    ? 18 * 1024 * 1024
    : deps.deviceCaps.constrained
      ? 28 * 1024 * 1024
      : 40 * 1024 * 1024;
  const previewAutoOverscan = deps.deviceCaps.slowNetwork ? 90 : deps.deviceCaps.constrained ? 120 : 160;
  const previewAutoRetryMs = 15_000;
  const previewAutoFailRetryMs = 3_000;
  const previewCacheRetryMs = deps.deviceCaps.slowNetwork ? 20_000 : deps.deviceCaps.constrained ? 12_000 : 8_000;

  const autoDownloadCachePolicyFeature = createAutoDownloadCachePolicyFeature({
    store: deps.store,
    previewAutoMaxBytes,
  });

  const FILE_THUMB_CACHE_PREFIX = "thumb:";
  const fileThumbMaxEntries = deps.deviceCaps.constrained ? 160 : deps.deviceCaps.slowNetwork ? 120 : 260;
  const thumbCacheId = (fileId: string): string => {
    const fid = String(fileId || "").trim();
    return fid ? `${FILE_THUMB_CACHE_PREFIX}${fid}` : FILE_THUMB_CACHE_PREFIX;
  };
  const shouldAttemptCachedPreview = (cacheKey: string): boolean => {
    const now = Date.now();
    const last = cachedPreviewsAttempted.get(cacheKey) ?? 0;
    if (last && now - last < previewCacheRetryMs) return false;
    cachedPreviewsAttempted.set(cacheKey, now);
    return true;
  };
  const shouldAttemptCachedThumb = (cacheKey: string): boolean => {
    const now = Date.now();
    const last = cachedThumbsAttempted.get(cacheKey) ?? 0;
    if (last && now - last < previewCacheRetryMs) return false;
    cachedThumbsAttempted.set(cacheKey, now);
    return true;
  };

  const cachedPreviewRestoreFeature = createCachedPreviewRestoreFeature({
    store: deps.store,
    thumbCacheId,
    shouldAttemptCachedPreview,
    shouldAttemptCachedThumb,
    probeImageDimensions,
    scheduleSaveFileTransfers: deps.scheduleSaveFileTransfers,
    fileThumbMaxEntries,
  });
  const fileTransferStateFeature = createFileTransferStateFeature({
    store: deps.store,
    scheduleSaveFileTransfers: deps.scheduleSaveFileTransfers,
  });
  const fileViewerCacheFeature = createFileViewerCacheFeature({
    store: deps.store,
    scheduleSaveFileTransfers: deps.scheduleSaveFileTransfers,
  });

  return {
    downloadByFileId,
    fileUploadMaxConcurrency,
    isFileHttpDisabled,
    disableFileHttp,
    fileDownloadActions,
    fileGet,
    cachedPreviewsAttempted,
    previewPrefetchAttempted,
    cachedThumbsAttempted,
    fileThumbMaxEntries,
    thumbCacheId,
    autoDownloadCachePolicyFeature,
    cachedPreviewRestoreFeature,
    fileTransferStateFeature,
    fileViewerCacheFeature,
    previewAutoOverscan,
    previewAutoRestoreMaxBytes,
    previewAutoRetryMs,
    previewAutoFailRetryMs,
  };
}
