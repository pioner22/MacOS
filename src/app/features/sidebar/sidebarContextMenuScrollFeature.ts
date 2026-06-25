import { createRafScrollLock } from "../../../helpers/ui/rafScrollLock";
import { readScrollSnapshot } from "../../../helpers/ui/scrollSnapshot";

export interface SidebarContextMenuScrollFeatureDeps {
  sidebarBody: HTMLElement;
  isContextMenuOpen: () => boolean;
}

export interface SidebarContextMenuScrollFeature {
  armSidebarClickSuppression: (ms: number) => void;
  disarmSidebarClickSuppression: () => void;
  isSidebarClickSuppressed: () => boolean;
  suppressMouseFallbackFor: (ms: number) => void;
  isMouseFallbackSuppressed: () => boolean;
  rememberSidebarCtxScroll: () => void;
  readSidebarCtxScrollSnapshot: () => { top: number; left: number };
  restoreSidebarCtxScroll: (top: number, left: number) => void;
  stabilizeSidebarScrollOnContextClick: (top: number, left: number) => void;
  armSidebarCtxScrollHold: (top: number, left: number) => void;
  disarmSidebarCtxScrollHold: () => void;
}

const SIDEBAR_CTX_SCROLL_MAX_AGE_MS = 1200;

export function createSidebarContextMenuScrollFeature(
  deps: SidebarContextMenuScrollFeatureDeps
): SidebarContextMenuScrollFeature {
  const { sidebarBody, isContextMenuOpen } = deps;

  let suppressSidebarClick = false;
  let suppressSidebarClickTimer: number | null = null;
  let sidebarCtxMouseFallbackSuppressUntil = 0;

  let sidebarCtxPrevTop = 0;
  let sidebarCtxPrevLeft = 0;
  let sidebarCtxPrevAt = 0;
  let sidebarCtxHasPrev = false;

  function armSidebarClickSuppression(ms: number) {
    suppressSidebarClick = true;
    if (suppressSidebarClickTimer !== null) {
      window.clearTimeout(suppressSidebarClickTimer);
      suppressSidebarClickTimer = null;
    }
    if (typeof document !== "undefined") {
      document.documentElement.dataset.sidebarClickSuppressUntil = String(Date.now() + ms);
    }
    suppressSidebarClickTimer = window.setTimeout(() => {
      suppressSidebarClick = false;
      suppressSidebarClickTimer = null;
      if (typeof document !== "undefined") {
        delete document.documentElement.dataset.sidebarClickSuppressUntil;
      }
    }, ms);
  }

  function disarmSidebarClickSuppression() {
    suppressSidebarClick = false;
    if (suppressSidebarClickTimer !== null) {
      window.clearTimeout(suppressSidebarClickTimer);
      suppressSidebarClickTimer = null;
    }
    if (typeof document !== "undefined") {
      delete document.documentElement.dataset.sidebarClickSuppressUntil;
    }
  }

  function isSidebarClickSuppressed() {
    return suppressSidebarClick;
  }

  function suppressMouseFallbackFor(ms: number) {
    sidebarCtxMouseFallbackSuppressUntil = Date.now() + Math.max(0, ms);
  }

  function isMouseFallbackSuppressed() {
    return Date.now() < sidebarCtxMouseFallbackSuppressUntil;
  }

  function rememberSidebarCtxScroll() {
    sidebarCtxPrevTop = sidebarBody.scrollTop;
    sidebarCtxPrevLeft = sidebarBody.scrollLeft;
    sidebarCtxPrevAt = Date.now();
    sidebarCtxHasPrev = true;
  }

  function readSidebarCtxScrollSnapshot() {
    const r = readScrollSnapshot({
      curTop: sidebarBody.scrollTop,
      curLeft: sidebarBody.scrollLeft,
      prevTop: sidebarCtxPrevTop,
      prevLeft: sidebarCtxPrevLeft,
      prevAt: sidebarCtxPrevAt,
      hasPrev: sidebarCtxHasPrev,
      maxAgeMs: SIDEBAR_CTX_SCROLL_MAX_AGE_MS,
    });
    return { top: r.top, left: r.left };
  }

  function restoreSidebarCtxScroll(top: number, left: number) {
    if (sidebarBody.scrollTop !== top) sidebarBody.scrollTop = top;
    if (sidebarBody.scrollLeft !== left) sidebarBody.scrollLeft = left;
  }

  function stabilizeSidebarScrollOnContextClick(top: number, left: number) {
    const restore = () => restoreSidebarCtxScroll(top, left);
    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 80);
  }

  const sidebarCtxScrollLock = createRafScrollLock({
    restore: restoreSidebarCtxScroll,
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
  });

  let sidebarCtxHoldTimer: number | null = null;

  function disarmSidebarCtxScrollHold() {
    if (sidebarCtxHoldTimer !== null) {
      window.clearTimeout(sidebarCtxHoldTimer);
      sidebarCtxHoldTimer = null;
    }
    sidebarCtxScrollLock.stop();
  }

  function armSidebarCtxScrollHold(top: number, left: number) {
    sidebarCtxScrollLock.start(top, left);
    if (sidebarCtxHoldTimer !== null) {
      window.clearTimeout(sidebarCtxHoldTimer);
      sidebarCtxHoldTimer = null;
    }
    // Если по какой-то причине контекстное меню не открылось, не держим лок бесконечно.
    sidebarCtxHoldTimer = window.setTimeout(() => {
      sidebarCtxHoldTimer = null;
      if (isContextMenuOpen()) return;
      sidebarCtxScrollLock.stop();
    }, 900);
  }

  return {
    armSidebarClickSuppression,
    disarmSidebarClickSuppression,
    isSidebarClickSuppressed,
    suppressMouseFallbackFor,
    isMouseFallbackSuppressed,
    rememberSidebarCtxScroll,
    readSidebarCtxScrollSnapshot,
    restoreSidebarCtxScroll,
    stabilizeSidebarScrollOnContextClick,
    armSidebarCtxScrollHold,
    disarmSidebarCtxScrollHold,
  };
}
