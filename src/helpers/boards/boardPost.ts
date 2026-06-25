import { el } from "../dom/el";
import { renderRichText } from "../chat/richText";

export type BoardPostChangelogKind = "added" | "improved" | "fixed" | "notes";

export type BoardPostNode =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "divider" }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "changelog"; changelogKind: BoardPostChangelogKind; title: string; items: string[] };

type ChangelogHeadingInfo = { kind: BoardPostChangelogKind; title: string };

const CHANGELOG_HEADINGS: Record<string, ChangelogHeadingInfo> = {
  "добавлено": { kind: "added", title: "Добавлено" },
  "улучшено": { kind: "improved", title: "Улучшено" },
  "исправлено": { kind: "fixed", title: "Исправлено" },
  "примечания": { kind: "notes", title: "Примечания" },
};

const CHANGELOG_MARKERS: Record<string, ChangelogHeadingInfo> = {
  "+": { kind: "added", title: "Добавлено" },
  "^": { kind: "improved", title: "Улучшено" },
  "!": { kind: "fixed", title: "Исправлено" },
  "?": { kind: "notes", title: "Примечания" },
};

function normalizeHeadingText(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[:：]\s*$/, "")
    .toLowerCase();
}

function isDivider(raw: string): boolean {
  const t = String(raw ?? "").trim();
  return t === "—" || t === "---";
}

function isHeading(raw: string): boolean {
  return /^#{1,6}(?:[+^!?])?(?:\s+|$)/.test(String(raw ?? "").trimStart());
}

