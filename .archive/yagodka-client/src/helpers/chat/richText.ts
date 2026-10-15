import { el } from "../dom/el";
import { safeUrl } from "../security/safeUrl";

function splitUrlToken(raw: string): { href: string; label: string; trailing: string } {
  let token = raw;
  let trailing = "";
  // Strip trailing punctuation, keep it outside the link.
  while (token.length && /[)\].,!?:;]+$/.test(token)) {
    trailing = token.slice(-1) + trailing;
    token = token.slice(0, -1);
  }
  const href = token;
  return { href, label: token, trailing };
}

export function renderRichText(text: string): Array<HTMLElement | string> {
  const s = String(text ?? "");
  if (!s) return [""];
  // Note: keep it conservative; avoid any HTML injection.
  const re = /(https?:\/\/[^\s<]+|@[a-z0-9_]{3,16})/gi;
  const out: Array<HTMLElement | string> = [];
  let last = 0;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    const idx = m.index;
    if (idx > last) out.push(s.slice(last, idx));
    const token = m[0] || "";
    if (token.startsWith("@")) {
      out.push(el("span", { class: "msg-mention" }, [token]));
    } else {
      const { href, label, trailing } = splitUrlToken(token);
      const base = typeof location !== "undefined" ? location.href : "http://localhost/";
      const safeHref = safeUrl(href, { base, allowedProtocols: ["http:", "https:"] });
      if (safeHref) {
        out.push(el("a", { class: "msg-link", href: safeHref, target: "_blank", rel: "noopener noreferrer" }, [label]));
      } else {
        out.push(label);
      }
      if (trailing) out.push(trailing);
    }
    last = idx + token.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length ? out : [s];
}

