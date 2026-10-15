import { loadArchivedForUser } from "../../../helpers/chat/archives";
import { conversationKey } from "../../../helpers/chat/conversationKey";
import { loadDraftsForUser } from "../../../helpers/chat/drafts";
import { loadChatFoldersForUser } from "../../../helpers/chat/folders";
import { loadHistoryCacheForUser } from "../../../helpers/chat/historyCache";
import { loadOutboxForUser } from "../../../helpers/chat/outbox";
import { loadPinnedMessagesForUser, mergePinnedMessagesMaps } from "../../../helpers/chat/pinnedMessages";
import { loadPinnedBarHiddenForUser } from "../../../helpers/chat/pinnedBarHidden";
import { loadPinsForUser } from "../../../helpers/chat/pins";
import { loadBoardScheduleForUser } from "../../../helpers/boards/boardSchedule";
import { loadFileTransfersForUser } from "../../../helpers/files/fileTransferHistory";
import {
  applyDraftMapSnapshot,
  applyFileTransferSnapshot,
  applyOutboxSnapshot,
} from "../../../helpers/runtime/deliverySync";
import {
  mergeRestoredFileTransfers,
  shouldReconcileFileTransfersFromCache,
  shouldReconcileOutboxFromWorker,
} from "../../../helpers/runtime/deliveryCoordinator";
import { applySidebarFolderSnapshot } from "../../../helpers/sidebar/sidebarState";
import type { Store } from "../../../stores/store";
import type { AppState, OutboxEntry } from "../../../stores/types";
import { mergeConversationMaps, scheduleSaveOutbox } from "./localPersistenceTimers";

type LoadedForUserState = {
  drafts: string | null;
  pins: string | null;
  archives: string | null;
  chatFolders: string | null;
  pinnedMessages: string | null;
  pinnedBarHidden: string | null;
  fileTransfers: string | null;
  outbox: string | null;
  boardSchedule: string | null;
  historyCache: string | null;
};

type UserLocalStateHydrationOptions = {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  autosizeInput: (input: HTMLTextAreaElement) => void;
  armBoardScheduleTimer: () => void;
  syncOutboxFromServiceWorker: (userId: string) => void | Promise<void>;
};

export type UserLocalStateHydrationFeature = {
  resetLoadedForUser: () => void;
  maybeHydrateLocalState: () => boolean;
  isHistoryCacheLoadedFor: (userId: string) => boolean;
};

function createLoadedForUserState(): LoadedForUserState {
  return {
    drafts: null,
    pins: null,
    archives: null,
    chatFolders: null,
    pinnedMessages: null,
    pinnedBarHidden: null,
    fileTransfers: null,
    outbox: null,
    boardSchedule: null,
    historyCache: null,
  };
}

