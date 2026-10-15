import { isMessageContinuation } from "../../helpers/chat/messageGrouping";
import { type UnreadDividerAnchor, findUnreadAnchorIndex, unreadAnchorForMessage } from "../../helpers/chat/historyViewportAnchors";
import { sanitizeTargetRef } from "../../helpers/navigation/viewState";
import type { AppState, ChatMessage } from "../../stores/types";

import {
  type AlbumItem,
  dayKey,
  extractFileCaptionText,
  getFileAttachmentInfo,
  isAlbumCandidate,
} from "./renderChatHelpers";

export type HistoryLayoutBlock =
  | { kind: "date"; ts: number }
  | { kind: "unread"; unreadCount: number }
  | { kind: "message"; msgIdx: number; continues: boolean; tail: boolean }
  | { kind: "album"; startIdx: number; endIdx: number; items: AlbumItem[]; continues: boolean; tail: boolean };

export interface ResolveUnreadDividerOptions {
  key: string;
  msgs: ChatMessage[];
  searchActive: boolean;
  selected: AppState["selected"];
  friends: AppState["friends"];
  lastRead: AppState["lastRead"];
  savedAnchor?: UnreadDividerAnchor | null;
  virtualEnabled: boolean;
  virtualStart: number;
}

export interface ResolvedUnreadDivider {
  unreadIdx: number;
  unreadCount: number;
  unreadInsertIdx: number;
  anchor: UnreadDividerAnchor | null;
}

function normalizeUnreadIndex(msgs: ChatMessage[], idx: number): number {
  if (!Array.isArray(msgs) || msgs.length === 0) return -1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= msgs.length) return -1;
  let next = Math.trunc(idx);
  while (next < msgs.length && msgs[next]?.kind === "sys") next += 1;
  return next < msgs.length ? next : -1;
}

export function resolveUnreadDivider(opts: ResolveUnreadDividerOptions): ResolvedUnreadDivider {
  const msgs = Array.isArray(opts.msgs) ? opts.msgs : [];
  if (!opts.key || opts.searchActive || !msgs.length) {
    return { unreadIdx: -1, unreadCount: 0, unreadInsertIdx: -1, anchor: null };
  }

  let unreadIdx = -1;
  if (opts.savedAnchor) {
    unreadIdx = normalizeUnreadIndex(msgs, findUnreadAnchorIndex(msgs, opts.savedAnchor));
  }

  const selected = sanitizeTargetRef(opts.selected);
  if (unreadIdx < 0 && selected?.kind === "dm") {
    const peerId = String(selected.id || "").trim();
    const unread = (opts.friends || []).find((friend) => friend.id === peerId)?.unread ?? 0;
    if (unread > 0) {
      unreadIdx = normalizeUnreadIndex(msgs, Math.max(0, Math.min(msgs.length - 1, msgs.length - unread)));
    }
  }

  if (unreadIdx < 0) {
    const marker = opts.lastRead?.[opts.key];
    const lastReadId = Number(marker?.id ?? 0);
    const lastReadAt = Number(marker?.ts ?? 0);
    if (lastReadId > 0) {
      unreadIdx = normalizeUnreadIndex(
        msgs,
        msgs.findIndex((msg) => Number(msg?.id ?? 0) > lastReadId)
      );
    } else if (lastReadAt > 0) {
      unreadIdx = normalizeUnreadIndex(
        msgs,
        msgs.findIndex((msg) => Number(msg?.ts ?? 0) > lastReadAt)
      );
    }
  }

  if (unreadIdx < 0 || unreadIdx >= msgs.length) {
    return { unreadIdx: -1, unreadCount: 0, unreadInsertIdx: -1, anchor: null };
  }

  const unreadCount = Math.max(0, msgs.length - unreadIdx);
  const anchor = unreadAnchorForMessage(msgs[unreadIdx]);
  const unreadInsertIdx = opts.virtualEnabled && unreadIdx < opts.virtualStart ? opts.virtualStart : unreadIdx;
  return { unreadIdx, unreadCount, unreadInsertIdx, anchor };
}

export interface BuildHistoryLayoutBlocksOptions {
  msgs: ChatMessage[];
  state: AppState;
  mobileUi: boolean;
  boardUi: boolean;
  virtualStart: number;
  virtualEnd: number;
  unreadInsertIdx: number;
  unreadCount: number;
  albumMin?: number;
  albumMax?: number;
  albumGapSeconds?: number;
}

