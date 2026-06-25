import { el } from "../../helpers/dom/el";
import { fileBadge, type FileBadgeKind } from "../../helpers/files/fileBadge";
import { isTerminalMissingVisualTransfer } from "../../helpers/files/fileMissingState";
import { isPdfLikeFile } from "../../helpers/files/mediaKind";
import type { FileAttachmentInfo } from "./chatVisualPreviewShared";

export type ChatFileSurfaceInfo = {
  badgeKind: FileBadgeKind;
  badgeLabel: string;
  badgeHue: number;
  kindLabel: string;
  stateLabel: string;
  stateTone: "idle" | "active" | "done" | "error";
  rowClass: string;
  openable: boolean;
  downloadLabel: string;
  downloadDisabled: boolean;
};

function formatFileBytes(size: number): string {
  if (!size || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const precision = value >= 100 || idx === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}

function kindLabel(kind: FileBadgeKind): string {
  if (kind === "pdf") return "PDF";
  if (kind === "doc") return "Документ";
  if (kind === "archive") return "Архив";
  if (kind === "audio") return "Аудио";
  if (kind === "image") return "Фото";
  if (kind === "video") return "Видео";
  return "Файл";
}

export function resolveChatFileSurfaceInfo(info: FileAttachmentInfo): ChatFileSurfaceInfo {
  const badge = fileBadge(info.name, info.mime);
  const isPdf = badge.kind === "pdf" || isPdfLikeFile(info.name, info.mime);
  const transferStatus = info.transfer?.status || "";
  const terminalMissingVisual = isTerminalMissingVisualTransfer(info.transfer, { name: info.name, mime: info.mime });
  const hasUrl = Boolean(info.url);
  const openable = Boolean((isPdf || badge.kind === "doc") && (info.fileId || info.url));
  let stateTone: ChatFileSurfaceInfo["stateTone"] = "idle";
  let stateLabel = "Файл";
  let downloadLabel = "Скачать";
  let downloadDisabled = false;

  if (info.offer) {
    stateLabel = "Нужно принять";
    downloadLabel = "Принять";
  } else if (transferStatus === "uploading" || transferStatus === "downloading") {
    const progress = Math.max(0, Math.min(100, Math.round(info.transfer?.progress || 0)));
    stateTone = "active";
    stateLabel = transferStatus === "uploading" ? `Загрузка ${progress}%` : `Скачивание ${progress}%`;
    downloadLabel = transferStatus === "uploading" ? "Загружается" : "Скачивается";
    downloadDisabled = true;
  } else if (transferStatus === "complete" || hasUrl) {
    stateTone = "done";
    stateLabel = "Готово";
  } else if (transferStatus === "uploaded") {
    stateTone = "done";
    stateLabel = "Отправлено";
  } else if (transferStatus === "error") {
    stateTone = "error";
    stateLabel = terminalMissingVisual ? "Недоступен" : "Ошибка";
    downloadLabel = terminalMissingVisual ? "Недоступен" : "Повторить";
    downloadDisabled = terminalMissingVisual;
  } else if (transferStatus === "rejected") {
    stateTone = "error";
    stateLabel = "Отклонено";
    downloadDisabled = true;
  } else if (info.fileId) {
    stateLabel = "Доступен";
  }

  return {
    badgeKind: isPdf ? "pdf" : badge.kind,
    badgeLabel: isPdf ? "PDF" : badge.label,
    badgeHue: badge.hue,
    kindLabel: kindLabel(isPdf ? "pdf" : badge.kind),
    stateLabel,
    stateTone,
    rowClass: [
      `file-row-${isPdf ? "pdf" : badge.kind}`,
      `file-row-state-${stateTone}`,
      openable ? "file-row-openable" : "",
    ]
      .filter(Boolean)
      .join(" "),
    openable,
    downloadLabel,
    downloadDisabled,
  };
}

export function renderChatFilePills(info: FileAttachmentInfo, surface: ChatFileSurfaceInfo): HTMLElement {
  const sizeLabel = formatFileBytes(info.size);
  return el("div", { class: "file-chip-row", "aria-label": "Состояние файла" }, [
    el("span", { class: `file-chip file-chip-kind file-chip-${surface.badgeKind}` }, [surface.kindLabel]),
    el("span", { class: `file-chip file-chip-state file-chip-${surface.stateTone}` }, [surface.stateLabel]),
    ...(info.size > 0 ? [el("span", { class: "file-chip file-chip-size" }, [sizeLabel])] : []),
  ]);
}

export function renderChatFileActions(
  info: FileAttachmentInfo,
  surface: ChatFileSurfaceInfo,
  opts: { caption: string; msgIdx?: number; visualMedia?: boolean }
): HTMLElement[] {
  const name = info.name || "файл";
  const attrs = {
    "data-file-id": info.fileId || undefined,
    "data-url": info.url || undefined,
    "data-name": name,
    "data-size": String(info.size || 0),
    "data-mime": info.mime || undefined,
    "data-file-kind": surface.badgeKind,
    "data-caption": opts.caption || undefined,
    "data-msg-idx": typeof opts.msgIdx === "number" && Number.isFinite(opts.msgIdx) ? String(Math.trunc(opts.msgIdx)) : undefined,
  };

  const actions: HTMLElement[] = [];
  if (surface.openable && !opts.visualMedia) {
    actions.push(
      el(
        "button",
        {
          class: "btn btn-primary file-action file-action-open",
          type: "button",
          "data-action": "open-file-viewer",
          "aria-label": `Открыть: ${name}`,
          ...attrs,
        },
        [surface.badgeKind === "pdf" ? "Открыть PDF" : "Открыть"]
      )
    );
  }

  if (info.offer?.id) {
    actions.push(
      el(
        "button",
        { class: "btn btn-primary file-action file-action-accept", type: "button", "data-action": "file-accept", "data-file-id": info.offer.id, "aria-label": `Принять: ${name}` },
        ["Принять"]
      )
    );
  } else if (info.fileId) {
    actions.push(
      el(
        "button",
        {
          class: "btn file-action file-action-download",
          type: "button",
          "data-action": "file-download",
          "data-file-id": info.fileId,
          "aria-label": `${surface.downloadLabel}: ${name}`,
          ...(surface.downloadDisabled ? { disabled: "true" } : {}),
        },
        [surface.downloadLabel]
      )
    );
  } else if (info.url) {
    actions.push(
      el("a", { class: "btn file-action file-action-download", href: info.url, download: name, title: `Скачать: ${name}`, "aria-label": `Скачать: ${name}` }, [
        "Скачать",
      ])
    );
  }

  return actions;
}
