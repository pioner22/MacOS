import { el } from "../../helpers/dom/el";
import { MISSING_FILE_STATUS, isTerminalMissingVisualTransfer } from "../../helpers/files/fileMissingState";
import type { ChatVisualPreviewOptions, FileAttachmentInfo } from "./chatVisualPreviewShared";
import { isVideoNoteName, resolveHistoryMediaSlotAspectRatio } from "./chatVisualPreviewShared";

type ChatVisualPreviewModule = typeof import("./chatVisualPreviewSurface");

type RenderDeferredVisualPreviewOptions = {
  info: FileAttachmentInfo;
  opts?: ChatVisualPreviewOptions;
};

type RenderDeferredVisualPreviewSurfaceCtx = RenderDeferredVisualPreviewOptions & {
  mount: HTMLButtonElement;
};

let visualPreviewModule: ChatVisualPreviewModule | null = null;
let visualPreviewPromise: Promise<ChatVisualPreviewModule> | null = null;

function canRenderMount(mount: HTMLElement | null): mount is HTMLButtonElement {
  if (!mount) return false;
  return (mount as HTMLElement & { isConnected?: boolean }).isConnected !== false;
}

function ensureVisualPreviewModule() {
  if (visualPreviewModule) return Promise.resolve(visualPreviewModule);
  if (visualPreviewPromise) return visualPreviewPromise;
  visualPreviewPromise = import("./chatVisualPreviewSurface")
    .then((mod: ChatVisualPreviewModule) => {
      visualPreviewModule = mod;
      return mod;
    })
    .finally(() => {
      if (visualPreviewModule) visualPreviewPromise = null;
    });
  return visualPreviewPromise;
}

function renderPlaceholderProgress(info: FileAttachmentInfo): HTMLElement | null {
  const transfer = info.transfer;
  if (!transfer || (transfer.status !== "uploading" && transfer.status !== "downloading")) return null;
  const progress = Math.max(0, Math.min(100, Math.round(transfer.progress || 0)));
  const label = transfer.status === "uploading" ? `Загрузка ${progress}%` : `Скачивание ${progress}%`;
  const candy = el("span", { class: "file-progress-candy", "aria-hidden": "true" });
  candy.style.setProperty("--file-progress", `${progress}%`);
  return el(
    "span",
    {
      class: "chat-media-progress",
      role: "progressbar",
      title: label,
      "aria-label": label,
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(progress),
    },
    [candy]
  );
}

function canInlineLocalVideoPreview(info: FileAttachmentInfo, opts: ChatVisualPreviewOptions | undefined, fixedAspect: boolean): boolean {
  const bytes = Number(info.size || 0) || 0;
  const inlineVideoMaxBytes = 8 * 1024 * 1024;
  return Boolean(info.isVideo && !fixedAspect && info.url && !opts?.mobileUi && bytes > 0 && bytes <= inlineVideoMaxBytes);
}

