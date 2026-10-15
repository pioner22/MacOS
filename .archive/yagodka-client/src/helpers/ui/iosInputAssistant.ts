export function isIOS(): boolean {
  try {
    const ua = String(navigator?.userAgent || "");
    const isClassic = /iPad|iPhone|iPod/i.test(ua);
    const isIPadOS = /Macintosh/i.test(ua) && Number((navigator as any)?.maxTouchPoints || 0) > 1;
    return isClassic || isIPadOS;
  } catch {
    return false;
  }
}

export function isStandaloneDisplayMode(): boolean {
  try {
    const navStandalone = Boolean((navigator as any)?.standalone);
    if (navStandalone) return true;
  } catch {
    // ignore
  }
  try {
    return Boolean(
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
        window.matchMedia?.("(display-mode: fullscreen)")?.matches
    );
  } catch {
    return false;
  }
}

export type IosInputAssistantMode = "predictive" | "strict";

export function applyIosInputAssistantWorkaround(
  el: HTMLTextAreaElement | HTMLInputElement,
  mode: IosInputAssistantMode = "predictive"
): void {
  // В iOS PWA (standalone) WebKit может показывать системную панель Undo/Redo/✓ над клавиатурой.
  // Полностью отключить её в Safari/PWA нельзя. Из практики есть два режима:
  // - predictive: вернуть предиктив/спеллчек (часто заменяет Undo/Redo‑панель на ряд подсказок);
  // - strict: жёстко отключить автокоррекцию/спеллчек (полезно для ID/хэндлов).
  if (!isIOS() || !isStandaloneDisplayMode()) return;
  try {
    if (mode === "strict") {
      el.setAttribute("autocorrect", "off");
      el.setAttribute("spellcheck", "false");
      el.setAttribute("autocapitalize", "off");
      try {
        (el as any).spellcheck = false;
      } catch {
        // ignore
      }
      return;
    }

    el.setAttribute("autocorrect", "on");
    el.setAttribute("spellcheck", "true");
    el.setAttribute("autocapitalize", "sentences");
    try {
      (el as any).spellcheck = true;
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}
