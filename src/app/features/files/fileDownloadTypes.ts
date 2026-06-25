import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";
import type { PendingFileViewer, FileViewerModalState } from "./fileViewerFeature";

export interface DownloadState {
  fileId: string;
  name: string;
  size: number;
  from: string;
  room?: string | null;
  mime?: string | null;
  etag?: string | null;
  chunks: ArrayBuffer[];
  received: number;
  lastProgress: number;
  streamId?: string | null;
  streaming?: boolean;
}

export type DeviceCapsLike = {
  constrained: boolean;
  slowNetwork: boolean;
  prefetchAllowed: boolean;
};

export type AutoDownloadKind = "image" | "video" | "audio" | "file";

export type HttpFileUrlInfoLike = {
  url: string;
};

export function shouldHydrateSilentFullBlob(params: {
  kind: AutoDownloadKind;
  name: string;
  mime: string | null | undefined;
  size: number;
  userId: string | null;
  shouldCachePreview: (name: string, mime: string | null | undefined, size: number) => boolean;
  canAutoDownloadFullFile: (userId: string | null, kind: AutoDownloadKind, size: number) => boolean;
}): boolean {
  const { kind, size, userId, canAutoDownloadFullFile } = params;
  if (kind === "image" || kind === "video") {
    return canAutoDownloadFullFile(userId, kind, size);
  }
  return canAutoDownloadFullFile(userId, kind, size);
}

export function getSilentFileUrlPlan(params: {
  hasUrl: boolean;
  hasThumbUrl: boolean;
  kind: AutoDownloadKind;
  allowFullDownload: boolean;
}): {
  fetchThumb: boolean;
  fetchFull: boolean;
  scheduleThumbPoll: boolean;
  finishWithoutNetwork: boolean;
} {
  const fetchThumb = Boolean(params.hasThumbUrl);
  const fetchFull = Boolean(params.hasUrl && params.allowFullDownload);
  return {
    fetchThumb,
    fetchFull,
    scheduleThumbPoll: params.kind === "video" && !fetchThumb,
    finishWithoutNetwork: !fetchThumb && !fetchFull,
  };
}

export interface FileDownloadFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  reportIncident?: (kind: string, detail?: Record<string, unknown> | null, opts?: { key?: string; dedupeMs?: number }) => boolean;
  deviceCaps: DeviceCapsLike;
  downloadByFileId: Map<string, DownloadState>;
  disableFileHttp: (reason: string) => void;

  nextTransferId: () => string;
  updateTransferByFileId: (fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => void;
  scheduleSaveFileTransfers: () => void;

  resolveFileMeta: (fileId: string) => { name: string; size: number; mime: string | null };
  shouldCacheFile: (name: string, mime: string | null | undefined, size: number) => boolean;
  shouldCachePreview: (name: string, mime: string | null | undefined, size: number) => boolean;
  enforceFileCachePolicy: (userId: string, opts?: { force?: boolean }) => Promise<void>;
  thumbCacheId: (fileId: string) => string;
  canAutoDownloadFullFile: (userId: string | null, kind: AutoDownloadKind, size: number) => boolean;
  resolveAutoDownloadKind: (name: string, mime: string | null | undefined, hint?: string | null) => AutoDownloadKind;

  isSilentFileGet: (fileId: string) => boolean;
  clearSilentFileGet: (fileId: string) => void;
  clearFileAcceptRetry: (fileId: string) => void;
  clearFileGetNotFoundRetry: (fileId: string) => void;
  scheduleFileGetNotFoundRetry: (
    fileId: string,
    opts?: { priority?: "high" | "prefetch"; silent?: boolean; attempts?: number }
  ) => boolean;
  finishFileGet: (fileId: string) => void;
  touchFileGetTimeout: (fileId: string) => void;
  dropFileGetQueue: (fileId: string) => void;

  tryResolveHttpFileUrlWaiter: (msg: any) => boolean;
  requestFreshHttpDownloadUrl: (fileId: string) => Promise<HttpFileUrlInfoLike>;
  rejectHttpFileUrlWaiter: (fileId: string, reason: string) => void;

  scheduleThumbPollRetry: (fileId: string) => void;
  clearThumbPollRetry: (fileId: string) => void;
  setFileThumb: (
    fileId: string,
    url: string,
    mime: string | null,
    dims?: { w?: number | null; h?: number | null; mediaW?: number | null; mediaH?: number | null }
  ) => void;
  maybeSetVideoPosterFromBlob: (fileId: string, blob: Blob, meta?: { name?: string | null; mime?: string | null }) => void;
  probeImageDimensions: (blob: Blob) => Promise<{ w: number | null; h: number | null }>;

  pendingFileDownloads: Map<string, { name: string }>;
  triggerBrowserDownload: (url: string, name: string) => void;

  takePendingFileViewer: (fileId: string) => PendingFileViewer | null;
  clearPendingFileViewer: (fileId: string) => void;
  buildFileViewerModalState: (params: {
    fileId?: string | null;
    url: string;
    name: string;
    size: number;
    mime: string | null;
    caption: string | null;
    fallbackUrl?: string | null;
    chatKey: string | null;
    msgIdx: number | null;
  }) => FileViewerModalState;

  postStreamChunk: (streamId: string, bytes: Uint8Array) => boolean;
  postStreamEnd: (streamId: string) => void;
  postStreamError: (streamId: string, reason: string) => void;

  clearCachedPreviewAttempt: (userId: string, fileId: string) => void;
  clearPreviewPrefetchAttempt: (userId: string, fileId: string) => void;

  isUploadActive: (fileId: string) => boolean;
  abortUploadByFileId: (fileId: string) => void;
}

export interface FileDownloadFeature {
  handleMessage: (msg: any) => boolean;
  abortHttpDownload: (fileId: string, reason?: string, opts?: { quiet?: boolean }) => void;
  reset: () => void;
}
