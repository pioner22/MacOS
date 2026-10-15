import { setCachedLocalMediaAspectRatio } from "../../../helpers/chat/localMediaAspectCache";
import { clampMediaAspectRatio, setCachedMediaAspectRatio } from "../../../helpers/chat/mediaAspectCache";

export interface HistoryMediaHydrationRuntimeDeps {
  chatHost: HTMLElement;
  ensureVideoMutedDefault: (video: HTMLVideoElement) => void;
  scheduleAutoFetchVisiblePreviews: () => void;
  scheduleChatStickyResize: () => void;
}

function parseAspectRatioValue(value: string | null | undefined): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length !== 2) return null;
    const left = Number(parts[0]);
    const right = Number(parts[1]);
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null;
    return clampMediaAspectRatio(left / right);
  }
  const ratio = Number(raw);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return clampMediaAspectRatio(ratio);
}

export function didPreviewGeometryChange(options: {
  currentAspectRatio?: string | null;
  nextRatio: number;
  fileKind?: string | null;
  sourceTagName?: string | null;
}): boolean {
  const current = parseAspectRatioValue(options.currentAspectRatio);
  const next = resolveStablePreviewAspectRatio(options);
  return current === null || Math.abs(current - next) >= 0.0001;
}

export function resolveStablePreviewAspectRatio(options: {
  currentAspectRatio?: string | null;
  nextRatio: number;
  fileKind?: string | null;
  sourceTagName?: string | null;
}): number {
  const next = clampMediaAspectRatio(options.nextRatio);
  const current = parseAspectRatioValue(options.currentAspectRatio);
  if (current !== null) return current;
  return next;
}

function applyMediaAspectRatio(el: HTMLElement, ratio: number, meta?: { duration?: number | null }): boolean {
  const button = el.closest("button.chat-file-preview") as HTMLButtonElement | null;
  if (!button) return false;
  if (button.getAttribute("data-media-fixed") === "1") return false;
  const clamped = resolveStablePreviewAspectRatio({
    currentAspectRatio: button.style.aspectRatio,
    nextRatio: ratio,
    fileKind: button.getAttribute("data-file-kind"),
    sourceTagName: el.tagName,
  });
  const ratioChanged = didPreviewGeometryChange({
    currentAspectRatio: button.style.aspectRatio,
    nextRatio: ratio,
    fileKind: button.getAttribute("data-file-kind"),
    sourceTagName: el.tagName,
  });
  if (ratioChanged) button.style.aspectRatio = String(clamped);
  const fileId = String(button.getAttribute("data-file-id") || "").trim();
  const localId = String(button.getAttribute("data-local-id") || "").trim();
  const measured = clampMediaAspectRatio(ratio);
  if (localId) setCachedLocalMediaAspectRatio(localId, measured);
  if (fileId) setCachedMediaAspectRatio(fileId, measured);

  const msg = button.closest("div.msg") as HTMLElement | null;
  if (!msg) return ratioChanged;
  if (msg.getAttribute("data-msg-album") === "1" || msg.classList.contains("msg-album")) return ratioChanged;

  const name = String(button.getAttribute("data-name") || "").trim().toLowerCase();
  const mime = String(button.getAttribute("data-mime") || "").trim().toLowerCase();
  const size = Number(button.getAttribute("data-size") || 0) || 0;
  const fileKind = String(button.getAttribute("data-file-kind") || "").trim();
  const isSquare = measured >= 0.85 && measured <= 1.18;
  let flagsChanged = false;
  const setFlag = (attr: string, ok: boolean) => {
    const has = msg.getAttribute(attr) === "1";
    if (ok) {
      if (!has) {
        msg.setAttribute(attr, "1");
        flagsChanged = true;
      }
      return;
    }
    if (has) {
      msg.removeAttribute(attr);
      flagsChanged = true;
    }
  };

  const caption = String(button.getAttribute("data-caption") || "").trim();
  if (caption) {
    setFlag("data-msg-sticker", false);
    setFlag("data-msg-round-video", false);
    return ratioChanged || flagsChanged;
  }

  const isSticker = fileKind === "image" && isSquare && size > 0 && size <= 600_000 && (mime === "image/webp" || name.endsWith(".webp"));
  const duration = typeof meta?.duration === "number" && Number.isFinite(meta.duration) ? meta.duration : null;
  const isRoundVideo = fileKind === "video" && isSquare && size > 0 && size <= 25_000_000 && (duration === null || duration <= 75);

  setFlag("data-msg-sticker", isSticker);
  setFlag("data-msg-round-video", isRoundVideo);
  return ratioChanged || flagsChanged;
}

