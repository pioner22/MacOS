import type { GatewayTransport } from "../../lib/net/gatewayClient";
import type { AppState, ChatMessage, ConversationHistoryEmptyNotice, OutboxEntry } from "../../stores/types";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { applyConversationHistorySyncState, getConversationHistorySyncState } from "../../helpers/chat/historySync";
import { shiftVirtualStartForPrepend } from "../../helpers/chat/historyViewportCoordinator";
import { mergeMessages, prependedCount } from "../../helpers/chat/mergeMessages";
import { removeOutboxEntry } from "../../helpers/chat/outbox";
import { deleteHistoryMessageById, ingestHistoryResult } from "../../helpers/chat/historyIdb";
import { removeCachedFileBlob } from "../../helpers/files/fileBlobCache";
import { applyFileTransferSnapshot, applyOutboxSnapshot } from "../../helpers/runtime/deliverySync";
import { nowTs } from "../../helpers/time";
import { saveLastReadMarkers } from "../../helpers/ui/lastReadMarkers";
import { oldestLoadedId, parseAttachment, parseMessageRef, parseReactions } from "./common";

function debugHook(kind: string, data?: any) {
  try {
    const dbg = (globalThis as any).__yagodka_debug_monitor;
    if (!dbg || typeof dbg.push !== "function") return;
    dbg.push(String(kind || "history").trim() || "history", data);
  } catch {
    // ignore
  }
}

function deletedHistoryEmptyNotice(scope: ConversationHistoryEmptyNotice["scope"], deletedCount: number): ConversationHistoryEmptyNotice {
  return {
    kind: "cleared",
    scope,
    by: null,
    at: Date.now(),
    deleted: deletedCount > 0 ? deletedCount : null,
  };
}

function attachmentFileId(msg: ChatMessage | null | undefined): string {
  const attachment = msg?.attachment;
  if (!attachment || attachment.kind !== "file") return "";
  return typeof attachment.fileId === "string" ? attachment.fileId.trim() : "";
}

function pruneDeletedMessagesForConversation(
  prev: AppState,
  key: string,
  deletedIds: ReadonlySet<number>,
  detachedFileIds: string[]
): AppState {
  if (!deletedIds.size) return prev;
  const conv = prev.conversations?.[key];
  if (!Array.isArray(conv) || !conv.length) return prev;
  const removed = conv.filter((msg) => typeof msg?.id === "number" && deletedIds.has(msg.id));
  if (!removed.length) return prev;
  const nextConv = conv.filter((msg) => !(typeof msg?.id === "number" && deletedIds.has(msg.id)));

  let nextTransfers = prev.fileTransfers;
  let nextThumbs = prev.fileThumbs;
  const removedFileIds = [...new Set(removed.map((msg) => attachmentFileId(msg)).filter(Boolean))];
  for (const removedFileId of removedFileIds) {
    let stillReferenced = false;
    for (const [convKey, messages] of Object.entries(prev.conversations || {})) {
      const list = convKey === key ? nextConv : messages;
      if (!Array.isArray(list) || !list.length) continue;
      if (list.some((msg) => attachmentFileId(msg) === removedFileId)) {
        stillReferenced = true;
        break;
      }
    }
    if (stillReferenced) continue;
    detachedFileIds.push(removedFileId);
    nextTransfers = nextTransfers.filter((entry) => {
      const match = String(entry.id || "").trim() === removedFileId;
      if (!match) return true;
      if (entry.url && entry.url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(entry.url);
        } catch {
          // ignore
        }
      }
      return false;
    });
    const existingThumb = nextThumbs?.[removedFileId] || null;
    if (existingThumb) {
      if (existingThumb.url && existingThumb.url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(existingThumb.url);
        } catch {
          // ignore
        }
      }
      nextThumbs = { ...(nextThumbs || {}) };
      delete nextThumbs[removedFileId];
    }
  }

  const pinnedIds = prev.pinnedMessages?.[key];
  const removedPinnedIds = removed
    .map((msg) => (typeof msg.id === "number" ? msg.id : 0))
    .filter((id) => id > 0);
  let nextPinnedMessages = prev.pinnedMessages;
  let nextPinnedActive = prev.pinnedMessageActive;
  if (Array.isArray(pinnedIds) && pinnedIds.some((id) => removedPinnedIds.includes(id))) {
    nextPinnedMessages = { ...prev.pinnedMessages };
    nextPinnedActive = { ...prev.pinnedMessageActive };
    const nextList = pinnedIds.filter((id) => !deletedIds.has(id));
    if (nextList.length) {
      nextPinnedMessages[key] = nextList;
      if (!nextList.includes(nextPinnedActive[key])) nextPinnedActive[key] = nextList[0];
    } else {
      delete nextPinnedMessages[key];
      delete nextPinnedActive[key];
    }
  }

  const editingRemoved =
    Boolean(prev.editing && prev.editing.key === key && typeof prev.editing.id === "number" && deletedIds.has(prev.editing.id));
  const next: AppState = applyFileTransferSnapshot(
    {
      ...prev,
      conversations: { ...prev.conversations, [key]: nextConv },
      fileThumbs: nextThumbs,
      pinnedMessages: nextPinnedMessages,
      pinnedMessageActive: nextPinnedActive,
    },
    nextTransfers,
    { source: "server", reconcilePending: false }
  );
  if (editingRemoved) {
    return { ...next, editing: null, input: prev.editing?.prevDraft || "" };
  }
  return next;
}

