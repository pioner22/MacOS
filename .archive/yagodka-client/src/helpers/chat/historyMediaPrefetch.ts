import type { AppState } from "../../stores/types";
import { dmKey, roomKey } from "./conversationKey";

type AutoDownloadKind = "image" | "video" | "audio" | "file";

type AutoDownloadCachePolicyLike = {
  resolveAutoDownloadKind: (name: string, mime: string | null | undefined, hint?: string | null) => AutoDownloadKind;
  canAutoDownloadFullFile: (userId: string | null, kind: AutoDownloadKind, size: number) => boolean;
  shouldCachePreview: (name: string, mime: string | null | undefined, size: number) => boolean;
};

type EnqueueFileGetLike = (fileId: string, opts?: { priority?: "high" | "prefetch"; silent?: boolean }) => void;

function normalizeId(raw: unknown): string | null {
  const id = String(raw ?? "").trim();
  return id ? id : null;
}

function messageKeyFromHistoryResult(msg: any): string {
  const room = normalizeId(msg?.room);
  if (room) return roomKey(room);
  const peer = normalizeId(msg?.peer);
  if (peer) return dmKey(peer);
  return "";
}

function selectedKeyFromState(st: AppState): string {
  const sel = st.selected;
  if (!sel) return "";
  const id = normalizeId(sel.id);
  if (!id) return "";
  return sel.kind === "dm" ? dmKey(id) : roomKey(id);
}

export function prefetchHistoryMediaFromHistoryResult(
  msg: any,
  deps: {
    getState: () => AppState;
    devicePrefetchAllowed: boolean;
    autoDownloadCachePolicyFeature: AutoDownloadCachePolicyLike;
    enqueueFileGet: EnqueueFileGetLike;
  }
): void {
  try {
    const st = deps.getState();
    if (!st.authed || st.conn !== "connected") return;
    if (!st.selfId) return;
    if (!st.netLeader) return;
    if (!deps.devicePrefetchAllowed) return;
    if (document.visibilityState === "hidden") return;
    if (Boolean(msg?.preview)) return;

    const key = messageKeyFromHistoryResult(msg);
    const selectedKey = selectedKeyFromState(st);
    const isSelected = Boolean(key && selectedKey && key === selectedKey);

    const rows = Array.isArray(msg?.rows) ? msg.rows : [];
    if (!rows.length) return;

    const transferErrors = new Set<string>();
    for (const t of st.fileTransfers || []) {
      const id = normalizeId(t?.id);
      if (!id) continue;
      if ((t as any)?.status === "error") transferErrors.add(id);
    }

    const maxPerResult = isSelected ? 18 : 8;
    let queued = 0;
    for (const r of rows) {
      if (queued >= maxPerResult) break;
      const att = (r as any)?.attachment;
      if (!att || typeof att !== "object") continue;
      const kind = String((att as any).kind ?? "");
      if (kind !== "file") continue;
      const fileId = normalizeId((att as any).file_id ?? (att as any).fileId ?? (att as any).id);
      if (!fileId) continue;
      if (transferErrors.has(fileId)) continue;

      const name = String((att as any).name ?? "файл");
      const mimeRaw = (att as any).mime;
      const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? String(mimeRaw).trim() : null;
      const autoKind = deps.autoDownloadCachePolicyFeature.resolveAutoDownloadKind(name, mime, null);
      // Visual chat media is now click-to-load. History_result may restore already
      // cached previews elsewhere, but must not start background file_get for old
      // photo/video rows that can be stale or missing on the server.
      if (autoKind !== "image" && autoKind !== "video") continue;
      queued += 1;
    }
  } catch {
    // ignore
  }
}
