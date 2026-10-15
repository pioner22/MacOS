import type { FileTransferEntry } from "../../stores/types";
import { resolveMediaKind } from "./mediaKind";

export const MISSING_FILE_STATUS = "Файл недоступен";

export type FileMissingMeta = {
  name?: string | null;
  mime?: string | null;
  kindHint?: string | null;
};

export function isNotFoundFileError(value: unknown): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "not_found" || raw.startsWith("not_found ");
}

export function isVisualMediaMeta(meta?: FileMissingMeta | null): boolean {
  const name = String(meta?.name || "").trim();
  const mime = meta?.mime ?? null;
  const kindHint = meta?.kindHint ?? null;
  const kind = resolveMediaKind(name, mime, kindHint);
  return kind === "image" || kind === "video";
}

export function isTerminalMissingVisualTransfer(entry?: FileTransferEntry | null, meta?: FileMissingMeta | null): boolean {
  if (!entry || entry.status !== "error" || !isNotFoundFileError(entry.error)) return false;
  const entryMeta = { name: entry.name, mime: entry.mime ?? null, kindHint: meta?.kindHint ?? null };
  return isVisualMediaMeta(entryMeta) || isVisualMediaMeta(meta);
}
