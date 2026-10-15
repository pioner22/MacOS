import type { AppState } from "../../../stores/types";
import type { AutoDownloadKind } from "./fileDownloadTypes";

export function resolveViewerPreviewFallbackUrl(params: {
  currentModal: AppState["modal"];
  nextUrl: string;
  name: string;
  mime: string | null | undefined;
  resolveAutoDownloadKind: (name: string, mime: string | null | undefined, hint?: string | null) => AutoDownloadKind;
}): string | null {
  if (params.resolveAutoDownloadKind(params.name || "файл", params.mime, null) !== "image") return null;
  const currentUrl = params.currentModal?.kind === "file_viewer" ? String(params.currentModal.url || "").trim() : "";
  const targetUrl = String(params.nextUrl || "").trim();
  if (!currentUrl || !targetUrl || currentUrl === targetUrl) return null;
  return currentUrl;
}
