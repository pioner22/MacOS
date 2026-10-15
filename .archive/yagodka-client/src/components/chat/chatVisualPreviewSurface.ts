import { el } from "../../helpers/dom/el";
import { MISSING_FILE_STATUS, isTerminalMissingVisualTransfer } from "../../helpers/files/fileMissingState";
import type { FileTransferEntry } from "../../stores/types";
import {
  type ChatVisualPreviewOptions,
  type FileAttachmentInfo,
  isVideoNoteName,
  resolveHistoryMediaSlotAspectRatio,
} from "./chatVisualPreviewShared";

type RenderDeferredVisualPreviewSurfaceCtx = {
  mount: HTMLButtonElement;
  info: FileAttachmentInfo;
  opts?: ChatVisualPreviewOptions;
};

function renderMediaProgressOverlay(transfer: FileTransferEntry): HTMLElement | null {
  if (transfer.status !== "uploading" && transfer.status !== "downloading") return null;
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

function applyReservedHistoryMediaSlot(btn: HTMLButtonElement, info: FileAttachmentInfo, fixedAspect: boolean): void {
  if (fixedAspect) return;
  const ratio = resolveHistoryMediaSlotAspectRatio(info);
  if (!ratio) return;
  btn.style.aspectRatio = ratio;
  btn.style.setProperty("--chat-media-slot-ratio", ratio);
  btn.setAttribute("data-history-geometry", "reserved");
}

function renderMediaState(label: string, tone: "idle" | "active" | "error"): HTMLElement {
  return el("span", { class: `chat-media-state chat-media-state-${tone}`, "aria-hidden": "true" }, [label]);
}

function mediaProgressLabel(transfer?: FileTransferEntry | null): string | null {
  if (!transfer || (transfer.status !== "uploading" && transfer.status !== "downloading")) return null;
  const progress = Math.max(0, Math.min(100, Math.round(transfer.progress || 0)));
  return transfer.status === "uploading" ? `Загрузка ${progress}%` : `Скачивание ${progress}%`;
}

export function renderImagePreviewButton(info: FileAttachmentInfo, opts?: ChatVisualPreviewOptions): HTMLButtonElement | null {
  if (!info.isImage) return null;
  const previewUrl = info.thumbUrl || info.url;
  if (!previewUrl && !info.fileId) return null;
  const terminalMissingVisual = isTerminalMissingVisualTransfer(info.transfer, { name: info.name, mime: info.mime, kindHint: "image" });
  const classes = previewUrl ? ["chat-file-preview"] : ["chat-file-preview", "chat-file-preview-empty"];
  if (opts?.className) classes.push(opts.className);
  if (terminalMissingVisual && !classes.includes("chat-file-preview-empty")) classes.push("chat-file-preview-empty");
  if (terminalMissingVisual) classes.push("chat-file-preview-missing");
  const fixedAspect = Boolean(opts?.className && opts.className.split(/\s+/).includes("chat-file-preview-album"));
  const attrs: Record<string, string | undefined> = {
    class: classes.join(" "),
    type: "button",
    "data-action": terminalMissingVisual ? undefined : "open-file-viewer",
    "data-file-kind": "image",
    "data-name": info.name,
    "data-size": String(info.size || 0),
    ...(fixedAspect ? { "data-media-fixed": "1" } : {}),
    ...(terminalMissingVisual ? { disabled: "true", "data-media-missing": "1", title: MISSING_FILE_STATUS } : {}),
    "aria-label": terminalMissingVisual ? `${MISSING_FILE_STATUS}: ${info.name}` : `Открыть: ${info.name}`,
  };
  if (info.transfer?.localId) attrs["data-local-id"] = info.transfer.localId;
  const progressOverlay = info.transfer && !terminalMissingVisual ? renderMediaProgressOverlay(info.transfer) : null;
  if (progressOverlay) attrs["data-media-progress"] = "1";
  if (terminalMissingVisual) attrs["data-media-state"] = "missing";
  else if (progressOverlay) attrs["data-media-state"] = "progress";
  else if (!previewUrl) attrs["data-media-state"] = "empty";
  if (info.url) attrs["data-url"] = info.url;
  if (info.fileId) attrs["data-file-id"] = info.fileId;
  if (info.mime) attrs["data-mime"] = info.mime;
  if (opts?.msgIdx !== undefined) attrs["data-msg-idx"] = String(opts.msgIdx);
  if (opts?.caption) attrs["data-caption"] = opts.caption;

  const child = terminalMissingVisual
    ? el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Недоступно"])
    : previewUrl
    ? el("img", { class: "chat-file-img", src: previewUrl, alt: info.name, loading: "lazy", decoding: "async" })
    : el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Фото"]);
  const btnChildren: HTMLElement[] = [child];
  if (terminalMissingVisual) btnChildren.push(renderMediaState(MISSING_FILE_STATUS, "error"));
  else {
    const progressLabel = mediaProgressLabel(info.transfer);
    if (progressLabel) btnChildren.push(renderMediaState(progressLabel, "active"));
    else if (!previewUrl) btnChildren.push(renderMediaState("Загрузить фото", "idle"));
  }
  if (progressOverlay) btnChildren.push(progressOverlay);
  const btn = el("button", attrs, btnChildren) as HTMLButtonElement;
  applyReservedHistoryMediaSlot(btn, info, fixedAspect);
  return btn;
}

export function renderVideoPreviewButton(info: FileAttachmentInfo, opts?: ChatVisualPreviewOptions): HTMLButtonElement | null {
  if (!info.isVideo) return null;
  const fixedAspect = Boolean(opts?.className && opts.className.split(/\s+/).includes("chat-file-preview-album"));
  const videoNote = !fixedAspect && isVideoNoteName(info.name);
  const mobileUi = Boolean(opts?.mobileUi);
  const progressOverlay = info.transfer ? renderMediaProgressOverlay(info.transfer) : null;
  const bytes = Number(info.size || 0) || 0;
  const INLINE_VIDEO_MAX_BYTES = 8 * 1024 * 1024;
  const canInlineVideo = Boolean(!fixedAspect && info.url && !mobileUi && bytes > 0 && bytes <= INLINE_VIDEO_MAX_BYTES);
  const previewUrl = fixedAspect ? info.thumbUrl : canInlineVideo ? info.url : info.thumbUrl;
  const terminalMissingVisual = isTerminalMissingVisualTransfer(info.transfer, { name: info.name, mime: info.mime, kindHint: "video" });
  const hasPendingLocalVideo = Boolean(info.transfer?.localId && info.transfer.status !== "complete");
  if (!previewUrl && !info.fileId && !hasPendingLocalVideo) return null;
  const hasVisual = Boolean(previewUrl);
  const classes = hasVisual
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
    ...(fixedAspect ? { "data-media-fixed": "1" } : {}),
    ...(canInlineVideo && !terminalMissingVisual ? { "data-video-state": "paused" } : {}),
    ...(progressOverlay && !terminalMissingVisual ? { "data-media-progress": "1" } : {}),
    ...(terminalMissingVisual
      ? { "data-media-state": "missing" }
      : progressOverlay
        ? { "data-media-state": "progress" }
        : !previewUrl
          ? { "data-media-state": "empty" }
          : {}),
    ...(terminalMissingVisual ? { disabled: "true", "data-media-missing": "1", title: MISSING_FILE_STATUS } : {}),
    "data-file-kind": "video",
    "data-name": info.name,
    "data-size": String(info.size || 0),
    "aria-label": terminalMissingVisual ? `${MISSING_FILE_STATUS}: ${info.name}` : `Открыть: ${info.name}`,
  };
  if (info.transfer?.localId) attrs["data-local-id"] = info.transfer.localId;
  if (info.url) attrs["data-url"] = info.url;
  if (info.fileId) attrs["data-file-id"] = info.fileId;
  if (info.mime) attrs["data-mime"] = info.mime;
  if (opts?.msgIdx !== undefined) attrs["data-msg-idx"] = String(opts.msgIdx);
  if (opts?.caption) attrs["data-caption"] = opts.caption;

  const children: HTMLElement[] = [
    terminalMissingVisual
      ? (el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Недоступно"]) as HTMLDivElement)
      : canInlineVideo
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
        ? (el("img", { class: "chat-file-img", src: previewUrl, alt: info.name, loading: "lazy", decoding: "async" }) as HTMLImageElement)
        : (el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Видео"]) as HTMLDivElement),
  ];
  if (terminalMissingVisual) {
    children.push(renderMediaState(MISSING_FILE_STATUS, "error"));
  } else if (canInlineVideo) {
    if (!progressOverlay) {
      children.push(el("span", { class: "chat-file-video-toggle", "data-action": "media-toggle", "aria-hidden": "true" }, [""]));
    }
  } else if (!progressOverlay) {
    children.push(el("span", { class: "chat-file-video-toggle", "aria-hidden": "true" }, [""]));
  }
  if (!terminalMissingVisual) {
    const progressLabel = mediaProgressLabel(info.transfer);
    if (progressLabel) children.push(renderMediaState(progressLabel, "active"));
    else if (!previewUrl) children.push(renderMediaState("Загрузить видео", "idle"));
  }
  if (progressOverlay) children.push(progressOverlay);
  const btn = el("button", attrs, children) as HTMLButtonElement;
  applyReservedHistoryMediaSlot(btn, info, fixedAspect);
  return btn;
}

function getMountChildren(node: HTMLButtonElement): Array<Node | HTMLElement> {
  if (Array.isArray((node as any)._children)) return [...(node as any)._children];
  if ("childNodes" in node && node.childNodes) return Array.from(node.childNodes);
  return [];
}

function syncPreviewMount(mount: HTMLButtonElement, finalNode: HTMLButtonElement) {
  mount.className = finalNode.className;
  const attrNames = [
    "type",
    "data-action",
    "data-file-kind",
    "data-name",
    "data-size",
    "data-media-fixed",
    "data-video-state",
    "data-media-progress",
    "data-media-state",
    "data-media-missing",
    "data-url",
    "data-file-id",
    "data-mime",
    "data-msg-idx",
    "data-caption",
    "data-local-id",
    "data-history-geometry",
    "disabled",
    "title",
    "aria-label",
  ];
  for (const name of attrNames) {
    const value = finalNode.getAttribute(name);
    if (value === null) {
      try {
        mount.removeAttribute(name);
      } catch {
        // ignore stub limitations
      }
      continue;
    }
    mount.setAttribute(name, value);
  }
  mount.replaceChildren(...getMountChildren(finalNode));
  try {
    const ratio = finalNode.style.getPropertyValue("--chat-media-slot-ratio");
    if (ratio) mount.style.setProperty("--chat-media-slot-ratio", ratio);
  } catch {
    // ignore stub limitations
  }
  try {
    mount.disabled = finalNode.disabled;
  } catch {
    // ignore stub limitations
  }
  (mount.style as any).aspectRatio = (finalNode.style as any).aspectRatio || (mount.style as any).aspectRatio || "";
}

export function renderDeferredVisualPreviewSurface(ctx: RenderDeferredVisualPreviewSurfaceCtx) {
  const finalNode = ctx.info.isImage ? renderImagePreviewButton(ctx.info, ctx.opts) : renderVideoPreviewButton(ctx.info, ctx.opts);
  if (!finalNode) {
    ctx.mount.replaceChildren();
    return;
  }
  syncPreviewMount(ctx.mount, finalNode);
}
