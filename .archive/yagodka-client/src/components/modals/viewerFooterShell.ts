import { renderRichText } from "../../helpers/chat/richText";
import { el } from "../../helpers/dom/el";

export interface ViewerRailItem {
  msgIdx: number;
  name: string;
  kind: "image" | "video";
  thumbUrl: string | null;
  active?: boolean;
}

export interface ViewerFooterShellOptions {
  captionText?: string | null;
  railItems?: ViewerRailItem[] | null;
  onOpenAt?: ((msgIdx: number) => void) | null;
}

function buildViewerCounterLabel(railItems: ViewerRailItem[]): string {
  const activeIndex = railItems.findIndex((item) => item && item.active);
  if (activeIndex < 0 || railItems.length <= 1) return "";
  const activeItem = railItems[activeIndex];
  const kindLabel = activeItem?.kind === "video" ? "Видео" : "Фото";
  return `${kindLabel} ${activeIndex + 1} из ${railItems.length}`;
}

export function renderViewerFooterShell(opts?: ViewerFooterShellOptions | null): HTMLElement | null {
  const captionText = String(opts?.captionText || "").trim();
  const railItems = Array.isArray(opts?.railItems)
    ? opts!.railItems.filter(
        (item): item is ViewerRailItem => Boolean(item) && Number.isFinite(item.msgIdx) && (item.kind === "image" || item.kind === "video")
      )
    : [];
  const hasCaption = Boolean(captionText);
  const hasRail = railItems.length > 1;
  if (!hasCaption && !hasRail) return null;

  const classes = ["viewer-footer-shell"];
  if (hasCaption) classes.push("viewer-footer-shell-has-caption");
  if (hasRail) classes.push("viewer-footer-shell-has-rail");

  const content: HTMLElement[] = [];
  if (hasCaption || hasRail) {
    const mainChildren: HTMLElement[] = [];
    const counterLabel = buildViewerCounterLabel(railItems);
    if (counterLabel) {
      mainChildren.push(el("div", { class: "viewer-footer-context" }, [el("span", { class: "viewer-footer-counter" }, [counterLabel])]));
    }
    if (hasCaption) {
      mainChildren.push(el("div", { class: "viewer-caption" }, [el("div", { class: "viewer-caption-body" }, renderRichText(captionText))]));
    }
    if (mainChildren.length) content.push(el("div", { class: "viewer-footer-main" }, mainChildren));
  }

  if (hasRail) {
    const railButtons = railItems.map((item) => {
      const classes = ["viewer-rail-item"];
      if (item.active) classes.push("active");
      if (item.kind === "video") classes.push("viewer-rail-item-video");
      const btn = el(
        "button",
        {
          class: classes.join(" "),
          type: "button",
          title: item.name,
          "aria-label": `Открыть: ${item.name}`,
        },
        [
          item.thumbUrl
            ? el("img", { class: "viewer-rail-thumb", src: item.thumbUrl, alt: "", loading: "lazy", decoding: "async" })
            : el("div", { class: "viewer-rail-thumb viewer-rail-thumb-empty", "aria-hidden": "true" }, [item.kind === "video" ? "Видео" : "Фото"]),
          item.kind === "video" ? el("div", { class: "viewer-rail-video-badge", "aria-hidden": "true" }, ["▶"]) : "",
        ]
      ) as HTMLButtonElement;
      btn.disabled = Boolean(item.active || !opts?.onOpenAt);
      btn.addEventListener("click", () => {
        if (item.active || !opts?.onOpenAt) return;
        opts.onOpenAt(item.msgIdx);
      });
      return btn;
    });
    content.push(el("div", { class: "viewer-rail" }, railButtons));
  }

  return el("div", { class: classes.join(" ") }, content);
}
