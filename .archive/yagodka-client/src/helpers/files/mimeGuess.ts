export function guessMimeTypeByName(name: string): string {
  const raw = String(name || "").trim();
  const noQuery = raw.split(/[?#]/)[0];
  const leaf = noQuery.split(/[\\/]/).pop() || "";
  const n = leaf.trim().toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".bmp")) return "image/bmp";
  if (n.endsWith(".ico")) return "image/x-icon";
  if (n.endsWith(".heic")) return "image/heic";
  if (n.endsWith(".heif")) return "image/heif";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".ogv")) return "video/ogg";
  if (n.endsWith(".mkv")) return "video/x-matroska";
  if (n.endsWith(".avi")) return "video/x-msvideo";
  if (n.endsWith(".3gp")) return "video/3gpp";
  if (n.endsWith(".3g2")) return "video/3gpp2";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".aac")) return "audio/aac";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".ogg")) return "audio/ogg";
  if (n.endsWith(".opus")) return "audio/opus";
  if (n.endsWith(".flac")) return "audio/flac";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

