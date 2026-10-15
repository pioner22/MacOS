import { saveDraftsForUser } from "../../../helpers/chat/drafts";
import { saveHistoryCacheForUser } from "../../../helpers/chat/historyCache";
import { mergeMessages } from "../../../helpers/chat/mergeMessages";
import { saveOutboxForUser } from "../../../helpers/chat/outbox";
import { savePinnedMessagesForUser } from "../../../helpers/chat/pinnedMessages";
import { saveFileTransfersForUser } from "../../../helpers/files/fileTransferHistory";
import { syncOutboxToServiceWorker } from "../../../helpers/pwa/outboxSync";
import { shouldPersistRuntimeDeliveryDomain, shouldSyncOutboxToWorker } from "../../../helpers/runtime/deliveryCoordinator";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

let draftsSaveTimer: number | null = null;
let pinnedMessagesSaveTimer: number | null = null;
let fileTransfersSaveTimer: number | null = null;
let outboxSaveTimer: number | null = null;
let outboxSwReadyForUser: string | null = null;
let historyCacheSaveTimer: number | null = null;

export function setOutboxSwReadyForUser(userId: string | null) {
  outboxSwReadyForUser = userId ? String(userId || "").trim() || null : null;
}

export function scheduleSaveDrafts(store: Store<AppState>) {
  if (draftsSaveTimer !== null) {
    window.clearTimeout(draftsSaveTimer);
    draftsSaveTimer = null;
  }
  draftsSaveTimer = window.setTimeout(() => {
    draftsSaveTimer = null;
    try {
      const st = store.get();
      if (!shouldPersistRuntimeDeliveryDomain(st, "drafts") || !st.selfId) return;
      saveDraftsForUser(st.selfId, st.drafts);
    } catch {
      // ignore
    }
  }, 420);
}

export function flushDrafts(store: Store<AppState>) {
  if (draftsSaveTimer !== null) {
    window.clearTimeout(draftsSaveTimer);
    draftsSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!shouldPersistRuntimeDeliveryDomain(st, "drafts") || !st.selfId) return;
    saveDraftsForUser(st.selfId, st.drafts);
  } catch {
    // ignore
  }
}

export function scheduleSaveOutbox(store: Store<AppState>) {
  if (outboxSaveTimer !== null) {
    window.clearTimeout(outboxSaveTimer);
    outboxSaveTimer = null;
  }
  outboxSaveTimer = window.setTimeout(() => {
    outboxSaveTimer = null;
    try {
      const st = store.get();
      if (!shouldPersistRuntimeDeliveryDomain(st, "outbox") || !st.selfId) return;
      saveOutboxForUser(st.selfId, st.outbox);
      if (shouldSyncOutboxToWorker(st, outboxSwReadyForUser)) {
        void syncOutboxToServiceWorker(st.selfId, st.outbox);
      }
    } catch {
      // ignore
    }
  }, 420);
}

export function flushOutbox(store: Store<AppState>) {
  if (outboxSaveTimer !== null) {
    window.clearTimeout(outboxSaveTimer);
    outboxSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!shouldPersistRuntimeDeliveryDomain(st, "outbox") || !st.selfId) return;
    saveOutboxForUser(st.selfId, st.outbox);
    if (shouldSyncOutboxToWorker(st, outboxSwReadyForUser)) {
      void syncOutboxToServiceWorker(st.selfId, st.outbox);
    }
  } catch {
    // ignore
  }
}

export function scheduleSaveHistoryCache(store: Store<AppState>) {
  if (historyCacheSaveTimer !== null) {
    window.clearTimeout(historyCacheSaveTimer);
    historyCacheSaveTimer = null;
  }
  historyCacheSaveTimer = window.setTimeout(() => {
    historyCacheSaveTimer = null;
    try {
      const st = store.get();
      if (!st.authed || !st.selfId) return;
      saveHistoryCacheForUser(st.selfId, {
        conversations: st.conversations,
        historySync: st.historySync,
        historyCursor: st.historyCursor,
        historyHasMore: st.historyHasMore,
        historyLoaded: st.historyLoaded,
      });
    } catch {
      // ignore
    }
  }, 650);
}

export function flushHistoryCache(store: Store<AppState>) {
  if (historyCacheSaveTimer !== null) {
    window.clearTimeout(historyCacheSaveTimer);
    historyCacheSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    saveHistoryCacheForUser(st.selfId, {
      conversations: st.conversations,
      historySync: st.historySync,
      historyCursor: st.historyCursor,
      historyHasMore: st.historyHasMore,
      historyLoaded: st.historyLoaded,
    });
  } catch {
    // ignore
  }
}

export function mergeConversationMaps(
  base: Record<string, ChatMessage[]>,
  incoming: Record<string, ChatMessage[]>
): Record<string, ChatMessage[]> {
  const next: Record<string, ChatMessage[]> = { ...base };
  for (const [key, list] of Object.entries(incoming || {})) {
    const current = Array.isArray(list) ? list : [];
    if (!current.length) continue;
    const cached = next[key];
    next[key] = Array.isArray(cached) && cached.length ? mergeMessages(cached, current) : current;
  }
  return next;
}

export function scheduleSavePinnedMessages(store: Store<AppState>) {
  if (pinnedMessagesSaveTimer !== null) {
    window.clearTimeout(pinnedMessagesSaveTimer);
    pinnedMessagesSaveTimer = null;
  }
  pinnedMessagesSaveTimer = window.setTimeout(() => {
    pinnedMessagesSaveTimer = null;
    try {
      const st = store.get();
      if (!st.authed || !st.selfId) return;
      savePinnedMessagesForUser(st.selfId, st.pinnedMessages);
    } catch {
      // ignore
    }
  }, 420);
}

export function flushPinnedMessages(store: Store<AppState>) {
  if (pinnedMessagesSaveTimer !== null) {
    window.clearTimeout(pinnedMessagesSaveTimer);
    pinnedMessagesSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    savePinnedMessagesForUser(st.selfId, st.pinnedMessages);
  } catch {
    // ignore
  }
}

export function scheduleSaveFileTransfers(store: Store<AppState>) {
  if (fileTransfersSaveTimer !== null) {
    window.clearTimeout(fileTransfersSaveTimer);
    fileTransfersSaveTimer = null;
  }
  fileTransfersSaveTimer = window.setTimeout(() => {
    fileTransfersSaveTimer = null;
    try {
      const st = store.get();
      if (!shouldPersistRuntimeDeliveryDomain(st, "fileTransfers") || !st.selfId) return;
      saveFileTransfersForUser(st.selfId, st.fileTransfers);
    } catch {
      // ignore
    }
  }, 650);
}

export function flushFileTransfers(store: Store<AppState>) {
  if (fileTransfersSaveTimer !== null) {
    window.clearTimeout(fileTransfersSaveTimer);
    fileTransfersSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!shouldPersistRuntimeDeliveryDomain(st, "fileTransfers") || !st.selfId) return;
    saveFileTransfersForUser(st.selfId, st.fileTransfers);
  } catch {
    // ignore
  }
}

export function flushRuntimeDelivery(
  store: Store<AppState>,
  opts?: { drafts?: boolean; outbox?: boolean; fileTransfers?: boolean }
) {
  const flushDraftsEnabled = opts?.drafts !== false;
  const flushOutboxEnabled = opts?.outbox !== false;
  const flushFileTransfersEnabled = opts?.fileTransfers !== false;
  if (flushDraftsEnabled) flushDrafts(store);
  if (flushOutboxEnabled) flushOutbox(store);
  if (flushFileTransfersEnabled) flushFileTransfers(store);
}