export function handleHistoryServerMessage(
  t: string,
  msg: any,
  state: AppState,
  _gateway: GatewayTransport,
  patch: (p: Partial<AppState> | ((prev: AppState) => AppState)) => void
): boolean {
  if (t !== "history_result") return false;

  const resultRoom = msg?.room ? String(msg.room) : undefined;
  const resultPeer = msg?.peer ? String(msg.peer) : undefined;
  const key = resultRoom ? roomKey(resultRoom) : resultPeer ? dmKey(resultPeer) : "";
  if (!key) return true;

  const isPreview = Boolean(msg?.preview);
  const deletedIds = Array.isArray(msg?.deleted_ids)
    ? msg.deleted_ids
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isFinite(value) && value > 0)
        .map((value: number) => Math.trunc(value))
    : [];
  const deletedIdSet = deletedIds.length ? new Set<number>(deletedIds) : null;
  const beforeIdRaw = msg?.before_id;
  const hasBefore = beforeIdRaw !== undefined && beforeIdRaw !== null;
  const beforeIdValue = hasBefore ? Number(beforeIdRaw) : NaN;
  const sinceIdRaw = msg?.since_id;
  const sinceId = typeof sinceIdRaw === "number" && Number.isFinite(sinceIdRaw) ? Math.trunc(sinceIdRaw) : Math.trunc(Number(sinceIdRaw) || 0);
  const readUpToRaw = msg?.read_up_to_id;
  const readUpToId = Number(readUpToRaw);
  const rows = Array.isArray(msg?.rows) ? msg.rows : [];
  const rawHasMore = msg?.has_more;
  const shouldSetHasMore = hasBefore || rawHasMore !== undefined;

  // For history since_id server often doesn't send has_more: don't overwrite the flag to avoid blocking prefetch.
  const hasMore = rawHasMore !== undefined && rawHasMore !== null ? Boolean(rawHasMore) : hasBefore ? rows.length > 0 : false;

  const incoming: ChatMessage[] = [];
  for (const r of rows) {
    const from = String(r?.from ?? "");
    if (!from) continue;
    const to = r?.to ? String(r.to) : undefined;
    const room = resultRoom ? resultRoom : r?.room ? String(r.room) : undefined;
    const text = String(r?.text ?? "");
    const ts = Number(r?.ts ?? nowTs()) || nowTs();
    const id = r?.id === undefined || r?.id === null ? null : Number(r.id);
    if (typeof id === "number" && Number.isFinite(id) && deletedIdSet?.has(Math.trunc(id))) continue;
    const kind: ChatMessage["kind"] = from === state.selfId ? "out" : "in";
    const hasId = typeof id === "number" && Number.isFinite(id);
    const delivered = Boolean(r?.delivered);
    const read = Boolean(r?.read);
    const edited = Boolean(r?.edited);
    const editedTsRaw = (r as any)?.edited_ts;
    const edited_ts = typeof editedTsRaw === "number" && Number.isFinite(editedTsRaw) ? editedTsRaw : undefined;
    const status: ChatMessage["status"] | undefined = !room && kind === "out" && hasId ? (read ? "read" : delivered ? "sent" : "queued") : undefined;
    const attachment = parseAttachment(r?.attachment);
    const reply = parseMessageRef((r as any)?.reply);
    const forward = parseMessageRef((r as any)?.forward);
    const reactions = parseReactions((r as any)?.reactions);
    incoming.push({
      kind,
      from,
      to,
      room,
      text,
      ts,
      id,
      attachment,
      ...(reply ? { reply } : {}),
      ...(forward ? { forward } : {}),
      ...(reactions ? { reactions } : {}),
      ...(status ? { status } : {}),
      ...(edited ? { edited: true } : {}),
      ...(edited && edited_ts ? { edited_ts } : {}),
    });
  }

  // Persist full history into IndexedDB (best-effort, async).
  try {
    const metaBefore = hasBefore ? (Number.isFinite(beforeIdValue) ? Math.trunc(beforeIdValue) : 0) : null;
    const metaHasMore =
      rawHasMore === undefined || rawHasMore === null
        ? hasBefore && rows.length === 0
          ? false
          : null
        : Boolean(rawHasMore);
    void ingestHistoryResult(state.selfId, key, incoming, {
      beforeId: metaBefore,
      hasMore: metaHasMore,
      preview: isPreview,
      sinceId: sinceId > 0 ? sinceId : null,
    });
  } catch {
    // ignore
  }

  if (deletedIdSet?.size) {
    const detachedFileIds: string[] = [];
    patch((prev) => pruneDeletedMessagesForConversation(prev, key, deletedIdSet, detachedFileIds));
    try {
      const uid = String(state.selfId || "").trim();
      if (uid) {
        for (const msgId of deletedIdSet) {
          void deleteHistoryMessageById(uid, msgId);
        }
        for (const fid of detachedFileIds) {
          void removeCachedFileBlob(uid, fid);
          void removeCachedFileBlob(uid, `thumb:${fid}`);
        }
      }
    } catch {
      // ignore
    }
  }

  patch((prev) => {
    const initialConv = prev.conversations[key] ?? [];
    let baseConv = initialConv;
    let outbox = (((prev as any).outbox || {}) as any) as any;
    let nextLastRead = prev.lastRead;
    let lastReadChanged = false;

    // Best-effort dedup for reconnect: if history already contains our message, bind it to a pending outbox entry
    // (so we don't resend and we don't show duplicates).
    const pendingRaw = outbox[key];
    const pending: OutboxEntry[] = Array.isArray(pendingRaw) ? pendingRaw : [];
    if (pending.length && incoming.length) {
      const left = [...pending];
      let conv = baseConv;
      let changed = false;
      for (const inc of incoming) {
        if (inc.kind !== "out") continue;
        const incId = typeof inc.id === "number" && Number.isFinite(inc.id) && inc.id > 0 ? inc.id : null;
        if (incId === null) continue;
        if (inc.attachment) continue;
        const text = String(inc.text || "");
        if (!text) continue;

        let bestIdx = -1;
        let bestDelta = Infinity;
        for (let i = 0; i < left.length; i += 1) {
          const e = left[i];
          if (!e) continue;
          if (e.text !== text) continue;
          if (e.to && inc.to && e.to !== inc.to) continue;
          if (e.room && inc.room && e.room !== inc.room) continue;
          const delta = Math.abs(Number(e.ts) - Number(inc.ts));
          if (!Number.isFinite(delta) || delta > 12) continue;
          if (delta < bestDelta) {
            bestDelta = delta;
            bestIdx = i;
          }
        }
        if (bestIdx < 0) continue;
        const matched = left[bestIdx];
        left.splice(bestIdx, 1);
        const lid = typeof matched.localId === "string" ? matched.localId : "";
        if (!lid) continue;

        const idx = conv.findIndex(
          (m) => m.kind === "out" && (m.id === undefined || m.id === null) && typeof m.localId === "string" && m.localId === lid
        );
        if (idx >= 0) {
          const next = [...conv];
          next[idx] = { ...next[idx], id: incId, status: inc.status ?? next[idx].status, ts: inc.ts };
          conv = next;
          changed = true;
        }
        outbox = removeOutboxEntry(outbox, key, lid);
      }
      if (changed) baseConv = conv;
    }

    // Background backfill: for non-selected chats, avoid growing in-memory conversation arrays when
    // we fetch older pages (before_id>0). Persisted in IDB above, so keeping it in RAM is wasteful.
    const selected = (prev as any).selected;
    const selectedKey = selected ? (selected.kind === "dm" ? dmKey(String(selected.id || "")) : roomKey(String(selected.id || ""))) : "";
    const isSelected = Boolean(selectedKey && selectedKey === key);
    const suppressMerge = !isPreview && hasBefore && Number.isFinite(beforeIdValue) && beforeIdValue > 0 && !isSelected;

    if (suppressMerge) {
      if (resultRoom && Number.isFinite(readUpToId) && readUpToId > 0) {
        const prevEntry = (nextLastRead || {})[key] || {};
        if (!prevEntry.id || readUpToId > prevEntry.id) {
          const merged = { ...(nextLastRead || {}), [key]: { ...prevEntry, id: readUpToId } };
          nextLastRead = merged;
          lastReadChanged = true;
          if (prev.selfId) saveLastReadMarkers(prev.selfId, merged);
        }
      }

      const base = applyOutboxSnapshot(
        {
          ...prev,
          ...(baseConv !== initialConv ? { conversations: { ...prev.conversations, [key]: baseConv } } : {}),
        },
        outbox,
        { source: "server", reconcilePending: false }
      );
      const synced = getConversationHistorySyncState(prev, key).loading
        ? applyConversationHistorySyncState(base, key, { loading: false })
        : base;
      return lastReadChanged ? { ...synced, lastRead: nextLastRead } : synced;
    }

    const nextConv = mergeMessages(baseConv, incoming);
    const delta = nextConv.length - baseConv.length;
    const actualPrependCount = hasBefore ? prependedCount(baseConv, nextConv) : null;
    const cursor = oldestLoadedId(nextConv);
    const prevSync = getConversationHistorySyncState(prev, key);
    const prevCursorValueFromSync = prevSync.cursor;
    const prevVirtualStart = (prev as any).historyVirtualStart ? (prev as any).historyVirtualStart[key] : undefined;

    const prevCursorValue = typeof prevCursorValueFromSync === "number" ? prevCursorValueFromSync : NaN;
    const isStaleBeforeResponse =
      hasBefore &&
      Number.isFinite(beforeIdValue) &&
      beforeIdValue > 0 &&
      Number.isFinite(prevCursorValue) &&
      prevCursorValue > 0 &&
      beforeIdValue > prevCursorValue;

    const cursorStalled =
      hasBefore &&
      !isStaleBeforeResponse &&
      delta <= 0 &&
      cursor !== null &&
      Number.isFinite(prevCursorValue) &&
      prevCursorValue > 0 &&
      cursor === prevCursorValue;

    const prependShift =
      hasBefore && actualPrependCount !== null && actualPrependCount >= 0 ? actualPrependCount : delta;
    const nextVirtualStart = hasBefore && !isStaleBeforeResponse ? shiftVirtualStartForPrepend(prevVirtualStart, prependShift) : null;
    const shouldShiftVirtual = nextVirtualStart !== null && nextVirtualStart !== prevVirtualStart;

    if (resultRoom && Number.isFinite(readUpToId) && readUpToId > 0) {
      const prevEntry = (nextLastRead || {})[key] || {};
      if (!prevEntry.id || readUpToId > prevEntry.id) {
        const merged = { ...(nextLastRead || {}), [key]: { ...prevEntry, id: readUpToId } };
        nextLastRead = merged;
        lastReadChanged = true;
        if (prev.selfId) saveLastReadMarkers(prev.selfId, merged);
      }
    }

    try {
      debugHook("history.apply", {
        key,
        rows: rows.length,
        before_id: hasBefore ? (Number.isFinite(beforeIdValue) ? beforeIdValue : String(beforeIdRaw)) : null,
        stale_before: isStaleBeforeResponse,
        delta,
        prepend_shift: prependShift,
        cursor,
        prev_cursor: Number.isFinite(prevCursorValue) ? prevCursorValue : null,
        cursor_stalled: cursorStalled,
        has_more_in: rawHasMore !== undefined ? Boolean(rawHasMore) : null,
        has_more_effective: cursorStalled ? false : hasMore,
      });
    } catch {
      // ignore
    }

    if (isPreview) {
      const base = applyConversationHistorySyncState(
        applyOutboxSnapshot(
          {
            ...prev,
            conversations: { ...prev.conversations, [key]: nextConv },
          },
          outbox,
          { source: "server", reconcilePending: false }
        ),
        key,
        {
        previewOnly: true,
        source: "cache",
        reconcilePending: true,
      });
      return lastReadChanged ? { ...base, lastRead: nextLastRead } : base;
    }

    // Any non-preview server history response confirms the conversation state well enough
    // to stop treating IndexedDB-restored media rows as provisional placeholders.
    const shouldClearPreviewOnly = true;
    const resolvedHasMore = cursorStalled ? false : hasMore;
    const shouldUpdateHasMore = shouldSetHasMore && !isStaleBeforeResponse;

    const base = applyConversationHistorySyncState(
      applyOutboxSnapshot(
        {
          ...prev,
          conversations: { ...prev.conversations, [key]: nextConv },
          ...(shouldShiftVirtual ? { historyVirtualStart: { ...(prev as any).historyVirtualStart, [key]: nextVirtualStart } } : {}),
        },
        outbox,
        { source: "server", reconcilePending: false }
      ),
      key,
      {
      loaded: true,
      previewOnly: shouldClearPreviewOnly ? false : prevSync.previewOnly,
      cursor,
      hasMore: shouldUpdateHasMore ? Boolean(resolvedHasMore) : prevSync.hasMore,
      loading: false,
      source: "server",
      reconcilePending: false,
      lastServerAt: Date.now(),
      emptyNotice: incoming.length
        ? null
        : nextConv.length === 0 && deletedIds.length
          ? deletedHistoryEmptyNotice(resultRoom ? "room" : "dm", deletedIds.length)
          : prevSync.emptyNotice,
      virtualStart: shouldShiftVirtual && nextVirtualStart !== null ? nextVirtualStart : prevVirtualStart,
    });
    return lastReadChanged ? { ...base, lastRead: nextLastRead } : base;
  });
  return true;
}
