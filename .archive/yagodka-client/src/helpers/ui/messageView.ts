import type { MessageViewMode } from "../../stores/types";

export function normalizeMessageView(input: unknown): MessageViewMode {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "plain" || raw === "compact" || raw === "bubble") return raw;
  return "bubble";
}

export function getStoredMessageView(): MessageViewMode {
  return "bubble";
}

export function storeMessageView(_view: MessageViewMode): void {
  // no-op: стиль сообщений задаётся скином
}

export function applyMessageView(_view: MessageViewMode): void {
  try {
    const root = document.documentElement;
    root.dataset.msgView = "bubble";
    delete root.dataset.msgViewAuto;
    const width = Math.max(Number(window.innerWidth) || 0, Number(root.clientWidth) || 0);
    const wideMin = 1180;
    const wideHysteresis = 24;
    const isWide = root.dataset.msgWide === "1";
    const shouldEnableWide = !isWide && width >= wideMin + wideHysteresis;
    const shouldDisableWide = isWide && width <= wideMin - wideHysteresis;
    if (shouldEnableWide || (isWide && !shouldDisableWide)) {
      root.dataset.msgWide = "1";
    } else if (shouldDisableWide || !isWide) {
      delete root.dataset.msgWide;
    }
  } catch {
    // ignore
  }
}
