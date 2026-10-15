import { el } from "../../helpers/dom/el";

export function renderAttachmentFooterShell(opts: {
  caption?: HTMLElement | null;
  meta: HTMLElement;
  media?: boolean;
}): HTMLElement {
  const classes = ["msg-attach-footer"];
  if (opts.caption) classes.push("msg-attach-footer-caption");
  else classes.push("msg-attach-footer-meta-only");
  if (opts.media) classes.push("msg-attach-footer-media");
  const children: HTMLElement[] = [];
  if (opts.caption) children.push(opts.caption);
  children.push(opts.meta);
  return el("div", { class: classes.join(" ") }, children);
}
