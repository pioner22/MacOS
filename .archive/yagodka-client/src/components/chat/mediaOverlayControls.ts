import { el } from "../../helpers/dom/el";

export function renderMediaOverlayControls(opts: {
  selectionBtn?: HTMLElement | null;
  actions?: HTMLElement[];
}): HTMLElement | null {
  const actions = Array.isArray(opts.actions) ? opts.actions.filter(Boolean) : [];
  if (!opts.selectionBtn && !actions.length) return null;
  const children: HTMLElement[] = [];
  if (opts.selectionBtn) {
    children.push(el("div", { class: "chat-media-overlay-start" }, [opts.selectionBtn]));
  }
  if (actions.length) {
    children.push(el("div", { class: "chat-media-overlay-end" }, [el("div", { class: "file-actions chat-media-overlay-actions" }, actions)]));
  }
  return el("div", { class: "chat-media-overlay-controls" }, children);
}
