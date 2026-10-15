export type AudioAttachmentKind = "voice" | "music";

export function classifyAudioAttachment(name: string, mime?: string | null): AudioAttachmentKind {
  const mt = String(mime ?? "")
    .trim()
    .toLowerCase();
  const rawName = String(name ?? "").trim();
  const dot = rawName.lastIndexOf(".");
  const ext = dot > 0 && dot < rawName.length - 1 ? rawName.slice(dot + 1).toLowerCase() : "";
  if (mt.includes("opus") || mt.includes("ogg")) return "voice";
  if (["opus", "ogg", "oga"].includes(ext)) return "voice";
  if (["mp3", "m4a", "wav", "flac", "aac"].includes(ext)) return "music";
  return "music";
}
