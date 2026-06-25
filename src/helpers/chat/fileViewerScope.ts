import { isMessageContinuation } from "./messageGrouping";
import { resolveMediaKind } from "../files/mediaKind";
import type { ChatMessage } from "../../stores/types";

export type ViewerMediaKind = "image" | "video";

export interface ViewerSourceScope {
  kind: "single" | "album";
  indices: number[];
  prevIdx: number | null;
  nextIdx: number | null;
}

export interface FileViewerContextLike {
  kind?: string | null;
  fileId?: string | null;
  chatKey?: string | null;
  msgIdx?: number | null;
}

export function mediaKindForViewerMessage(msg: ChatMessage | null | undefined): ViewerMediaKind | null {
  const att = msg?.attachment;
  if (!msg || msg.kind === "sys" || !att || att.kind !== "file") return null;
  const kind = resolveMediaKind(String(att.name || ""), att.mime || null);
  if (kind === "image" || kind === "video") return kind;
  return null;
}

function albumCandidate(msg: ChatMessage | null | undefined): boolean {
  if (!msg || !mediaKindForViewerMessage(msg)) return false;
  const text = String(msg.text || "").trim();
  if (text && !text.startsWith("[file]")) return false;
  return true;
}

export function resolveViewerSourceScope(msgs: ChatMessage[], msgIdx: number): ViewerSourceScope | null {
  const index = Number.isFinite(msgIdx) ? Math.trunc(msgIdx) : -1;
  if (index < 0 || index >= msgs.length) return null;
  if (!mediaKindForViewerMessage(msgs[index])) return null;

  const ALBUM_MAX = 12;
  const ALBUM_GAP_SECONDS = 121;

  if (albumCandidate(msgs[index])) {
    const indices: number[] = [index];
    for (let i = index - 1; i >= 0 && indices.length < ALBUM_MAX; i -= 1) {
      if (!albumCandidate(msgs[i])) break;
      if (!isMessageContinuation(msgs[i], msgs[i + 1], { maxGapSeconds: ALBUM_GAP_SECONDS })) break;
      indices.unshift(i);
    }
    for (let i = index + 1; i < msgs.length && indices.length < ALBUM_MAX; i += 1) {
      if (!albumCandidate(msgs[i])) break;
      if (!isMessageContinuation(msgs[i - 1], msgs[i], { maxGapSeconds: ALBUM_GAP_SECONDS })) break;
      indices.push(i);
    }
    if (indices.length >= 2) {
      const pos = indices.indexOf(index);
      return {
        kind: "album",
        indices,
        prevIdx: pos > 0 ? indices[pos - 1] : null,
        nextIdx: pos >= 0 && pos < indices.length - 1 ? indices[pos + 1] : null,
      };
    }
  }

  return {
    kind: "single",
    indices: [index],
    prevIdx: null,
    nextIdx: null,
  };
}

export function sameFileViewerContext(
  modal: FileViewerContextLike | null | undefined,
  ctx: { fileId?: string | null; chatKey?: string | null; msgIdx?: number | null }
): boolean {
  if (!modal || modal.kind !== "file_viewer") return false;
  const modalFileId = String(modal.fileId || "").trim();
  const nextFileId = String(ctx.fileId || "").trim();
  if (modalFileId && nextFileId && modalFileId === nextFileId) return true;

  const modalChatKey = String(modal.chatKey || "").trim();
  const nextChatKey = String(ctx.chatKey || "").trim();
  const modalMsgIdx = Number.isFinite(modal.msgIdx) ? Math.trunc(Number(modal.msgIdx)) : null;
  const nextMsgIdx = Number.isFinite(ctx.msgIdx) ? Math.trunc(Number(ctx.msgIdx)) : null;
  return Boolean(modalChatKey && nextChatKey && modalChatKey === nextChatKey && modalMsgIdx !== null && modalMsgIdx === nextMsgIdx);
}

export function shouldApplyPendingFileViewerResult(
  modal: FileViewerContextLike | null | undefined,
  ctx: { fileId?: string | null; chatKey?: string | null; msgIdx?: number | null }
): boolean {
  if (!modal) return true;
  return sameFileViewerContext(modal, ctx);
}
