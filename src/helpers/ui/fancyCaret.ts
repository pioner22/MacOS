type CaretTarget = HTMLInputElement | HTMLTextAreaElement;

function isCaretTarget(el: unknown): el is CaretTarget {
  if (!el || typeof el !== "object") return false;
  const node = el as any;
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;
}

function isSupportedField(el: CaretTarget): boolean {
  if (String(el.getAttribute("data-fancy-caret") || "").toLowerCase() === "off") return false;
  if (el instanceof HTMLInputElement) {
    const t = String(el.type || "text").toLowerCase();
    // Password fields often use special glyph rendering; custom caret positioning becomes unreliable.
    const banned = new Set(["button", "submit", "reset", "checkbox", "radio", "file", "color", "range", "hidden", "password"]);
    if (banned.has(t)) return false;
  }
  // Chat composer textarea is multi-line and auto-sized; the custom caret can become jittery there.
  // Keep native caret for the composer and use fancy caret only for simpler text inputs.
  if (el.classList.contains("modal-input")) return true;
  if (el.classList.contains("input")) return el instanceof HTMLInputElement;
  return false;
}

function repeatChar(ch: string, count: number): string {
  const n = Math.max(0, Math.min(10_000, count | 0));
  if (n <= 0) return "";
  return ch.repeat(n);
}

function computeCaretRect(
  mirror: HTMLDivElement,
  el: CaretTarget,
  caretPos: number
): { left: number; top: number; height: number } | null {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.fontVariant = style.fontVariant;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.wordSpacing = style.wordSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.textTransform = style.textTransform;
  mirror.style.textIndent = style.textIndent;
  mirror.style.textAlign = style.textAlign;
  mirror.style.direction = style.direction;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.width = `${rect.width}px`;
  mirror.style.height = `${rect.height}px`;

  if (el instanceof HTMLTextAreaElement) {
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    mirror.style.wordBreak = "break-word";
  } else {
    mirror.style.whiteSpace = "pre";
    mirror.style.overflowWrap = "normal";
    mirror.style.wordBreak = "normal";
  }

  let value = el.value || "";
  if (el instanceof HTMLInputElement && String(el.type || "").toLowerCase() === "password") {
    value = repeatChar("•", value.length);
  }

  const pos = Math.max(0, Math.min(value.length, caretPos | 0));
  const before = value.slice(0, pos);
  const after = value.slice(pos) || " ";

  mirror.replaceChildren();
  mirror.append(document.createTextNode(before));
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.append(marker, document.createTextNode(after));

  // Keep scroll positions in sync to place caret correctly when content is scrolled.
  try {
    (mirror as any).scrollTop = (el as any).scrollTop || 0;
    (mirror as any).scrollLeft = (el as any).scrollLeft || 0;
  } catch {
    // ignore
  }

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();

  const height =
    markerRect.height ||
    (() => {
      const lh = Number.parseFloat(style.lineHeight);
      if (Number.isFinite(lh) && lh > 0) return lh;
      const fs = Number.parseFloat(style.fontSize);
      if (Number.isFinite(fs) && fs > 0) return fs * 1.3;
      return 16;
    })();

  return {
    left: rect.left + (markerRect.left - mirrorRect.left),
    top: rect.top + (markerRect.top - mirrorRect.top),
    height,
  };
}

export function installFancyCaret(): void {
  if (typeof window === "undefined") return;
  if (typeof document === "undefined") return;

  const w = window as any;
  if (w.__yagodka_fancy_caret_installed) return;

  // На iOS/touch-устройствах кастомная каретка часто ведёт себя нестабильно
  // из-за особенностей WebKit/VisualViewport и системного редактирования текста.
  // Там лучше оставить нативную (она всегда на месте).
  const isIOS = (() => {
    try {
      const ua = String(navigator?.userAgent || "");
      const isClassic = /iPad|iPhone|iPod/i.test(ua);
      const isIPadOS = /Macintosh/i.test(ua) && Number((navigator as any)?.maxTouchPoints || 0) > 1;
      return isClassic || isIPadOS;
    } catch {
      return false;
    }
  })();
  const coarsePointer = (() => {
    try {
      return Boolean(window.matchMedia?.("(pointer: coarse)")?.matches);
    } catch {
      return false;
    }
  })();
  const hasTouch = (() => {
    try {
      return Number((navigator as any)?.maxTouchPoints || 0) > 0;
    } catch {
      return false;
    }
  })();
  if (isIOS || coarsePointer || hasTouch) return;

  w.__yagodka_fancy_caret_installed = true;

  const caret = document.createElement("div");
  caret.className = "fancy-caret";
  caret.setAttribute("aria-hidden", "true");
  document.body.appendChild(caret);

  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "fixed";
  mirror.style.left = "0";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.overflow = "auto";
  mirror.style.zIndex = "-1";
  document.body.appendChild(mirror);

  let active: CaretTarget | null = null;
  let savedCaretColor: string | null = null;
  let raf: number | null = null;
  const onActiveScroll = () => bump();

  const hide = () => {
    caret.classList.remove("on");
    caret.style.left = "-9999px";
    caret.style.top = "-9999px";
  };

  const restoreNativeCaret = () => {
    if (!active) return;
    if (savedCaretColor === null) return;
    active.style.caretColor = savedCaretColor;
    savedCaretColor = null;
  };

  const deactivate = () => {
    if (active) {
      try {
        active.removeEventListener("scroll", onActiveScroll);
      } catch {
        // ignore
      }
    }
    restoreNativeCaret();
    active = null;
    hide();
  };

  const schedule = () => {
    if (raf !== null) return;
    raf = window.requestAnimationFrame(() => {
      raf = null;
      update();
    });
  };

  const update = () => {
    const el = active;
    if (!el) return;
    if (document.activeElement !== el) {
      deactivate();
      return;
    }
    if ((el as any).disabled) {
      restoreNativeCaret();
      hide();
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === null || end === null) {
      restoreNativeCaret();
      hide();
      return;
    }
    if (start !== end) {
      restoreNativeCaret();
      hide();
      return;
    }

    const res = computeCaretRect(mirror, el, start);
    if (!res) {
      restoreNativeCaret();
      hide();
      return;
    }

    caret.style.left = `${Math.round(res.left)}px`;
    caret.style.top = `${Math.round(res.top)}px`;
    caret.style.height = `${Math.round(res.height)}px`;
    caret.classList.add("on");

    // Hide native caret only when we can render the custom one.
    if (savedCaretColor === null) savedCaretColor = el.style.caretColor || "";
    el.style.caretColor = "transparent";
  };

  const bump = () => {
    if (!active) return;
    schedule();
  };

  document.addEventListener("focusin", (ev) => {
    const t = (ev as FocusEvent).target;
    if (!isCaretTarget(t)) return;
    if (!isSupportedField(t)) return;
    if (active === t) {
      schedule();
      return;
    }
    deactivate();
    active = t;
    savedCaretColor = t.style.caretColor || "";
    try {
      t.addEventListener("scroll", onActiveScroll, { passive: true });
    } catch {
      // ignore
    }
    schedule();
  });

  document.addEventListener("focusout", (ev) => {
    if (!active) return;
    if ((ev as FocusEvent).target !== active) return;
    deactivate();
  });

  document.addEventListener("selectionchange", () => bump());
  window.addEventListener("resize", () => bump());
  window.addEventListener("scroll", () => bump(), true);

  for (const name of [
    "input",
    "keydown",
    "keyup",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
    "click",
    "compositionstart",
    "compositionupdate",
    "compositionend",
  ]) {
    document.addEventListener(name, () => bump(), true);
  }

  hide();
}
