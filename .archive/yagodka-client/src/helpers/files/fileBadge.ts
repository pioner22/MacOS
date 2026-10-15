import { normalizeFileName, resolveMediaKind } from "./mediaKind";

export type FileBadgeKind = "image" | "video" | "audio" | "archive" | "doc" | "pdf" | "other";

export interface FileBadge {
  kind: FileBadgeKind;
  label: string;
  hue: number; // 0..359
}

function hashHue(seed: string): number {
  const s = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

function extOf(name: string): string {
  const n = normalizeFileName(name);
  if (!n) return "";
  const idx = n.lastIndexOf(".");
  if (idx <= 0 || idx === n.length - 1) return "";
  return n.slice(idx + 1);
}

function kindOf(name: string, mime?: string | null): FileBadgeKind {
  const mediaKind = resolveMediaKind(name, mime);
  if (mediaKind !== "file") return mediaKind;

  const mt = String(mime || "").trim().toLowerCase();
  if (mt === "application/pdf" || mt.endsWith("+pdf")) return "pdf";

  const ext = extOf(name);
  if (!ext) return "other";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "heic", "heif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) return "archive";
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx", "rtf", "txt", "md", "odt", "xls", "xlsx", "csv", "ppt", "pptx"].includes(ext)) return "doc";
  return "other";
}

function labelFor(name: string, kind: FileBadgeKind): string {
  if (kind === "image") return "IMG";
  if (kind === "video") return "VID";
  if (kind === "audio") return "AUD";
  if (kind === "pdf") return "PDF";
  if (kind === "archive") return "ZIP";

  const ext = extOf(name);
  if (!ext) return "FILE";
  const up = ext.toUpperCase();
  return up.length > 4 ? up.slice(0, 4) : up;
}

export function fileBadge(name: string, mime?: string | null): FileBadge {
  const safeName = String(name ?? "").trim();
  const kind = kindOf(safeName, mime);
  const label = labelFor(safeName, kind);
  const hue = hashHue(`${kind}:${label}:${safeName}`);
  return { kind, label, hue };
}
