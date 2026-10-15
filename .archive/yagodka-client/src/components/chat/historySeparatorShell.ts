import { el } from "../../helpers/dom/el";
import { formatDayLabel } from "./renderChatHelpers";

function separatorLine(): HTMLElement {
  return el("span", { class: "msg-sep-line", "aria-hidden": "true" }, [""]);
}

function separatorPill(label: string, count?: number): HTMLElement {
  const nodes: HTMLElement[] = [el("span", { class: "msg-sep-text" }, [label])];
  if (typeof count === "number" && Number.isFinite(count) && count > 0) {
    nodes.push(el("span", { class: "msg-sep-count", "aria-hidden": "true" }, [String(Math.trunc(count))]));
  }
  return el("span", { class: "msg-sep-pill" }, nodes);
}

export function renderDateSeparator(ts: number): HTMLElement {
  return el("div", { class: "msg-sep msg-date", "aria-hidden": "true", "data-sep-kind": "date" }, [
    separatorLine(),
    separatorPill(formatDayLabel(ts)),
    separatorLine(),
  ]);
}

export function renderUnreadSeparator(unreadCount: number): HTMLElement {
  const count = Number.isFinite(unreadCount) ? Math.max(0, Math.trunc(unreadCount)) : 0;
  const unreadLabel = count > 0 ? `Непрочитанные (${count})` : "Непрочитанные";
  return el("div", { class: "msg-sep msg-unread", role: "separator", "aria-label": unreadLabel, "data-sep-kind": "unread" }, [
    separatorLine(),
    separatorPill("Непрочитанные", count),
    separatorLine(),
  ]);
}
