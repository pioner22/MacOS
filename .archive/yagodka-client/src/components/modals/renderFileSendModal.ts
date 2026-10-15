import { el } from "../../helpers/dom/el";
import { fileBadge } from "../../helpers/files/fileBadge";

function formatBytes(size: number): string {
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

function totalSize(files: File[]): number {
  return files.reduce((acc, f) => acc + (Number(f?.size || 0) || 0), 0);
}

function isVideoNoteName(name: string): boolean {
  const n = String(name || "").trim().toLowerCase();
  return n.startsWith("video_note") || n.startsWith("video-note") || n.includes("_video_note") || n.includes("video-note");
}

export function renderFileSendModal(
  files: File[],
  caption: string,
  opts: { previewUrls?: Array<string | null>; captionDisabled?: boolean; captionHint?: string } = {},
  actions: { onSend: (captionText: string) => void; onCancel: () => void }
): HTMLElement {
  const previewUrls = Array.isArray(opts.previewUrls) ? opts.previewUrls : [];
  const captionDisabled = Boolean(opts.captionDisabled);
  const captionHint = String(opts.captionHint || "").trim();

  const titleText = files.length > 1 ? `Отправить файлы (${files.length})` : "Отправить файл";
  const title = el("div", { class: "modal-title" }, [titleText]);

  const previewArea = (() => {
    if (files.length <= 1) {
      const file = files[0];
      const url = previewUrls[0] || null;
      if (file && url) {
        const badge = fileBadge(file?.name || "file", file?.type || null);
        if (badge.kind === "video") {
          const videoCls = isVideoNoteName(file?.name || "") ? "file-send-video file-send-video-note" : "file-send-video";
          return el("div", { class: "file-send-preview" }, [
            el("video", {
              class: videoCls,
              src: url,
              controls: "true",
              preload: "metadata",
              playsinline: "true",
              muted: "true",
            }) as HTMLVideoElement,
          ]);
        }
        if (badge.kind === "audio") {
          return el("div", { class: "file-send-preview" }, [
            el("audio", { class: "file-send-audio", src: url, controls: "true", preload: "metadata" }) as HTMLAudioElement,
          ]);
        }
        return el("div", { class: "file-send-preview" }, [
          el("img", { class: "file-send-image", src: url, alt: String(file.name || "Файл") }),
        ]);
      }
      const badge = fileBadge(file?.name || "file", file?.type || null);
      const badgeEl = el("div", { class: "file-send-badge", style: `--badge-hue: ${badge.hue}` }, [badge.label]);
      return el("div", { class: "file-send-preview file-send-preview-empty" }, [badgeEl]);
    }
    const gridItems = files.map((file, idx) => {
      const url = previewUrls[idx] || null;
      if (url) {
        const badge = fileBadge(file?.name || "file", file?.type || null);
        if (badge.kind === "video") {
          return el("div", { class: "file-send-thumb" }, [
            el("video", { src: url, preload: "metadata", playsinline: "true", muted: "true" }) as HTMLVideoElement,
          ]);
        }
        return el("div", { class: "file-send-thumb" }, [el("img", { src: url, alt: String(file?.name || "Файл") })]);
      }
      const badge = fileBadge(file?.name || "file", file?.type || null);
      return el("div", { class: "file-send-thumb file-send-thumb-empty" }, [
        el("div", { class: "file-send-badge", style: `--badge-hue: ${badge.hue}` }, [badge.label]),
      ]);
    });
    return el("div", { class: "file-send-grid" }, gridItems);
  })();

  const meta = (() => {
    if (files.length <= 1) {
      const file = files[0];
      if (!file) return el("div", { class: "file-send-meta" }, []);
      return el("div", { class: "file-send-meta" }, [
        el("div", { class: "file-send-name" }, [String(file.name || "Файл")]),
        el("div", { class: "file-send-size" }, [formatBytes(Number(file.size || 0) || 0)]),
      ]);
    }
    const size = totalSize(files);
    return el("div", { class: "file-send-meta" }, [
      el("div", { class: "file-send-name" }, [`Файлов: ${files.length}`]),
      el("div", { class: "file-send-size" }, [`Общий размер: ${formatBytes(size)}`]),
    ]);
  })();

  const captionLabel = el("label", { class: "modal-label", for: "file-send-caption" }, ["Описание"]);
  const captionInput = el("textarea", {
    class: "modal-input file-send-caption",
    id: "file-send-caption",
    rows: "3",
    placeholder: "Добавить описание…",
    disabled: captionDisabled ? "true" : undefined,
  }) as HTMLTextAreaElement;
  captionInput.value = String(caption || "");

  const hintText = captionDisabled
    ? captionHint || "Подпись недоступна"
    : files.length > 1
      ? "Подпись появится под альбомом в истории чата"
      : "Подпись появится под файлом в истории чата";
  const captionHintEl = el("div", { class: "file-send-hint" }, [hintText]);

  const btnSend = el("button", { class: "btn btn-primary", type: "button" }, ["Отправить"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);
  const actionsRow = el("div", { class: "modal-actions" }, [btnSend, btnCancel]);

  const box = el("div", { class: "modal modal-file-send" }, [
    title,
    previewArea,
    meta,
    captionLabel,
    captionInput,
    captionHintEl,
    actionsRow,
  ]);

  const send = () => {
    if (captionInput.disabled) {
      actions.onSend("");
      return;
    }
    actions.onSend(String(captionInput.value || "").trimEnd());
  };

  btnSend.addEventListener("click", () => send());
  btnCancel.addEventListener("click", () => actions.onCancel());
  captionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });

  return box;
}