function headingInfo(raw: string): { level: number; marker: string | null; text: string } | null {
  const m = String(raw ?? "").trimStart().match(/^(#{1,6})([+^!?])?(?:\s+(.*))?$/);
  if (!m) return null;
  const level = Math.max(1, Math.min(6, m[1]?.length || 1));
  const marker = m[2] ? String(m[2]) : null;
  const text = String(m[3] ?? "").trimEnd();
  if (!marker && !text) return null;
  return { level, marker, text };
}

function isList(raw: string): boolean {
  return /^(?:•|-)\s+/.test(String(raw ?? "").trimStart());
}

function listText(raw: string): string {
  return String(raw ?? "").trimStart().replace(/^(?:•|-)\s+/, "").trimEnd();
}

function isQuote(raw: string): boolean {
  return /^>\s+/.test(String(raw ?? "").trimStart());
}

function quoteText(raw: string): string {
  return String(raw ?? "").trimStart().replace(/^>\s+/, "").trimEnd();
}

export function parseBoardPost(text: string): BoardPostNode[] {
  const cleaned = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n").map((l) => String(l ?? "").trimEnd());
  const out: BoardPostNode[] = [];

  const flushParagraph = (buf: string[]) => {
    const parts = buf.map((x) => String(x ?? "").trimEnd()).filter((x) => x !== "");
    if (!parts.length) return;
    out.push({ kind: "paragraph", lines: parts });
  };

  let paragraph: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const trimmed = String(raw ?? "");
    const t = trimmed.trim();
    if (!t) {
      flushParagraph(paragraph);
      paragraph = [];
      i += 1;
      continue;
    }

    if (isDivider(trimmed)) {
      flushParagraph(paragraph);
      paragraph = [];
      out.push({ kind: "divider" });
      i += 1;
      continue;
    }

    if (isHeading(trimmed)) {
      flushParagraph(paragraph);
      paragraph = [];
      const info = headingInfo(trimmed);
      if (!info) {
        paragraph.push(trimmed);
        i += 1;
        continue;
      }

      const markerInfo = info.level === 2 && info.marker ? CHANGELOG_MARKERS[info.marker] : null;
      const norm = markerInfo ? "" : normalizeHeadingText(info.text);
      const block = markerInfo || (norm ? CHANGELOG_HEADINGS[norm] : null);
      if (!block) {
        out.push({ kind: "heading", level: info.level, text: info.text });
        i += 1;
        continue;
      }

      i += 1;
      const items: string[] = [];
      while (i < lines.length) {
        const sectionRaw = lines[i] ?? "";
        const sectionTrimmed = String(sectionRaw ?? "");
        const sectionText = sectionTrimmed.trim();
        if (!sectionText) {
          i += 1;
          if (items.length) break;
          continue;
        }
        if (isDivider(sectionTrimmed)) break;
        if (isHeading(sectionTrimmed)) break;

        if (isList(sectionTrimmed)) {
          const txt = listText(sectionTrimmed);
          if (txt) items.push(txt);
          i += 1;
          continue;
        }
        // Allow plain lines too (convert into list items) to keep authoring simple.
        items.push(sectionText);
        i += 1;
      }

      out.push({
        kind: "changelog",
        changelogKind: block.kind,
        title: info.text.trim() || block.title,
        items,
      });
      continue;
    }

    if (isList(trimmed)) {
      flushParagraph(paragraph);
      paragraph = [];
      const items: string[] = [];
      while (i < lines.length) {
        const liRaw = lines[i] ?? "";
        if (!isList(liRaw)) break;
        const txt = listText(liRaw);
        items.push(txt);
        i += 1;
      }
      out.push({ kind: "list", items });
      continue;
    }

    if (isQuote(trimmed)) {
      flushParagraph(paragraph);
      paragraph = [];
      const qLines: string[] = [];
      while (i < lines.length) {
        const qRaw = lines[i] ?? "";
        if (!isQuote(qRaw)) break;
        const txt = quoteText(qRaw);
        qLines.push(txt);
        i += 1;
      }
      out.push({ kind: "quote", lines: qLines });
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }
  flushParagraph(paragraph);

  if (!out.length) return [{ kind: "paragraph", lines: [cleaned] }];
  return out;
}

function renderParagraph(lines: string[]): HTMLElement {
  const nodes: Array<HTMLElement | string> = [];
  const parts = lines.map((x) => String(x ?? "").trimEnd()).filter((x) => x !== "");
  for (let i = 0; i < parts.length; i += 1) {
    if (i) nodes.push(el("br"));
    nodes.push(...renderRichText(parts[i]));
  }
  return el("div", { class: "board-p" }, nodes);
}

function renderList(items: string[]): HTMLElement {
  const children = items.map((txt) => el("li", { class: "board-li" }, txt ? renderRichText(txt) : [""]));
  return el("ul", { class: "board-list" }, children);
}

function renderQuote(lines: string[]): HTMLElement {
  const children = lines.map((txt, idx) =>
    el("div", { class: idx ? "board-quote-line board-quote-line-cont" : "board-quote-line" }, txt ? renderRichText(txt) : [""])
  );
  return el("blockquote", { class: "board-quote" }, children);
}

function renderHeading(level: number, text: string): HTMLElement {
  return el("div", { class: `board-h board-h${Math.max(1, Math.min(6, level || 1))}` }, renderRichText(text));
}

function renderChangelogBlock(kind: BoardPostChangelogKind, title: string, items: string[]): HTMLElement {
  const listItems = items.map((x) => el("li", { class: "changelog-item" }, x ? renderRichText(x) : [""]));
  return el("div", { class: "changelog-block board-changelog-block" }, [
    el("div", { class: `changelog-kind kind-${kind}` }, [title]),
    el("ul", { class: "changelog-list" }, listItems),
  ]);
}

export function renderBoardPost(text: string): HTMLElement {
  const nodes = parseBoardPost(text);
  const out: HTMLElement[] = [];
  for (const n of nodes) {
    if (n.kind === "divider") {
      out.push(el("hr", { class: "board-hr", "aria-hidden": "true" }));
      continue;
    }
    if (n.kind === "paragraph") {
      out.push(renderParagraph(n.lines));
      continue;
    }
    if (n.kind === "heading") {
      out.push(renderHeading(n.level, n.text));
      continue;
    }
    if (n.kind === "list") {
      out.push(renderList(n.items));
      continue;
    }
    if (n.kind === "quote") {
      out.push(renderQuote(n.lines));
      continue;
    }
    if (n.kind === "changelog") {
      out.push(renderChangelogBlock(n.changelogKind, n.title, n.items));
      continue;
    }
  }
  return el("div", { class: "board-post" }, out.length ? out : [renderParagraph([String(text ?? "")])]);
}