function renderDeferredVisualPlaceholder(options: RenderDeferredVisualPreviewOptions): HTMLButtonElement | null {
  const { info, opts } = options;
  if (!info.isImage && !info.isVideo) return null;
  const fixedAspect = Boolean(opts?.className && opts.className.split(/\s+/).includes("chat-file-preview-album"));
  const videoNote = Boolean(info.isVideo && !fixedAspect && isVideoNoteName(info.name));
  const canInlineVideo = canInlineLocalVideoPreview(info, opts, fixedAspect);
  const previewUrl = info.isImage ? info.thumbUrl || info.url : fixedAspect ? info.thumbUrl : canInlineVideo ? info.url : info.thumbUrl;
  const terminalMissingVisual = isTerminalMissingVisualTransfer(info.transfer, {
    name: info.name,
    mime: info.mime,
    kindHint: info.isImage ? "image" : "video",
  });
  const hasPendingLocalVideo = Boolean(info.isVideo && info.transfer?.localId && info.transfer.status !== "complete");
  if (!previewUrl && !info.fileId && !hasPendingLocalVideo) return null;

  const classes = info.isImage
    ? previewUrl
      ? ["chat-file-preview"]
      : ["chat-file-preview", "chat-file-preview-empty"]
    : previewUrl
      ? ["chat-file-preview", "chat-file-preview-video"]
      : ["chat-file-preview", "chat-file-preview-video", "chat-file-preview-empty"];
  if (opts?.className) classes.push(opts.className);
  if (videoNote) classes.push("chat-file-preview-video-note");
  if (terminalMissingVisual && !classes.includes("chat-file-preview-empty")) classes.push("chat-file-preview-empty");
  if (terminalMissingVisual) classes.push("chat-file-preview-missing");

  const attrs: Record<string, string | undefined> = {
    class: classes.join(" "),
    type: "button",
    "data-action": terminalMissingVisual ? undefined : "open-file-viewer",
    "data-file-kind": info.isImage ? "image" : "video",
    "data-name": info.name,
    "data-size": String(info.size || 0),
    ...(fixedAspect ? { "data-media-fixed": "1" } : {}),
    ...(terminalMissingVisual ? { disabled: "true", "data-media-missing": "1", title: MISSING_FILE_STATUS } : {}),
    "aria-label": terminalMissingVisual ? `${MISSING_FILE_STATUS}: ${info.name}` : `Открыть: ${info.name}`,
  };
  const progressOverlay = renderPlaceholderProgress(info);
  if (progressOverlay) attrs["data-media-progress"] = "1";
  if (info.transfer?.localId) attrs["data-local-id"] = info.transfer.localId;
  if (info.url) attrs["data-url"] = info.url;
  if (info.fileId) attrs["data-file-id"] = info.fileId;
  if (info.mime) attrs["data-mime"] = info.mime;
  if (opts?.msgIdx !== undefined) attrs["data-msg-idx"] = String(opts.msgIdx);
  if (opts?.caption) attrs["data-caption"] = opts.caption;

  const child =
    terminalMissingVisual
      ? el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Недоступно"])
      : info.isVideo && canInlineVideo
      ? (() => {
          const video = el("video", {
            class: "chat-file-video",
            src: info.url || undefined,
            preload: "metadata",
            playsinline: "true",
            muted: "true",
            loop: "true",
            ...(info.thumbUrl ? { poster: info.thumbUrl } : {}),
          }) as HTMLVideoElement;
          video.muted = true;
          video.defaultMuted = true;
          return video;
        })()
      : previewUrl
        ? el("img", { class: "chat-file-img", src: previewUrl, alt: info.name, loading: "lazy", decoding: "async" })
        : el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, [info.isImage ? "Фото" : "Видео"]);
  const children: HTMLElement[] = [child];
  if (info.isVideo && !progressOverlay && !terminalMissingVisual) {
    children.push(el("span", { class: "chat-file-video-toggle", "aria-hidden": "true" }, [""]));
  }
  if (progressOverlay) children.push(progressOverlay);
  const mount = el("button", attrs, children) as HTMLButtonElement;

  if (!fixedAspect) {
    const ratio = resolveHistoryMediaSlotAspectRatio(info);
    if (ratio) {
      mount.style.aspectRatio = ratio;
      mount.style.setProperty("--chat-media-slot-ratio", ratio);
      mount.setAttribute("data-history-geometry", "reserved");
    }
  }

  return mount;
}

export function renderDeferredVisualPreview(options: RenderDeferredVisualPreviewOptions): HTMLButtonElement | null {
  const mount = renderDeferredVisualPlaceholder(options);
  if (!mount) return null;
  const ctx: RenderDeferredVisualPreviewSurfaceCtx = { mount, ...options };
  if (visualPreviewModule) {
    visualPreviewModule.renderDeferredVisualPreviewSurface(ctx);
    return mount;
  }
  void ensureVisualPreviewModule()
    .then((mod) => {
      if (!canRenderMount(mount)) return;
      mod.renderDeferredVisualPreviewSurface(ctx);
    })
    .catch(() => {
      // Keep the lightweight placeholder if the deferred preview surface fails to load.
    });
  return mount;
}