export function createUserLocalStateHydrationFeature(
  opts: UserLocalStateHydrationOptions
): UserLocalStateHydrationFeature {
  const { store, input, autosizeInput, armBoardScheduleTimer, syncOutboxFromServiceWorker } = opts;
  let loadedForUser = createLoadedForUserState();

  const resetLoadedForUser = () => {
    loadedForUser = createLoadedForUserState();
  };

  const isHistoryCacheLoadedFor = (userId: string): boolean => {
    const id = String(userId || "").trim();
    return Boolean(id) && loadedForUser.historyCache === id;
  };

  const maybeHydrateLocalState = (): boolean => {
    const st = store.get();
    if (!st.authed || !st.selfId) return false;

    const userId = st.selfId;
    const needDrafts = loadedForUser.drafts !== userId;
    const needPins = loadedForUser.pins !== userId;
    const needArchived = loadedForUser.archives !== userId;
    const needChatFolders = loadedForUser.chatFolders !== userId;
    const needPinnedMessages = loadedForUser.pinnedMessages !== userId;
    const needPinnedBarHidden = loadedForUser.pinnedBarHidden !== userId;
    const needFileTransfers = loadedForUser.fileTransfers !== userId;
    const needOutbox = loadedForUser.outbox !== userId;
    const needBoardSchedule = loadedForUser.boardSchedule !== userId;
    const needHistoryCache = loadedForUser.historyCache !== userId;

    if (
      !needDrafts &&
      !needPins &&
      !needArchived &&
      !needChatFolders &&
      !needPinnedMessages &&
      !needPinnedBarHidden &&
      !needFileTransfers &&
      !needOutbox &&
      !needBoardSchedule &&
      !needHistoryCache
    ) {
      return false;
    }

    if (needDrafts) loadedForUser.drafts = userId;
    if (needPins) loadedForUser.pins = userId;
    if (needArchived) loadedForUser.archives = userId;
    if (needChatFolders) loadedForUser.chatFolders = userId;
    if (needPinnedMessages) loadedForUser.pinnedMessages = userId;
    if (needPinnedBarHidden) loadedForUser.pinnedBarHidden = userId;
    if (needFileTransfers) loadedForUser.fileTransfers = userId;
    if (needOutbox) loadedForUser.outbox = userId;
    if (needBoardSchedule) loadedForUser.boardSchedule = userId;
    if (needHistoryCache) loadedForUser.historyCache = userId;

    const storedDrafts = needDrafts ? loadDraftsForUser(userId) : {};
    const mergedDrafts = needDrafts ? { ...storedDrafts, ...st.drafts } : st.drafts;

    const storedPins = needPins ? loadPinsForUser(userId) : [];
    const mergedPins = needPins ? [...st.pinned, ...storedPins.filter((x) => !st.pinned.includes(x))] : st.pinned;

    const storedArchived = needArchived ? loadArchivedForUser(userId) : [];
    const mergedArchived = needArchived ? [...st.archived, ...storedArchived.filter((x) => !st.archived.includes(x))] : st.archived;

    const storedFoldersSnap = needChatFolders ? loadChatFoldersForUser(userId) : null;
    const mergedChatFolders = (() => {
      if (!needChatFolders || !storedFoldersSnap) return st.chatFolders;
      const byId = new Map(st.chatFolders.map((f) => [f.id, f]));
      for (const f of storedFoldersSnap.folders) {
        if (!byId.has(f.id)) byId.set(f.id, f);
      }
      return Array.from(byId.values());
    })();
    const mergedFolderId = (() => {
      const cur = String(st.sidebarFolderId || "").trim().toLowerCase();
      if (cur && cur !== "all") return cur;
      const fromStore = storedFoldersSnap ? String(storedFoldersSnap.active || "").trim().toLowerCase() : "";
      return fromStore && fromStore !== "all" ? fromStore : "all";
    })();

    const storedPinnedMessages = needPinnedMessages ? loadPinnedMessagesForUser(userId) : {};
    const mergedPinnedMessages = needPinnedMessages ? mergePinnedMessagesMaps(storedPinnedMessages, st.pinnedMessages) : st.pinnedMessages;

    const storedPinnedBarHidden = needPinnedBarHidden ? loadPinnedBarHiddenForUser(userId) : {};
    const mergedPinnedBarHidden = needPinnedBarHidden ? { ...storedPinnedBarHidden, ...st.pinnedBarHidden } : st.pinnedBarHidden;

    const storedHistory = needHistoryCache ? loadHistoryCacheForUser(userId) : null;
    const historyCacheConversations = storedHistory ? storedHistory.conversations : {};
    const mergedHistorySync = (() => {
      if (!storedHistory) return st.historySync;
      return { ...storedHistory.historySync, ...(st.historySync || {}) };
    })();
    const mergedHistoryCursor = storedHistory ? { ...storedHistory.historyCursor, ...st.historyCursor } : st.historyCursor;
    const mergedHistoryHasMore = (() => {
      const merged = { ...(st.historyHasMore || {}) };
      if (!storedHistory) return merged;
      const cached = storedHistory.historyHasMore || {};
      for (const [key, value] of Object.entries(cached)) {
        if (Object.prototype.hasOwnProperty.call(st.historyHasMore, key)) continue;
        if (value === true) {
          merged[key] = true;
        }
      }
      return merged;
    })();
    const mergedHistoryLoaded = storedHistory ? { ...st.historyLoaded, ...storedHistory.historyLoaded } : st.historyLoaded;
    const mergedHistoryPreviewOnly = (() => {
      const merged = { ...(st.historyPreviewOnly || {}) };
      if (!storedHistory) return merged;
      for (const [key, item] of Object.entries(storedHistory.historySync || {})) {
        if (item?.previewOnly) merged[key] = true;
      }
      return merged;
    })();
    const baseConversations = storedHistory ? mergeConversationMaps(historyCacheConversations, st.conversations) : st.conversations;

    const shouldRestoreFileTransfers = needFileTransfers && shouldReconcileFileTransfersFromCache(st, userId);
    const storedFileTransfers = shouldRestoreFileTransfers ? loadFileTransfersForUser(userId) : [];
    const mergedFileTransfers = needFileTransfers ? mergeRestoredFileTransfers(st.fileTransfers, storedFileTransfers) : st.fileTransfers;

    const storedOutboxRaw = needOutbox ? loadOutboxForUser(userId) : {};
    const storedOutbox = (() => {
      if (!needOutbox) return st.outbox;
      const out: typeof st.outbox = {};
      for (const [k, list] of Object.entries(storedOutboxRaw || {})) {
        const arr = Array.isArray(list) ? list : [];
        const normalized = arr
          .map((e) => {
            const status: OutboxEntry["status"] = e?.status === "sent" ? "sent" : "queued";
            return { ...e, status };
          })
          .filter((e) => typeof e.localId === "string" && Boolean(e.localId.trim()));
        if (normalized.length) out[k] = normalized;
      }
      return out;
    })();

    const mergedOutbox = (() => {
      if (!needOutbox) return st.outbox;
      const out: typeof st.outbox = { ...storedOutbox };
      for (const [k, list] of Object.entries(st.outbox || {})) {
        const base = Array.isArray(out[k]) ? out[k] : [];
        const seen = new Set(base.map((e) => String(e.localId || "").trim()).filter(Boolean));
        const extras = (Array.isArray(list) ? list : []).filter((e) => {
          const lid = typeof e?.localId === "string" ? e.localId.trim() : "";
          return Boolean(lid) && !seen.has(lid);
        });
        if (extras.length) out[k] = [...base, ...extras].sort((a, b) => a.ts - b.ts);
      }
      return out;
    })();

    const mergedConversations = (() => {
      if (!needOutbox) return baseConversations;
      let changed = false;
      const next: typeof st.conversations = { ...baseConversations };
      for (const [k, list] of Object.entries(mergedOutbox)) {
        const out = Array.isArray(list) ? list : [];
        if (!out.length) continue;
        const prevConv = next[k] ?? [];
        const has = new Set(prevConv.map((m) => (typeof m.localId === "string" ? m.localId : "")).filter(Boolean));
        const add = out
          .filter((e) => !has.has(e.localId))
          .map((e) => ({
            kind: "out" as const,
            from: st.selfId || "",
            to: e.to,
            room: e.room,
            text: e.text,
            ts: e.ts,
            localId: e.localId,
            id: null,
            status: "queued" as const,
            ...(e.whenOnline ? { whenOnline: true } : {}),
            ...(typeof e.scheduleAt === "number" && Number.isFinite(e.scheduleAt) ? { scheduleAt: e.scheduleAt } : {}),
          }));
        if (!add.length) continue;
        changed = true;
        next[k] = [...prevConv, ...add].sort((a, b) => {
          const sa = typeof a.id === "number" && Number.isFinite(a.id) ? a.id : a.ts;
          const sb = typeof b.id === "number" && Number.isFinite(b.id) ? b.id : b.ts;
          return sa - sb;
        });
      }
      return changed ? next : baseConversations;
    })();

    const selectedKey = st.selected ? conversationKey(st.selected) : "";
    const shouldRestoreInput = Boolean(selectedKey && !st.input.trim() && mergedDrafts[selectedKey]);
    const restoredInput = shouldRestoreInput ? (mergedDrafts[selectedKey] ?? "") : null;

    const storedBoardSchedule = needBoardSchedule ? loadBoardScheduleForUser(userId) : [];
    const mergedBoardSchedule = (() => {
      if (!needBoardSchedule) return st.boardScheduledPosts;
      const base = Array.isArray(storedBoardSchedule) ? storedBoardSchedule : [];
      const cur = Array.isArray(st.boardScheduledPosts) ? st.boardScheduledPosts : [];
      if (!cur.length) return base;
      const seen = new Set(base.map((x) => String(x.id || "").trim()).filter(Boolean));
      const extras = cur.filter((x) => {
        const id = String(x?.id || "").trim();
        return Boolean(id) && !seen.has(id);
      });
      const merged = extras.length ? [...base, ...extras] : base;
      merged.sort((a, b) => a.scheduleAt - b.scheduleAt);
      return merged;
    })();

    store.set((prev) => {
      let next = {
        ...prev,
        pinned: mergedPins,
        archived: mergedArchived,
        pinnedMessages: mergedPinnedMessages,
        pinnedBarHidden: mergedPinnedBarHidden,
        conversations: mergedConversations,
        ...(storedHistory
          ? {
              historySync: mergedHistorySync,
              historyLoaded: mergedHistoryLoaded,
              historyPreviewOnly: mergedHistoryPreviewOnly,
              historyCursor: mergedHistoryCursor,
              historyHasMore: mergedHistoryHasMore,
            }
          : {}),
        boardScheduledPosts: mergedBoardSchedule,
        ...(restoredInput !== null ? { input: restoredInput } : {}),
      };
      next = applyDraftMapSnapshot(next, mergedDrafts, { source: "cache", reconcilePending: true });
      next = applyFileTransferSnapshot(next, mergedFileTransfers, {
        source: "cache",
        reconcilePending: shouldRestoreFileTransfers,
      });
      next = applyOutboxSnapshot(next, mergedOutbox, { source: "cache", reconcilePending: true });
      if (needChatFolders) {
        next = applySidebarFolderSnapshot(
          next,
          { v: 1, active: mergedFolderId, folders: mergedChatFolders },
          { source: "cache", reconcilePending: true }
        );
      }
      return next;
    });

    if (restoredInput !== null) {
      try {
        input.value = restoredInput;
        autosizeInput(input);
      } catch {
        // ignore
      }
    }

    scheduleSaveOutbox(store);
    armBoardScheduleTimer();
    if (shouldReconcileOutboxFromWorker(store.get(), userId)) {
      void syncOutboxFromServiceWorker(userId);
    }
    return true;
  };

  return {
    resetLoadedForUser,
    maybeHydrateLocalState,
    isHistoryCacheLoadedFor,
  };
}