function isGroupTail(msgs: ChatMessage[], idx: number, msg: ChatMessage, unreadInsertIdx: number): boolean {
  const nextIdx = idx + 1;
  if (nextIdx >= msgs.length) return true;
  if (nextIdx === unreadInsertIdx) return true;
  const nextMsg = msgs[nextIdx];
  if (!nextMsg || nextMsg.kind === "sys") return true;
  const curDay = dayKey(msg.ts);
  const nextDay = dayKey(nextMsg.ts);
  if (curDay && nextDay && curDay !== nextDay) return true;
  return !isMessageContinuation(msg, nextMsg);
}

function collectAlbumItems(
  msgs: ChatMessage[],
  state: AppState,
  mobileUi: boolean,
  startIdx: number,
  endIdx: number,
  albumMax: number,
  albumGapSeconds: number
): AlbumItem[] | null {
  const first = msgs[startIdx];
  if (!first) return null;
  const info = getFileAttachmentInfo(state, first, { mobileUi });
  if (!isAlbumCandidate(first, info)) return null;

  const group: AlbumItem[] = [{ idx: startIdx, msg: first, info }];
  const sameDay = dayKey(first.ts);
  let groupCaption = extractFileCaptionText(first.text) || null;
  let scan = startIdx + 1;
  while (scan < endIdx) {
    const next = msgs[scan];
    if (!next || dayKey(next.ts) !== sameDay) break;
    const nextInfo = getFileAttachmentInfo(state, next, { mobileUi });
    if (!isAlbumCandidate(next, nextInfo)) break;
    if (!isMessageContinuation(group[group.length - 1].msg, next, { maxGapSeconds: albumGapSeconds })) break;
    const nextCaption = extractFileCaptionText(next.text);
    if (groupCaption && nextCaption && nextCaption !== groupCaption) break;
    if (!groupCaption && nextCaption) groupCaption = nextCaption;
    group.push({ idx: scan, msg: next, info: nextInfo });
    scan += 1;
    if (group.length >= albumMax) break;
  }
  return group;
}

export function buildHistoryLayoutBlocks(opts: BuildHistoryLayoutBlocksOptions): HistoryLayoutBlock[] {
  const msgs = Array.isArray(opts.msgs) ? opts.msgs : [];
  const blocks: HistoryLayoutBlock[] = [];
  if (!msgs.length) return blocks;

  const albumMin = Math.max(2, Math.trunc(opts.albumMin ?? 2));
  const albumMax = Math.max(albumMin, Math.trunc(opts.albumMax ?? 12));
  const albumGapSeconds = Math.max(10, Math.trunc(opts.albumGapSeconds ?? 121));
  let prevDay = "";
  let prevMsg: ChatMessage | null = null;

  if (opts.virtualStart > 0) {
    const prev = msgs[opts.virtualStart - 1];
    if (prev) {
      prevDay = dayKey(prev.ts);
      prevMsg = prev.kind === "sys" ? null : prev;
    }
  }

  for (let msgIdx = opts.virtualStart; msgIdx < opts.virtualEnd; msgIdx += 1) {
    const msg = msgs[msgIdx];
    if (!msg) continue;
    const dk = dayKey(msg.ts);
    if (dk && dk !== prevDay) {
      prevDay = dk;
      blocks.push({ kind: "date", ts: msg.ts });
      prevMsg = null;
    }
    if (msgIdx === opts.unreadInsertIdx) {
      blocks.push({ kind: "unread", unreadCount: opts.unreadCount });
      prevMsg = null;
    }

    const albumItems = collectAlbumItems(msgs, opts.state, opts.mobileUi, msgIdx, opts.virtualEnd, albumMax, albumGapSeconds);
    if (albumItems && albumItems.length >= albumMin) {
      const first = albumItems[0]?.msg;
      const last = albumItems[albumItems.length - 1];
      blocks.push({
        kind: "album",
        startIdx: albumItems[0].idx,
        endIdx: last.idx,
        items: albumItems,
        continues: Boolean(first && first.kind !== "sys" && isMessageContinuation(prevMsg, first)),
        tail: Boolean(!opts.boardUi && last.msg.kind !== "sys" && isGroupTail(msgs, last.idx, last.msg, opts.unreadInsertIdx)),
      });
      prevMsg = last.msg.kind === "sys" ? null : last.msg;
      msgIdx = last.idx;
      continue;
    }

    blocks.push({
      kind: "message",
      msgIdx,
      continues: Boolean(msg.kind !== "sys" && isMessageContinuation(prevMsg, msg)),
      tail: Boolean(!opts.boardUi && msg.kind !== "sys" && isGroupTail(msgs, msgIdx, msg, opts.unreadInsertIdx)),
    });
    prevMsg = msg.kind === "sys" ? null : msg;
  }

  return blocks;
}