function setInlineVideoState(video: HTMLVideoElement, state: "playing" | "paused") {
  const preview = video.closest("button.chat-file-preview") as HTMLButtonElement | null;
  if (!preview || !preview.classList.contains("chat-file-preview-video")) return;
  preview.dataset.videoState = state;
}

function markVideoUserUnmuted(video: HTMLVideoElement) {
  if (video.dataset.allowAudio === "1") return;
  if (video.dataset.userUnmuted === "1") return;
  if (!video.muted && video.volume > 0) video.dataset.userUnmuted = "1";
}

export function createHistoryMediaHydrationRuntime(deps: HistoryMediaHydrationRuntimeDeps) {
  const { chatHost, ensureVideoMutedDefault, scheduleAutoFetchVisiblePreviews, scheduleChatStickyResize } = deps;

  const syncExistingMediaState = () => {
    let geometryChanged = false;
    const images = chatHost.querySelectorAll("img.chat-file-img");
    for (const node of Array.from(images)) {
      if (!(node instanceof HTMLImageElement)) continue;
      if (!node.complete) continue;
      if (!node.naturalWidth || !node.naturalHeight) continue;
      const ratio = node.naturalWidth / Math.max(1, node.naturalHeight);
      geometryChanged = applyMediaAspectRatio(node, ratio) || geometryChanged;
    }

    const videos = chatHost.querySelectorAll("video.chat-file-video");
    for (const node of Array.from(videos)) {
      if (!(node instanceof HTMLVideoElement)) continue;
      ensureVideoMutedDefault(node);
      setInlineVideoState(node, node.paused ? "paused" : "playing");
      const width = node.videoWidth || 0;
      const height = node.videoHeight || 0;
      if (width > 0 && height > 0) {
        const ratio = width / Math.max(1, height);
        geometryChanged = applyMediaAspectRatio(node, ratio, { duration: node.duration }) || geometryChanged;
      }
    }

    scheduleAutoFetchVisiblePreviews();
    if (geometryChanged) scheduleChatStickyResize();
  };

  const handleImageLoad = (target: EventTarget | null) => {
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.classList.contains("chat-file-img")) return;
    const ratio = (target.naturalWidth || 0) / Math.max(1, target.naturalHeight || 0);
    if (applyMediaAspectRatio(target, ratio)) scheduleChatStickyResize();
  };

  const handleLoadedMetadata = (target: EventTarget | null) => {
    if (!(target instanceof HTMLVideoElement)) return;
    if (!target.classList.contains("chat-file-video")) return;
    const ratio = (target.videoWidth || 0) / Math.max(1, target.videoHeight || 0);
    if (applyMediaAspectRatio(target, ratio, { duration: target.duration })) scheduleChatStickyResize();
  };

  const handleVideoPlay = (target: EventTarget | null) => {
    if (!(target instanceof HTMLVideoElement)) return;
    if (!target.classList.contains("chat-file-video")) return;
    setInlineVideoState(target, "playing");
  };

  const handleVideoPause = (target: EventTarget | null) => {
    if (!(target instanceof HTMLVideoElement)) return;
    if (!target.classList.contains("chat-file-video")) return;
    setInlineVideoState(target, "paused");
  };

  const handleDocumentMediaBootstrap = (target: EventTarget | null) => {
    if (target instanceof HTMLVideoElement) ensureVideoMutedDefault(target);
  };

  const handleDocumentVolumeChange = (target: EventTarget | null) => {
    if (target instanceof HTMLVideoElement) markVideoUserUnmuted(target);
  };

  const handleExclusiveMediaPlay = (target: EventTarget | null) => {
    if (!(target instanceof HTMLAudioElement || target instanceof HTMLVideoElement)) return;
    const nodes = document.querySelectorAll("audio, video");
    for (const node of Array.from(nodes)) {
      if (!(node instanceof HTMLAudioElement || node instanceof HTMLVideoElement)) continue;
      if (node === target) continue;
      if (node.paused) continue;
      try {
        node.pause();
      } catch {
        // ignore
      }
    }
  };

  return {
    syncExistingMediaState,
    handleImageLoad,
    handleLoadedMetadata,
    handleVideoPlay,
    handleVideoPause,
    handleDocumentMediaBootstrap,
    handleDocumentVolumeChange,
    handleExclusiveMediaPlay,
  };
}
