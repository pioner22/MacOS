import { el } from "../../helpers/dom/el";

export function renderMessageContentShell(content: HTMLElement, meta: HTMLElement): HTMLElement {
  return el("div", { class: "msg-content-shell" }, [content, meta]);
}
