import type { FileOfferIn, FileTransferEntry } from "../../stores/types";
import { getCachedMediaAspectRatio } from "../../helpers/chat/mediaAspectCache";
import { getCachedLocalMediaAspectRatio } from "../../helpers/chat/localMediaAspectCache";

export type FileAttachmentInfo = {
  name: string;
  size: number;
  mime: string | null;
  fileId: string | null;
  url: string | null;
  thumbUrl: string | null;
  thumbW: number | null;
  thumbH: number | null;
  mediaW: number | null;
  mediaH: number | null;
  transfer: FileTransferEntry | null;
  offer: FileOfferIn | null;
  statusLine: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  hasProgress: boolean;
};

export type ChatVisualPreviewOptions = {
  className?: string;
  msgIdx?: number;
  caption?: string | null;
  mobileUi?: boolean;
};

export const CHAT_MEDIA_PREVIEW_SCALE = 0.5;
export const CHAT_MEDIA_PREVIEW_FALLBACK_BASE_PX = 420;
export const CHAT_HISTORY_MEDIA_SLOT_BASE_PX = 1000;
export const CHAT_IMAGE_PREVIEW_FALLBACK_ASPECT_RATIO = 4 / 3;
export const CHAT_VIDEO_PREVIEW_FALLBACK_ASPECT_RATIO = 16 / 9;
const CHAT_HISTORY_IMAGE_SLOT_RATIO_MIN = 0.72;
const CHAT_HISTORY_MEDIA_SLOT_RATIO_MIN = 0.4;
const CHAT_HISTORY_MEDIA_SLOT_RATIO_MAX = 2.6;

const historyMediaSlotRatios = new Map<string, number>();

export function resolvePreviewBaseWidthPx(info: FileAttachmentInfo): number | null {
  const w = info.mediaW || info.thumbW || CHAT_MEDIA_PREVIEW_FALLBACK_BASE_PX;
  if (!Number.isFinite(w) || w <= 0) return null;
  return Math.trunc(w);
}

function normalizePreviewFileName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0];
  const leaf = noQuery.split(/[\\/]/).pop() || "";
  return leaf.trim().toLowerCase();
}

export function isVideoNoteName(name: string): boolean {
  const n = normalizePreviewFileName(name);
  return n.startsWith("video_note") || n.startsWith("video-note") || n.includes("_video_note");
}

function clampHistoryMediaSlotRatio(ratio: number, minRatio = CHAT_HISTORY_MEDIA_SLOT_RATIO_MIN): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(CHAT_HISTORY_MEDIA_SLOT_RATIO_MAX, Math.max(minRatio, ratio));
}

function historyMediaSlotKey(info: FileAttachmentInfo): string {
  const fileId = String(info.fileId || "").trim();
  if (fileId) return `file:${fileId}`;
  const localId = String(info.transfer?.localId || "").trim();
  if (localId) return `local:${localId}`;
  return "";
}

function knownHistoryMediaSlotRatio(info: FileAttachmentInfo): number | null {
  const previewRatio =
    info.thumbW && info.thumbH ? info.thumbW / info.thumbH : info.mediaW && info.mediaH ? info.mediaW / info.mediaH : null;
  const cachedRatio = info.fileId ? getCachedMediaAspectRatio(info.fileId) : null;
  const cachedLocalRatio = !cachedRatio && info.transfer?.localId ? getCachedLocalMediaAspectRatio(info.transfer.localId) : null;
  const ratio = info.isVideo ? previewRatio ?? cachedRatio ?? cachedLocalRatio : cachedRatio ?? cachedLocalRatio ?? previewRatio;
  if (typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0) {
    return clampHistoryMediaSlotRatio(ratio, info.isImage ? CHAT_HISTORY_IMAGE_SLOT_RATIO_MIN : CHAT_HISTORY_MEDIA_SLOT_RATIO_MIN);
  }
  return null;
}

function fallbackHistoryMediaSlotRatio(info: FileAttachmentInfo): number | null {
  if (info.isVideo && isVideoNoteName(info.name)) return 1;
  if (info.isVideo) return CHAT_VIDEO_PREVIEW_FALLBACK_ASPECT_RATIO;
  if (info.isImage) return CHAT_IMAGE_PREVIEW_FALLBACK_ASPECT_RATIO;
  return null;
}

export function resolveHistoryMediaSlotRatio(info: FileAttachmentInfo): number | null {
  const key = historyMediaSlotKey(info);
  const reserved = key ? historyMediaSlotRatios.get(key) : null;
  if (typeof reserved === "number" && Number.isFinite(reserved) && reserved > 0) return reserved;
  const ratio = knownHistoryMediaSlotRatio(info) ?? fallbackHistoryMediaSlotRatio(info);
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) return null;
  const clamped = clampHistoryMediaSlotRatio(ratio, info.isImage ? CHAT_HISTORY_IMAGE_SLOT_RATIO_MIN : CHAT_HISTORY_MEDIA_SLOT_RATIO_MIN);
  if (key) historyMediaSlotRatios.set(key, clamped);
  return clamped;
}

export function resolveHistoryMediaSlotAspectRatio(info: FileAttachmentInfo): string | null {
  const ratio = resolveHistoryMediaSlotRatio(info);
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) return null;
  if (info.isVideo && isVideoNoteName(info.name) && Math.abs(ratio - 1) < 0.001) return "1 / 1";
  return String(ratio);
}

export function resolveHistoryMediaSlotSize(info: FileAttachmentInfo, fallbackRatio = 1): { w: number; h: number } {
  const key = historyMediaSlotKey(info);
  const reserved = key ? historyMediaSlotRatios.get(key) : null;
  const ratio =
    typeof reserved === "number" && Number.isFinite(reserved) && reserved > 0
      ? reserved
      : (knownHistoryMediaSlotRatio(info) ??
        clampHistoryMediaSlotRatio(fallbackRatio, info.isImage ? CHAT_HISTORY_IMAGE_SLOT_RATIO_MIN : CHAT_HISTORY_MEDIA_SLOT_RATIO_MIN));
  if (key && !(typeof reserved === "number" && Number.isFinite(reserved) && reserved > 0)) {
    historyMediaSlotRatios.set(key, ratio);
  }
  return { w: Math.max(1, Math.round(CHAT_HISTORY_MEDIA_SLOT_BASE_PX * ratio)), h: CHAT_HISTORY_MEDIA_SLOT_BASE_PX };
}

export function resolveFallbackPreviewAspectRatio(info: FileAttachmentInfo): string | null {
  if (info.isVideo && isVideoNoteName(info.name)) return "1 / 1";
  if (info.isVideo) return String(CHAT_VIDEO_PREVIEW_FALLBACK_ASPECT_RATIO);
  if (info.isImage) return String(CHAT_IMAGE_PREVIEW_FALLBACK_ASPECT_RATIO);
  return null;
}
