import { renderRichText } from "../../helpers/chat/richText";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { el } from "../../helpers/dom/el";
import { isAudioLikeFile, isImageLikeFile, isPdfLikeFile, isVideoLikeFile } from "../../helpers/files/mediaKind";
import { safeUrl } from "../../helpers/security/safeUrl";
import { renderViewerFooterShell, type ViewerRailItem } from "./viewerFooterShell";

export interface FileViewerMeta {
  authorId?: string | null;
  authorLabel?: string | null;
  authorHandle?: string | null;
  authorKind?: "dm" | "group" | "board";
  timestamp?: number | null;
  rail?: ViewerRailItem[];
}

export interface FileViewerModalActions {
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onJump?: () => void;
  onRecover?: () => void;
  onShare?: () => void;
  onForward?: () => void;
  onDelete?: () => void;
  onOpenAt?: (msgIdx: number) => void;
  canShare?: boolean;
  canForward?: boolean;
  canDelete?: boolean;
}

export interface FileViewerModalOptions {
  autoplay?: boolean;
  posterUrl?: string | null;
  fallbackUrl?: string | null;
}

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

function formatViewerDate(ts?: number | null): string {
  const value = Number(ts ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    const d = new Date(value * 1000);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const date = d.toLocaleDateString(
      "ru-RU",
      sameYear ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" }
    );
    const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`.trim();
  } catch {
    return "";
  }
}

function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img viewer-author-avatar" : "avatar viewer-author-avatar", "aria-hidden": "true" }, [
    url ? "" : avatarMonogram(kind, id),
  ]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

export function renderFileViewerModal(
  url: string,
  name: string,
  size: number,
  mime: string | null | undefined,
  caption: string | null | undefined,
  meta: FileViewerMeta | null | undefined,
  actions: FileViewerModalActions,
  opts?: FileViewerModalOptions | null
): HTMLElement {
  const safeHref = safeUrl(url, { base: window.location.href, allowedProtocols: ["http:", "https:", "blob:"] });
  const titleText = String(name || "файл");
  const captionRaw = caption ? String(caption).trim() : "";
  const captionText = captionRaw && !captionRaw.startsWith("[file]") ? captionRaw : "";
  const isImage = isImageLikeFile(titleText, mime);
  const isVideo = isVideoLikeFile(titleText, mime);
  const isAudio = isAudioLikeFile(titleText, mime);
  const isPdf = isPdfLikeFile(titleText, mime);
  const isVisual = isImage || isVideo;
  const shouldAutoplay = Boolean(isVideo && opts?.autoplay);
  const posterRaw = isVideo ? String(opts?.posterUrl || "").trim() : "";
  const posterUrl = posterRaw ? safeUrl(posterRaw, { base: window.location.href, allowedProtocols: ["http:", "https:", "blob:"] }) : null;
  const fallbackRaw = isImage ? String(opts?.fallbackUrl || "").trim() : "";
  const fallbackUrl = fallbackRaw ? safeUrl(fallbackRaw, { base: window.location.href, allowedProtocols: ["http:", "https:", "blob:"] }) : null;

  const authorId = String(meta?.authorId || "").trim();
  const authorKind = meta?.authorKind || "dm";
  const authorLabel = String(meta?.authorLabel || authorId || "").trim();
  const authorHandleRaw = String(meta?.authorHandle || "").trim();
  const authorHandle = authorHandleRaw && authorLabel && !authorLabel.includes(authorHandleRaw) ? authorHandleRaw : "";
  const authorDate = formatViewerDate(meta?.timestamp);

  const modalClasses = ["modal", "modal-viewer"];
  if (isVisual) modalClasses.push("viewer-visual");
  if (isImage) modalClasses.push("viewer-kind-image");
  if (isVideo) modalClasses.push("viewer-kind-video");
  if (isAudio) modalClasses.push("viewer-kind-audio");
  if (isPdf) modalClasses.push("viewer-kind-pdf");
  if (captionText) modalClasses.push("viewer-has-caption");
  const box = el("div", { class: modalClasses.join(" "), role: "dialog", "aria-modal": "true" });
  if (isVisual) box.setAttribute("data-viewer-fit", "stage");
  if (isVisual) box.setAttribute("data-viewer-load", "idle");
  const setViewerLoadState = (state: "idle" | "loading" | "ready" | "error") => {
    if (isVisual) box.setAttribute("data-viewer-load", state);
  };

  const IMAGE_ZOOM_DEFAULT_SCALE = 2;
  const IMAGE_ZOOM_MAX_SCALE = 4;
  const IMAGE_ZOOM_STEP = 0.5;

  const btnClose = el(
    "button",
    { class: "btn auth-close viewer-action-btn", type: "button", title: "Закрыть", "aria-label": "Закрыть" },
    ["×"]
  );
  btnClose.addEventListener("click", () => actions.onClose());
  const navButtons: HTMLElement[] = [];
  if (actions.onPrev) {
    const btnPrev = el("button", { class: "btn viewer-nav-btn viewer-action-btn", type: "button", "aria-label": "Предыдущее медиа" }, ["←"]);
    btnPrev.addEventListener("click", () => actions.onPrev && actions.onPrev());
    navButtons.push(btnPrev);
  }
  if (actions.onNext) {
    const btnNext = el("button", { class: "btn viewer-nav-btn viewer-action-btn", type: "button", "aria-label": "Следующее медиа" }, ["→"]);
    btnNext.addEventListener("click", () => actions.onNext && actions.onNext());
    navButtons.push(btnNext);
  }
  const headerActions = el("div", { class: "viewer-header-actions" }, [...navButtons]);
  let zoomTarget: HTMLImageElement | null = null;
  let zoomScroll: HTMLElement | null = null;
  let zoomScale = 1;
  let zoomBaseW = 0;
  let zoomBaseH = 0;
  let suppressImageClickUntil = 0;
  let setZoom: ((nextScale: number, focus?: { x: number; y: number } | null) => void) | null = null;
  if (isImage) {
    const zoomBtnOut = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-zoom-btn viewer-zoom-out",
        type: "button",
        title: "Уменьшить",
        "aria-label": "Уменьшить",
      },
      ["−"]
    );
    const zoomBtn = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-zoom-btn viewer-zoom-level",
        type: "button",
        title: "Увеличить",
        "aria-label": "Увеличить",
      },
      ["Вписано"]
    );
    const zoomBtnIn = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-zoom-btn viewer-zoom-in",
        type: "button",
        title: "Увеличить",
        "aria-label": "Увеличить",
      },
      ["+"]
    );

    const clampZoom = (raw: number): number => {
      const v = Number(raw ?? 1);
      if (!Number.isFinite(v)) return 1;
      const rounded = Math.round((Math.max(1, Math.min(IMAGE_ZOOM_MAX_SCALE, v)) / IMAGE_ZOOM_STEP)) * IMAGE_ZOOM_STEP;
      return Math.max(1, Math.min(IMAGE_ZOOM_MAX_SCALE, rounded));
    };
    const zoomLabel = (scale: number): string => `${Math.round(scale * 100)}%`;

    const updateZoomUi = () => {
      const zoomed = zoomScale > 1;
      box.classList.toggle("viewer-zoomed", zoomed);
      zoomBtn.textContent = zoomed ? zoomLabel(zoomScale) : "Вписано";
      zoomBtn.title = zoomed ? "Сбросить масштаб" : "Увеличить";
      zoomBtn.setAttribute("aria-label", zoomed ? "Сбросить масштаб" : "Увеличить");
      (zoomBtnOut as HTMLButtonElement).disabled = zoomScale <= 1;
      (zoomBtnIn as HTMLButtonElement).disabled = zoomScale >= IMAGE_ZOOM_MAX_SCALE;
    };

    const doSetZoom = (nextScale: number, focus?: { x: number; y: number } | null) => {
      const img = zoomTarget;
      const scroll = zoomScroll;
      if (!img || !scroll) return;
      const next = clampZoom(nextScale);
      const prevScale = zoomScale;
      const prevZoomed = prevScale > 1;
      const nextZoomed = next > 1;
      if (!nextZoomed) {
        zoomScale = 1;
        updateZoomUi();
        img.style.removeProperty("width");
        img.style.removeProperty("height");
        img.style.removeProperty("max-width");
        img.style.removeProperty("max-height");
        img.style.removeProperty("object-fit");
        zoomBaseW = 0;
        zoomBaseH = 0;
        try {
          scroll.scrollLeft = 0;
          scroll.scrollTop = 0;
        } catch {
          // ignore
        }
        return;
      }

      let baseW = zoomBaseW;
      let baseH = zoomBaseH;
      if (!prevZoomed || !baseW || !baseH) {
        const rect = img.getBoundingClientRect();
        baseW = rect.width > 0 ? rect.width : 0;
        baseH = rect.height > 0 ? rect.height : 0;
      }
      if (!baseW || !baseH) return;

      const cw = scroll.clientWidth || 0;
      const ch = scroll.clientHeight || 0;
      const baseFocus = (() => {
        if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.y)) {
          const x = Math.max(0, Math.min(baseW, focus.x));
          const y = Math.max(0, Math.min(baseH, focus.y));
          return { x, y };
        }
        if (prevZoomed) {
          const x = Math.max(0, (scroll.scrollLeft + cw * 0.5) / Math.max(1, prevScale));
          const y = Math.max(0, (scroll.scrollTop + ch * 0.5) / Math.max(1, prevScale));
          return { x: Math.min(baseW, x), y: Math.min(baseH, y) };
        }
        return { x: baseW * 0.5, y: baseH * 0.5 };
      })();

      zoomBaseW = baseW;
      zoomBaseH = baseH;
      zoomScale = next;
      updateZoomUi();
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
      img.style.objectFit = "contain";
      img.style.width = `${Math.max(1, Math.round(baseW * zoomScale))}px`;
      img.style.height = `${Math.max(1, Math.round(baseH * zoomScale))}px`;

      window.requestAnimationFrame(() => {
        try {
          const cw2 = scroll.clientWidth || 0;
          const ch2 = scroll.clientHeight || 0;
          scroll.scrollLeft = Math.max(0, Math.round(baseFocus.x * zoomScale - cw2 * 0.5));
          scroll.scrollTop = Math.max(0, Math.round(baseFocus.y * zoomScale - ch2 * 0.5));
        } catch {
          // ignore
        }
      });
    };

    setZoom = doSetZoom;

    zoomBtnOut.addEventListener("click", () => doSetZoom(zoomScale - IMAGE_ZOOM_STEP, null));
    zoomBtnIn.addEventListener("click", () => doSetZoom(zoomScale + IMAGE_ZOOM_STEP, null));
    zoomBtn.addEventListener("click", () => doSetZoom(zoomScale > 1 ? 1 : IMAGE_ZOOM_DEFAULT_SCALE, null));

    headerActions.append(zoomBtnOut, zoomBtn, zoomBtnIn);
    updateZoomUi();
  }
  if (actions.onJump) {
    const btnJump = el(
      "button",
      { class: "btn viewer-action-btn viewer-jump-btn", type: "button", title: "Перейти к сообщению", "aria-label": "Перейти к сообщению" },
      ["↩"]
    );
    btnJump.addEventListener("click", () => actions.onJump && actions.onJump());
    headerActions.append(btnJump);
  }
  if (actions.onForward) {
    const btnForward = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-forward-btn",
        type: "button",
        title: "Переслать",
        "aria-label": "Переслать",
      },
      ["↪"]
    ) as HTMLButtonElement;
    btnForward.disabled = actions.canForward === false;
    btnForward.addEventListener("click", () => actions.onForward && actions.onForward());
    headerActions.append(btnForward);
  }
  if (actions.onDelete) {
    const btnDelete = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-delete-btn",
        type: "button",
        title: "Удалить",
        "aria-label": "Удалить",
      },
      ["🗑️"]
    ) as HTMLButtonElement;
    btnDelete.disabled = actions.canDelete === false;
    btnDelete.addEventListener("click", () => actions.onDelete && actions.onDelete());
    headerActions.append(btnDelete);
  }
  if (actions.onShare) {
    const btnShare = el(
      "button",
      {
        class: "btn viewer-action-btn viewer-share-btn",
        type: "button",
        title: "Поделиться",
        "aria-label": "Поделиться",
      },
      ["⤴"]
    ) as HTMLButtonElement;
    btnShare.disabled = actions.canShare === false;
    btnShare.addEventListener("click", () => actions.onShare && actions.onShare());
    headerActions.append(btnShare);
  }
  if (safeHref) {
    const btnDownload = el(
      "a",
      { class: "btn viewer-action-btn viewer-download-btn", href: safeHref, download: titleText, title: "Скачать", "aria-label": "Скачать" },
      ["↓"]
    );
    headerActions.append(btnDownload);
  }
  headerActions.append(btnClose);

  let authorNode: HTMLElement | null = null;
  if (authorLabel || authorDate) {
    const textNodes: HTMLElement[] = [];
    const titleNodes = [el("span", { class: "viewer-author-name" }, [authorLabel || "—"])];
    if (authorHandle) titleNodes.push(el("span", { class: "viewer-author-handle" }, [authorHandle]));
    textNodes.push(el("div", { class: "viewer-author-title" }, titleNodes));
    if (authorDate) textNodes.push(el("div", { class: "viewer-author-date" }, [authorDate]));
    const textWrap = el("div", { class: "viewer-author-text" }, textNodes);
    const children: HTMLElement[] = [];
    if (authorId) children.push(avatar(authorKind, authorId));
    children.push(textWrap);
    if (authorId) {
      authorNode = el(
        "button",
        { class: "viewer-author", type: "button", "data-action": "user-open", "data-user-id": authorId, title: `Профиль: ${authorLabel || authorId}` },
        children
      );
    } else {
      authorNode = el("div", { class: "viewer-author" }, children);
    }
  }

  const showFileMeta = !isVisual || !authorNode;
  const sizeLabel = Number(size) > 0 ? formatBytes(Number(size) || 0) : "";
  const fileMeta = showFileMeta
    ? el(
        "div",
        { class: "viewer-title-wrap" },
        [el("div", { class: "viewer-title", title: titleText }, [titleText])].concat(
          sizeLabel ? [el("div", { class: "viewer-sub" }, [sizeLabel])] : []
        )
      )
    : null;
  const headerInfoItems = [authorNode, fileMeta].filter((node): node is HTMLElement => Boolean(node));

  const header = el("div", { class: "viewer-header" }, [
    el("div", { class: "viewer-header-info" }, headerInfoItems),
    headerActions,
  ]);

  let body: HTMLElement;
  if (!safeHref) {
    body = el("div", { class: "viewer-empty" }, ["Не удалось открыть файл: небезопасный URL"]);
  } else if (isImage) {
    // Important: do not set `src` before wiring listeners — cached images may fire `load` early,
    // leaving the preloader stuck (notably when navigating with ArrowLeft/ArrowRight).
    const img = el("img", { class: "viewer-img", alt: titleText, decoding: "async" }) as HTMLImageElement;
    zoomTarget = img;
    const scroll = el("div", { class: "viewer-img-scroll" }, [img]);
    zoomScroll = scroll;
    const preloaderText = el("div", { class: "viewer-preloader-text" }, ["Загрузка…"]);
    const preloaderRetryBtn = actions.onRecover
      ? (el("button", { class: "btn viewer-preloader-retry", type: "button" }, ["Попробовать ещё раз"]) as HTMLButtonElement)
      : null;
    if (preloaderRetryBtn) {
      preloaderRetryBtn.addEventListener("click", () => actions.onRecover && actions.onRecover());
    }
    const preloaderActions = preloaderRetryBtn ? el("div", { class: "viewer-preloader-actions" }, [preloaderRetryBtn]) : null;
    const preloader = el("div", { class: "viewer-preloader", "aria-live": "polite" }, [
      el("div", { class: "viewer-preloader-spinner", "aria-hidden": "true" }, [""]),
      preloaderText,
      ...(preloaderActions ? [preloaderActions] : []),
    ]);
    let panActive = false;
    let panMoved = false;
    let pinchActive = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartLeft = 0;
    let panStartTop = 0;
    let panPointerId: number | null = null;
    const touchPoints = new Map<number, { x: number; y: number }>();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    const SWIPE_MIN_PX = 55;
    let swipeActive = false;
    let swipePointerId: number | null = null;
    let swipeStartX = 0;
    let swipeStartY = 0;
    const resetSwipe = () => {
      swipeActive = false;
      swipePointerId = null;
      swipeStartX = 0;
      swipeStartY = 0;
    };
    img.addEventListener("click", (event) => {
      if (Date.now() < suppressImageClickUntil) return;
      if (event.detail > 1) return;
      if (!setZoom) return;
      event.preventDefault();
      event.stopPropagation();
      if (zoomScale > 1) {
        setZoom(1, null);
        return;
      }
      const rect = img.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      setZoom(IMAGE_ZOOM_DEFAULT_SCALE, { x, y });
    });
    scroll.addEventListener("pointerdown", (e) => {
      const ev = e as PointerEvent;
      const pt = ev.pointerType;
      const isMouse = pt === "mouse";
      const isTouch = pt === "touch";
      const isPen = pt === "pen";
      if (!isMouse && !isTouch && !isPen) return;
      if (isMouse && !box.classList.contains("viewer-zoomed")) return;
      if (isMouse && ev.button !== 0) return;
      if (!isTouch && !isPen) resetSwipe();
      if (isTouch || isPen) {
        touchPoints.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (touchPoints.size >= 2) {
          resetSwipe();
          pinchActive = true;
          panActive = false;
          panPointerId = null;
          const pts = Array.from(touchPoints.values()).slice(0, 2);
          const dx = pts[0].x - pts[1].x;
          const dy = pts[0].y - pts[1].y;
          pinchStartDist = Math.hypot(dx, dy);
          pinchStartScale = zoomScale;
        } else if (box.classList.contains("viewer-zoomed")) {
          resetSwipe();
          pinchActive = false;
          panActive = true;
          panPointerId = ev.pointerId;
          panMoved = false;
          panStartX = ev.clientX;
          panStartY = ev.clientY;
          panStartLeft = scroll.scrollLeft;
          panStartTop = scroll.scrollTop;
        } else {
          pinchActive = false;
          panActive = false;
          panPointerId = null;
          const canSwipe = Boolean(actions.onPrev || actions.onNext);
          if (canSwipe) {
            swipeActive = true;
            swipePointerId = ev.pointerId;
            swipeStartX = ev.clientX;
            swipeStartY = ev.clientY;
          } else {
            resetSwipe();
          }
        }
      } else {
        resetSwipe();
        pinchActive = false;
        panActive = true;
        panPointerId = ev.pointerId;
        panMoved = false;
        panStartX = ev.clientX;
        panStartY = ev.clientY;
        panStartLeft = scroll.scrollLeft;
        panStartTop = scroll.scrollTop;
      }
      if (panActive || pinchActive) scroll.classList.add("viewer-panning");
      try {
        scroll.setPointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
      if (panActive || pinchActive) e.preventDefault();
    });
    scroll.addEventListener("pointermove", (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerType === "touch" || ev.pointerType === "pen") {
        if (touchPoints.has(ev.pointerId)) touchPoints.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pinchActive && touchPoints.size >= 2 && setZoom) {
          const pts = Array.from(touchPoints.values()).slice(0, 2);
          const dx = pts[0].x - pts[1].x;
          const dy = pts[0].y - pts[1].y;
          const dist = Math.hypot(dx, dy);
          if (pinchStartDist > 0 && dist > 0) {
            const mx = (pts[0].x + pts[1].x) * 0.5;
            const my = (pts[0].y + pts[1].y) * 0.5;
            const rect = img.getBoundingClientRect();
            const relX = mx - rect.left;
            const relY = my - rect.top;
            const baseX = relX / Math.max(1, zoomScale);
            const baseY = relY / Math.max(1, zoomScale);
            const nextScale = pinchStartScale * (dist / pinchStartDist);
            setZoom(nextScale, { x: baseX, y: baseY });
            suppressImageClickUntil = Date.now() + 500;
          }
          e.preventDefault();
          return;
        }
      }
      if (swipeActive && !pinchActive && !box.classList.contains("viewer-zoomed") && swipePointerId === ev.pointerId) {
        const dx = ev.clientX - swipeStartX;
        const dy = ev.clientY - swipeStartY;
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.1) {
          suppressImageClickUntil = Date.now() + 650;
          e.preventDefault();
        }
      }
      if (!panActive) return;
      if (panPointerId !== null && ev.pointerId !== panPointerId) return;
      const dx = ev.clientX - panStartX;
      const dy = ev.clientY - panStartY;
      if (!panMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) panMoved = true;
      try {
        scroll.scrollLeft = Math.max(0, Math.round(panStartLeft - dx));
        scroll.scrollTop = Math.max(0, Math.round(panStartTop - dy));
      } catch {
        // ignore
      }
      if (panMoved) e.preventDefault();
    });
    const stopPan = (e?: Event) => {
      if (!panActive && !pinchActive && !touchPoints.size) return;
      const wasPinch = pinchActive;
      const now = Date.now();
      const isTouchLike =
        Boolean(e) && (((e as PointerEvent).pointerType === "touch") || ((e as PointerEvent).pointerType === "pen"));
      const swipeEvent = isTouchLike ? (e as PointerEvent) : null;
      const canSwipeNow =
        Boolean(swipeEvent) &&
        swipeActive &&
        !pinchActive &&
        !box.classList.contains("viewer-zoomed") &&
        swipePointerId !== null &&
        swipeEvent?.pointerId === swipePointerId;
      const swipeDx = canSwipeNow && swipeEvent ? swipeEvent.clientX - swipeStartX : 0;
      const swipeDy = canSwipeNow && swipeEvent ? swipeEvent.clientY - swipeStartY : 0;
      if (e && ((e as PointerEvent).pointerType === "touch" || (e as PointerEvent).pointerType === "pen")) {
        const ev = e as PointerEvent;
        touchPoints.delete(ev.pointerId);
      }
      if (pinchActive && touchPoints.size >= 2) {
        if (e) e.preventDefault();
        return;
      }
      pinchActive = false;
      pinchStartDist = 0;
      pinchStartScale = zoomScale;
      if (wasPinch && touchPoints.size === 1 && box.classList.contains("viewer-zoomed")) {
        const [id, pt] = Array.from(touchPoints.entries())[0];
        resetSwipe();
        panActive = true;
        panPointerId = id;
        panMoved = false;
        panStartX = pt.x;
        panStartY = pt.y;
        panStartLeft = scroll.scrollLeft;
        panStartTop = scroll.scrollTop;
        scroll.classList.add("viewer-panning");
        if (e) e.preventDefault();
        return;
      }
      panActive = false;
      panPointerId = null;
      scroll.classList.remove("viewer-panning");
      if (canSwipeNow) {
        const absDx = Math.abs(swipeDx);
        const absDy = Math.abs(swipeDy);
        if (absDx >= SWIPE_MIN_PX && absDx >= absDy * 1.2) {
          if (swipeDx < 0) actions.onNext?.();
          else actions.onPrev?.();
          suppressImageClickUntil = now + 650;
        }
      }
      resetSwipe();
      if (panMoved) suppressImageClickUntil = now + 400;
      if (e) e.preventDefault();
    };
    scroll.addEventListener("pointerup", (e) => stopPan(e));
    scroll.addEventListener("pointercancel", (e) => stopPan(e));
    const resetImageViewport = () => {
      if (zoomScale > 1) return;
      img.style.removeProperty("width");
      img.style.removeProperty("height");
      img.style.removeProperty("max-width");
      img.style.removeProperty("max-height");
      img.style.removeProperty("object-fit");
      zoomBaseW = 0;
      zoomBaseH = 0;
      try {
        scroll.scrollLeft = 0;
        scroll.scrollTop = 0;
      } catch {
        // ignore
      }
      window.requestAnimationFrame(() => {
        try {
          if (zoomScale > 1) return;
          img.style.removeProperty("width");
          img.style.removeProperty("height");
          img.style.removeProperty("max-width");
          img.style.removeProperty("max-height");
          img.style.removeProperty("object-fit");
          scroll.scrollLeft = 0;
          scroll.scrollTop = 0;
        } catch {
          // ignore
        }
      });
    };
    const primaryUrl = safeHref;
    const initialFallbackUrl = fallbackUrl && fallbackUrl !== primaryUrl ? fallbackUrl : "";
    let preloaderSettled = false;
    let fallbackTried = Boolean(initialFallbackUrl);
    let displayingFallback = Boolean(initialFallbackUrl);
    let primaryPreloadStarted = false;
    let preloaderStallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearPreloaderStallTimer = () => {
      if (preloaderStallTimer === null) return;
      clearTimeout(preloaderStallTimer);
      preloaderStallTimer = null;
    };
    const armPreloaderStallTimer = () => {
      clearPreloaderStallTimer();
      preloaderStallTimer = setTimeout(() => {
        if (preloaderSettled) return;
        onFailed();
      }, 8_000);
      (preloaderStallTimer as any)?.unref?.();
    };
    const tryFallbackImage = (): boolean => {
      if (!fallbackUrl || fallbackTried) return false;
      const current = String(img.currentSrc || img.src || "").trim();
      if (current && current === fallbackUrl) return false;
      fallbackTried = true;
      setViewerLoadState("loading");
      preloader.classList.remove("viewer-preloader-failed");
      preloaderText.textContent = "Показываем превью…";
      armPreloaderStallTimer();
      img.src = fallbackUrl;
      if (actions.onRecover) {
        try {
          actions.onRecover();
        } catch {
          // ignore
        }
      }
      return true;
    };
    const preloadPrimaryImage = () => {
      if (!initialFallbackUrl || primaryPreloadStarted) return;
      primaryPreloadStarted = true;
      const ImageCtor = (globalThis as any).Image;
      if (typeof ImageCtor !== "function") return;
      try {
        const preload = new ImageCtor();
        const applyPrimary = () => {
          const apply = () => {
            displayingFallback = false;
            img.src = primaryUrl;
          };
          try {
            const decoded = typeof preload.decode === "function" ? preload.decode() : null;
            if (decoded && typeof decoded.then === "function") {
              void decoded.then(apply, apply);
              return;
            }
          } catch {
            // ignore and swap after onload
          }
          apply();
        };
        preload.onload = applyPrimary;
        preload.onerror = () => {
          if (actions.onRecover) {
            try {
              actions.onRecover();
            } catch {
              // ignore
            }
          }
        };
        preload.src = primaryUrl;
      } catch {
        // ignore
      }
    };
    const onLoaded = () => {
      if (preloaderSettled && !displayingFallback) return;
      if (!img.naturalWidth) {
        onFailed();
        return;
      }
      preloaderSettled = true;
      clearPreloaderStallTimer();
      setViewerLoadState("ready");
      resetImageViewport();
      img.classList.add("viewer-img-loaded");
      preloader.classList.add("hidden");
      if (displayingFallback) preloadPrimaryImage();
    };
    const onFailed = () => {
      if (preloaderSettled) return;
      if (displayingFallback) {
        displayingFallback = false;
        setViewerLoadState("loading");
        preloader.classList.remove("viewer-preloader-failed");
        preloaderText.textContent = "Загрузка…";
        armPreloaderStallTimer();
        img.src = primaryUrl;
        return;
      }
      if (tryFallbackImage()) return;
      preloaderSettled = true;
      clearPreloaderStallTimer();
      setViewerLoadState("error");
      preloader.classList.add("viewer-preloader-failed");
      const canRecover = Boolean(actions.onRecover);
      preloaderText.textContent = canRecover ? "Не удалось загрузить. Пробуем восстановить…" : "Не удалось загрузить";
      if (actions.onRecover) {
        try {
          actions.onRecover();
        } catch {
          // ignore
        }
      }
    };
    img.addEventListener("load", onLoaded);
    img.addEventListener("error", onFailed);
    setViewerLoadState("loading");
    armPreloaderStallTimer();
    if (initialFallbackUrl) preloaderText.textContent = "Показываем превью…";
    img.src = initialFallbackUrl || primaryUrl;
    if (img.complete) {
      if (img.naturalWidth > 0) onLoaded();
      else onFailed();
    }
    body = el("div", { class: "viewer-media viewer-media-image" }, [scroll, preloader]);
  } else if (isVideo) {
    const video = el("video", {
      class: "viewer-video",
      src: safeHref,
      controls: "true",
      playsinline: "true",
      preload: shouldAutoplay ? "auto" : "metadata",
      ...(posterUrl ? { poster: posterUrl } : {}),
      ...(shouldAutoplay ? { autoplay: "true" } : {}),
      "data-allow-audio": "1",
    }) as HTMLVideoElement;
    const preloaderText = el("div", { class: "viewer-preloader-text" }, ["Загрузка видео…"]);
    const preloaderRetryBtn = actions.onRecover
      ? (el("button", { class: "btn viewer-preloader-retry", type: "button" }, ["Попробовать ещё раз"]) as HTMLButtonElement)
      : null;
    if (preloaderRetryBtn) {
      preloaderRetryBtn.addEventListener("click", () => actions.onRecover && actions.onRecover());
    }
    const preloaderActions = preloaderRetryBtn ? el("div", { class: "viewer-preloader-actions" }, [preloaderRetryBtn]) : null;
    const preloader = el("div", { class: "viewer-preloader viewer-video-preloader", "aria-live": "polite", "aria-busy": "true" }, [
      el("div", { class: "viewer-preloader-spinner", "aria-hidden": "true" }, [""]),
      preloaderText,
      ...(preloaderActions ? [preloaderActions] : []),
    ]);
    let videoFailed = false;
    let preloaderStallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearPreloaderStallTimer = () => {
      if (preloaderStallTimer === null) return;
      clearTimeout(preloaderStallTimer);
      preloaderStallTimer = null;
    };
    const failVideoLoad = () => {
      if (videoFailed) return;
      videoFailed = true;
      clearPreloaderStallTimer();
      setViewerLoadState("error");
      preloader.classList.remove("hidden");
      preloader.classList.add("viewer-preloader-failed");
      preloader.setAttribute("aria-busy", "false");
      const canRecover = Boolean(actions.onRecover);
      preloaderText.textContent = canRecover ? "Не удалось загрузить видео. Пробуем восстановить…" : "Не удалось загрузить видео";
      if (actions.onRecover) {
        try {
          actions.onRecover();
        } catch {
          // ignore
        }
      }
    };
    const armPreloaderStallTimer = () => {
      clearPreloaderStallTimer();
      preloaderStallTimer = setTimeout(failVideoLoad, 8_000);
      (preloaderStallTimer as any)?.unref?.();
    };
    const showVideoLoading = (message = "Загрузка видео…") => {
      if (videoFailed) return;
      setViewerLoadState("loading");
      preloader.classList.remove("hidden");
      preloader.classList.remove("viewer-preloader-failed");
      preloader.setAttribute("aria-busy", "true");
      preloaderText.textContent = message;
      armPreloaderStallTimer();
    };
    const markVideoReady = () => {
      if (videoFailed) return;
      clearPreloaderStallTimer();
      setViewerLoadState("ready");
      preloader.classList.add("hidden");
      preloader.setAttribute("aria-busy", "false");
    };
    showVideoLoading();
    video.addEventListener("loadedmetadata", () => {
      if (videoFailed) return;
      if (shouldAutoplay) {
        preloaderText.textContent = "Подготовка видео…";
        return;
      }
      markVideoReady();
    });
    video.addEventListener("loadeddata", markVideoReady, { once: true });
    video.addEventListener("canplay", markVideoReady, { once: true });
    video.addEventListener("playing", markVideoReady, { once: true });
    video.addEventListener("waiting", () => showVideoLoading("Буферизация видео…"));
    video.addEventListener("stalled", () => showVideoLoading("Видео не отвечает. Пробуем восстановить…"));
    if (video.readyState >= 2) markVideoReady();
    if (shouldAutoplay) {
      const attemptPlay = (muted: boolean) => {
        try {
          video.muted = muted;
          if (muted) {
            video.defaultMuted = true;
            video.setAttribute("muted", "true");
          } else {
            video.defaultMuted = false;
            video.removeAttribute("muted");
          }
          const p = video.play();
          if (p && typeof (p as Promise<void>).catch === "function") {
            void (p as Promise<void>).catch(() => {
              if (!muted) attemptPlay(true);
            });
          }
        } catch {
          if (!muted) attemptPlay(true);
        }
      };
      attemptPlay(false);
    }
    video.addEventListener("error", failVideoLoad, { once: true });
    body = el("div", { class: "viewer-media viewer-media-video" }, [video, preloader]);
  } else if (isAudio) {
    const audio = el("audio", { class: "viewer-audio", src: safeHref, controls: "true", preload: "metadata" }) as HTMLAudioElement;
    body = el("div", { class: "viewer-media viewer-media-audio" }, [audio]);
  } else if (isPdf) {
    const frame = el("iframe", { class: "viewer-pdf-frame", src: safeHref, title: titleText }) as HTMLIFrameElement;
    const fallback = el("div", { class: "viewer-pdf-fallback" }, [
      el("div", { class: "viewer-pdf-icon", "aria-hidden": "true" }, ["PDF"]),
      el("div", { class: "viewer-pdf-copy" }, ["Если PDF не открылся в браузере, скачайте файл ниже."]),
    ]);
    body = el("div", { class: "viewer-media viewer-media-pdf" }, [frame, fallback]);
  } else {
    body = el("div", { class: "viewer-file" }, [
      el("div", { class: "viewer-file-icon", "aria-hidden": "true" }, ["FILE"]),
      el("div", { class: "viewer-file-name" }, [titleText]),
    ]);
  }

  const actionsRow = el("div", { class: "modal-actions viewer-actions" });
  const btnCloseBottom = el("button", { class: "btn", type: "button" }, ["Закрыть"]);
  btnCloseBottom.addEventListener("click", () => actions.onClose());

  if (safeHref) {
    const btnDownload = el("a", { class: "btn btn-primary", href: safeHref, download: titleText }, ["Скачать"]);
    actionsRow.append(btnDownload, btnCloseBottom);
  } else {
    actionsRow.append(btnCloseBottom);
  }

  const stage = el("div", { class: "viewer-stage" }, [body]);
  const railItems = (meta?.rail || []).filter((x) => x && Number.isFinite(x.msgIdx) && (x.kind === "image" || x.kind === "video"));
  const footerShell = isVisual ? renderViewerFooterShell({ captionText, railItems, onOpenAt: actions.onOpenAt }) : null;
  if (isVisual && railItems.length > 1) {
    box.classList.add("viewer-has-rail");
  }
  if (isVisual) {
    if (actions.onPrev) {
      const btnPrev = el(
        "button",
        { class: "btn viewer-switcher-btn viewer-switcher-btn-prev", type: "button", "aria-label": "Предыдущее медиа", title: "Предыдущее медиа" },
        ["←"]
      );
      btnPrev.addEventListener("click", () => actions.onPrev && actions.onPrev());
      stage.append(el("div", { class: "viewer-switcher viewer-switcher-prev" }, [btnPrev]));
    }
    if (actions.onNext) {
      const btnNext = el(
        "button",
        { class: "btn viewer-switcher-btn viewer-switcher-btn-next", type: "button", "aria-label": "Следующее медиа", title: "Следующее медиа" },
        ["→"]
      );
      btnNext.addEventListener("click", () => actions.onNext && actions.onNext());
      stage.append(el("div", { class: "viewer-switcher viewer-switcher-next" }, [btnNext]));
    }
  }
  const captionNode = !isVisual && captionText
    ? el("div", { class: "viewer-caption" }, [el("div", { class: "viewer-caption-body" }, renderRichText(captionText))])
    : null;

  const nodes: HTMLElement[] = [header, stage];
  if (footerShell) nodes.push(footerShell);
  if (captionNode) nodes.push(captionNode);
  if (!isVisual) nodes.push(actionsRow);
  box.append(...nodes);

  return box;
}
