import { applyIosInputAssistantWorkaround } from "./iosInputAssistant";

export function focusElement(
  el: HTMLElement | null | undefined,
  opts?: {
    preventScroll?: boolean;
    select?: boolean;
  }
): void {
  if (!el) return;

  const preventScroll = opts?.preventScroll !== false;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const modeAttr = el.getAttribute("data-ios-assistant");
    if (modeAttr !== "off") {
      if (el instanceof HTMLInputElement) {
        const type = String(el.type || "text").toLowerCase();
        if (!["password", "file", "checkbox", "radio", "button", "submit", "reset", "hidden", "range", "color"].includes(type)) {
          applyIosInputAssistantWorkaround(el, modeAttr === "strict" ? "strict" : "predictive");
        }
      } else {
        applyIosInputAssistantWorkaround(el, modeAttr === "strict" ? "strict" : "predictive");
      }
    }

    try {
      el.focus({ preventScroll });
    } catch {
      el.focus();
    }
    if (opts?.select) {
      try {
        el.select();
      } catch {
        // ignore
      }
    }
    return;
  }

  try {
    (el as any).focus?.({ preventScroll });
  } catch {
    try {
      (el as any).focus?.();
    } catch {
      // ignore
    }
  }
}
