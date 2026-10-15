export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  children: Array<HTMLElement | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  if (node instanceof HTMLTextAreaElement) {
    if (!node.hasAttribute("autocomplete")) node.setAttribute("autocomplete", "off");
    if (!node.hasAttribute("autocorrect")) node.setAttribute("autocorrect", "off");
    if (!node.hasAttribute("autocapitalize")) node.setAttribute("autocapitalize", "off");
    if (!node.hasAttribute("spellcheck")) node.setAttribute("spellcheck", "false");
    if (!node.hasAttribute("inputmode")) node.setAttribute("inputmode", "text");
    if (!node.hasAttribute("enterkeyhint")) node.setAttribute("enterkeyhint", "done");
  } else if (node instanceof HTMLInputElement) {
    const t = String(node.type || "text").toLowerCase();
    const isTextLike = !["file", "checkbox", "radio", "button", "submit", "reset", "hidden", "range", "color"].includes(t);
    if (isTextLike) {
      if (!node.hasAttribute("autocomplete")) node.setAttribute("autocomplete", "off");
      if (!node.hasAttribute("autocorrect")) node.setAttribute("autocorrect", "off");
      if (!node.hasAttribute("autocapitalize")) node.setAttribute("autocapitalize", "off");
      if (!node.hasAttribute("spellcheck")) node.setAttribute("spellcheck", "false");
      if (!node.hasAttribute("inputmode")) {
        const mode = t === "search" ? "search" : t === "number" ? "numeric" : t === "tel" ? "tel" : t === "email" ? "email" : t === "url" ? "url" : "text";
        node.setAttribute("inputmode", mode);
      }
      if (!node.hasAttribute("enterkeyhint")) node.setAttribute("enterkeyhint", t === "search" ? "search" : "done");
    }
  }
  for (const ch of children) {
    node.append(ch instanceof HTMLElement ? ch : document.createTextNode(ch));
  }
  return node;
}
