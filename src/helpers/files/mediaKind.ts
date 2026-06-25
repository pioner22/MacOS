export type MediaKind = "image" | "video" | "audio" | "file";

export const IMAGE_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:img|image|photo|pic|picture|screenshot|screen[_\-\s]?shot|shot|dsc|pxl|selfie|scan|скрин(?:шот)?|фото|картин|изображ|снимок)(?:[_\-\s\(\)\[\]]|\d|$)/;
export const VIDEO_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:video|vid|movie|clip|screencast|screen[_\-\s]?(?:rec|record|recording)|видео|ролик)(?:[_\-\s\(\)\[\]]|\d|$)/;
export const AUDIO_NAME_HINT_RE =
  /(?:^|[_\-\s\(\)\[\]])(?:audio|voice|sound|music|song|track|record|rec|memo|note|voice[_\-\s]?note|аудио|звук|музык|песня|голос|запис|диктофон|заметк)(?:[_\-\s\(\)\[\]]|\d|$)/;

export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif)$/;
export const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|ogv|mkv|avi|3gp|3g2)$/;
export const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/;
export const PDF_EXT_RE = /\.pdf$/;

export function normalizeFileName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0];
  const leaf = noQuery.split(/[\\/]/).pop() || "";
  return leaf.trim().toLowerCase();
}

function normalizeMime(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function mediaKindFromMime(mime?: string | null): MediaKind | null {
  const mt = normalizeMime(mime);
  if (!mt) return null;
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("audio/")) return "audio";
  return null;
}

function mediaKindFromName(name: string): MediaKind | null {
  const normalized = normalizeFileName(name);
  if (!normalized) return null;
  if (IMAGE_EXT_RE.test(normalized)) return "image";
  if (VIDEO_EXT_RE.test(normalized)) return "video";
  if (AUDIO_EXT_RE.test(normalized)) return "audio";
  if (IMAGE_NAME_HINT_RE.test(normalized)) return "image";
  if (VIDEO_NAME_HINT_RE.test(normalized)) return "video";
  if (AUDIO_NAME_HINT_RE.test(normalized)) return "audio";
  return null;
}

export function resolveMediaKind(name: string, mime?: string | null, hint?: string | null): MediaKind {
  const byMime = mediaKindFromMime(mime);
  if (byMime) return byMime;

  const byName = mediaKindFromName(name);
  if (byName) return byName;

  const rawHint = String(hint || "").trim().toLowerCase();
  if (rawHint === "image" || rawHint === "video" || rawHint === "audio") return rawHint;
  return "file";
}

export function isImageLikeFile(name: string, mime?: string | null): boolean {
  return resolveMediaKind(name, mime) === "image";
}

export function isVideoLikeFile(name: string, mime?: string | null): boolean {
  return resolveMediaKind(name, mime) === "video";
}

export function isAudioLikeFile(name: string, mime?: string | null): boolean {
  return resolveMediaKind(name, mime) === "audio";
}

export function isPdfLikeFile(name: string, mime?: string | null): boolean {
  const mt = normalizeMime(mime);
  if (mt === "application/pdf" || mt.endsWith("+pdf")) return true;
  return PDF_EXT_RE.test(normalizeFileName(name));
}

export function isMediaLikeFile(name: string, mime?: string | null, hint?: string | null): boolean {
  return resolveMediaKind(name, mime, hint) !== "file";
}
