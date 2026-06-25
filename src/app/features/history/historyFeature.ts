import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, TargetRef } from "../../../stores/types";
import { conversationKey, dmKey, roomKey } from "../../../helpers/chat/conversationKey";
import { applyConversationHistorySyncState, getConversationHistorySyncState, newestServerMessageId } from "../../../helpers/chat/historySync";
import { loadHistoryCachePrefs } from "../../../helpers/chat/historyCachePrefs";
import { countHistoryMessagesForConvo, getHistoryConvoMeta, getHistoryLatestMessages, getHistoryMessagesBefore } from "../../../helpers/chat/historyIdb";
import { historyViewportRecentlyCompensated, shiftVirtualStartForPrepend } from "../../../helpers/chat/historyViewportCoordinator";
import { markChatPendingBottomStick } from "../../../helpers/chat/historyViewportRuntime";
import { mergeMessages, prependedCount } from "../../../helpers/chat/mergeMessages";
import { registerPwaReloadBlocker } from "../../../helpers/pwa/reloadSafety";

type DeviceCapsLike = {
  constrained: boolean;
  slowNetwork: boolean;
  prefetchAllowed: boolean;
  historyPrefetchLimit: number;
  historyWarmupLimit: number;
  historyWarmupConcurrency: number;
  historyWarmupQueueMax: number;
  historyWarmupDelayMs: number;
  historyRequestTimeoutMs: number;
};

type HistoryRequestMode = "before" | "delta";

export interface HistoryFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  deviceCaps: DeviceCapsLike;
  chatHost: HTMLElement;
  scrollToBottom: (key: string) => void;
  reportIncident?: (kind: string, detail?: Record<string, unknown> | null, opts?: { key?: string; dedupeMs?: number }) => boolean;
}

export interface HistoryFeature {
  requestHistory: (t: TargetRef, opts?: { force?: boolean; deltaLimit?: number; prefetchBefore?: boolean }) => void;
  requestMoreHistory: () => void;
  enqueueHistoryPreview: (t: TargetRef) => void;
  scheduleWarmup: () => void;
  scheduleBackfill: () => void;
  maybeAutoLoadMoreOnScroll: (opts: { scrollTop: number; scrollingUp: boolean; lastUserScrollAt: number }) => void;
  maybeFillViewport: () => void;
  maybeAutoRetrySelected: () => void;
  forceRetrySelected: (t: TargetRef) => void;
  clearPendingRequests: () => void;
  handleHistoryResultMessage: (msg: any) => void;
  onDisconnect: () => void;
  onLogout: () => void;
  markChatAutoScroll: (key: string, waitForHistory?: boolean) => void;
  applyPendingAutoScrollAfterRender: (st: AppState) => void;
  maybeBootstrapPrefetch: (st: AppState) => void;
  hasPendingActivityForUpdate: () => boolean;
}

function oldestServerMessageId(msgs: ChatMessage[]): number | null {
  let min: number | null = null;
  for (const m of msgs) {
    const id = m?.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    min = min === null ? id : Math.min(min, id);
  }
  return min;
}

export function createHistoryFeature(deps: HistoryFeatureDeps): HistoryFeature {
  const { store, send, deviceCaps, chatHost, scrollToBottom, reportIncident } = deps;
  const HISTORY_MORE_LIMIT = 200;

  const historyRequested = new Set<string>();
  const historyDeltaRequested = new Set<string>();
  const historyDeltaRequestedAt = new Map<string, number>();
  const historyPreviewRequested = new Set<string>();
  const historyPreviewLastAt = new Map<string, number>();
  const historyPreviewQueue: TargetRef[] = [];
  let historyPreviewTimer: number | null = null;
  const historyPrefetchRequested = new Set<string>();
  const historyPrefetchTimers = new Map<string, number>();
  const historyPrefetchBootstrap = new Set<string>();
  const HISTORY_REQUEST_TIMEOUT_MS = deviceCaps.historyRequestTimeoutMs;
  const HISTORY_REQUEST_RETRY_LIMIT = 2;
  const HISTORY_AUTO_RETRY_MS = 120_000;
  const HISTORY_PREFETCH_TIMEOUT_MS = 10_000;
  const HISTORY_HAS_MORE_BYPASS_MS = 8_000;
  const HISTORY_HAS_MORE_BYPASS_MAX = 2;
  const HISTORY_BOTTOM_SYNC_MIN_MS = 45_000;
  const HISTORY_SELECTED_DELTA_REVALIDATE_MS = deviceCaps.slowNetwork ? 5 * 60 * 1000 : 3 * 60 * 1000;
  const HISTORY_TAIL_REVALIDATE_MS = deviceCaps.slowNetwork ? 12 * 60 * 1000 : 8 * 60 * 1000;
  const HISTORY_BACKGROUND_NETWORK_MIN_MS = deviceCaps.slowNetwork ? 20 * 60 * 1000 : 12 * 60 * 1000;
  const HISTORY_PREFETCH_LIMIT = deviceCaps.historyPrefetchLimit;
  const HISTORY_WARMUP_LIMIT = deviceCaps.historyWarmupLimit;
  const HISTORY_WARMUP_CONCURRENCY = deviceCaps.historyWarmupConcurrency;
  const HISTORY_WARMUP_TIMEOUT_MS = 12_000;
  const HISTORY_WARMUP_QUEUE_MAX = deviceCaps.historyWarmupQueueMax;
  const HISTORY_WARMUP_DELAY_MS = deviceCaps.historyWarmupDelayMs;
  const HISTORY_PREVIEW_QUEUE_MAX = deviceCaps.slowNetwork ? 30 : deviceCaps.constrained ? 50 : 80;
  const historyHasMoreBypassUntil = new Map<string, number>();
  const historyHasMoreBypassCount = new Map<string, number>();
  const historyRequestTimers = new Map<string, number>();
  const historyRequestAttempts = new Map<string, number>();
  const historyAutoRetryAt = new Map<string, number>();
  const historyBottomSyncAt = new Map<string, number>();
  const historyWarmupQueue: TargetRef[] = [];
  const historyWarmupQueued = new Set<string>();
  const historyWarmupRequested = new Set<string>();
  const historyWarmupInFlight = new Set<string>();
  const historyWarmupTimers = new Map<string, number>();
  let historyWarmupTimer: number | null = null;

  const historyIdbHydrating = new Set<string>();
  const historyIdbNoCacheUntil = new Map<string, number>();

  const HISTORY_IDB_TAIL_LIMIT = Math.max(200, Math.min(420, HISTORY_WARMUP_LIMIT));
  const HISTORY_IDB_MISS_TTL_MS = 25_000;

  const HISTORY_BACKFILL_LIMIT = deviceCaps.slowNetwork ? 120 : deviceCaps.constrained ? 160 : 200;
  const HISTORY_BACKFILL_CONCURRENCY = 1;
  const HISTORY_BACKFILL_QUEUE_MAX = deviceCaps.slowNetwork ? 30 : deviceCaps.constrained ? 50 : 70;
  const HISTORY_BACKFILL_DELAY_MS = deviceCaps.slowNetwork ? 1600 : deviceCaps.constrained ? 1050 : 780;
  const HISTORY_BACKFILL_TIMEOUT_MS = Math.max(12_000, Math.min(30_000, HISTORY_REQUEST_TIMEOUT_MS + 3000));
  const HISTORY_BACKFILL_TAIL_REVALIDATE_MS = 24 * 60 * 60 * 1000;
  const HISTORY_BACKFILL_DELTA_REVALIDATE_MS = deviceCaps.slowNetwork ? 45 * 60 * 1000 : deviceCaps.constrained ? 35 * 60 * 1000 : 30 * 60 * 1000;
  const HISTORY_BACKFILL_DELTA_LIMIT = deviceCaps.slowNetwork ? 220 : deviceCaps.constrained ? 420 : 800;

  const historyBackfillQueue: TargetRef[] = [];
  const historyBackfillQueued = new Set<string>();
  const historyBackfillInFlight = new Set<string>();
  const historyBackfillTimers = new Map<string, number>();
  let historyBackfillTimer: number | null = null;

  let historyAutoBlockUntil = 0;
  let lastHistoryAutoAt = 0;
  let lastHistoryAutoKey = "";
  let lastHistoryFillAt = 0;
  let lastHistoryFillKey = "";
  let pendingChatAutoScroll: { key: string; waitForHistory: boolean } | null = null;
  const historyNetworkLastAt = new Map<string, number>();

  const debugHook = (kind: string, data?: any) => {
    try {
      const dbg = (globalThis as any).__yagodka_debug_monitor;
      if (!dbg || typeof dbg.push !== "function") return;
      dbg.push(String(kind || "history").trim() || "history", data);
    } catch {
      // ignore
    }
  };

  const canRunBackgroundHistory = (): boolean => deviceCaps.prefetchAllowed && document.visibilityState !== "hidden";

  const historyRequestTimerKey = (key: string, mode: HistoryRequestMode) => `${key}:${mode}`;

  const resolveHistoryLoadingSlotCount = (limit: number): number => {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(400, Math.trunc(limit))) : HISTORY_MORE_LIMIT;
    const maxSlots = deviceCaps.constrained || deviceCaps.slowNetwork ? 4 : 6;
    return Math.max(3, Math.min(maxSlots, Math.ceil(safeLimit / 50)));
  };

  const setHistoryLoadingSlots = (key: string, count: number) => {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) return;
    const nextCount = Math.max(0, Math.trunc(Number(count || 0) || 0));
    store.set((prev) => {
      const sync = getConversationHistorySyncState(prev, cleanKey);
      if (sync.loadingSlots === nextCount) return prev;
      return applyConversationHistorySyncState(prev, cleanKey, { loadingSlots: nextCount });
    });
  };

  const clearHistoryLoadingSlots = (key: string) => {
    setHistoryLoadingSlots(key, 0);
  };

  const shouldUseHistoryNetwork = (key: string, mode: string, minMs: number, opts?: { force?: boolean }): boolean => {
    if (opts?.force) return true;
    const cleanMode = String(mode || "history").trim() || "history";
    const budgetKey = `${key}:${cleanMode}`;
    const now = Date.now();
    const last = historyNetworkLastAt.get(budgetKey) || 0;
    if (last && now - last < minMs) {
      debugHook("history.request.blocked_budget", {
        key,
        mode: cleanMode,
        remaining_ms: Math.max(0, minMs - (now - last)),
      });
      return false;
    }
    historyNetworkLastAt.set(budgetKey, now);
    return true;
  };

  const metaFresh = (timestampRaw: number | undefined, ttlMs: number): boolean => {
    const ts = Number(timestampRaw ?? 0) || 0;
    return Boolean(ts && Date.now() - ts < ttlMs);
  };

  const clearHistoryRequestTimer = (key: string, mode: HistoryRequestMode, opts?: { resetAttempts?: boolean }) => {
    const timerKey = historyRequestTimerKey(key, mode);
    const timer = historyRequestTimers.get(timerKey);
    if (timer !== undefined) {
      historyRequestTimers.delete(timerKey);
      try {
        window.clearTimeout(timer);
      } catch {
        // ignore
      }
    }
    if (opts?.resetAttempts) historyRequestAttempts.delete(timerKey);
  };

  const clearHistoryRequestTimers = (key: string, opts?: { resetAttempts?: boolean }) => {
    clearHistoryRequestTimer(key, "before", opts);
    clearHistoryRequestTimer(key, "delta", opts);
  };

  const clearHistoryPrefetchTimer = (key: string) => {
    const timer = historyPrefetchTimers.get(key);
    if (timer !== undefined) {
      historyPrefetchTimers.delete(key);
      try {
        window.clearTimeout(timer);
      } catch {
        // ignore
      }
    }
  };

  const consumeHistoryHasMoreBypass = (key: string): boolean => {
    const until = historyHasMoreBypassUntil.get(key);
    if (!until) return false;
    if (until < Date.now()) {
      historyHasMoreBypassUntil.delete(key);
      return false;
    }
    historyHasMoreBypassUntil.delete(key);
    return true;
  };

  const markHistoryHasMoreBypass = (key: string) => {
    const attempts = (historyHasMoreBypassCount.get(key) || 0) + 1;
    if (attempts > HISTORY_HAS_MORE_BYPASS_MAX) return;
    historyHasMoreBypassCount.set(key, attempts);
    historyHasMoreBypassUntil.set(key, Date.now() + HISTORY_HAS_MORE_BYPASS_MS);
    debugHook("history.has_more_bypass", {
      key,
      attempts,
      reason: "historyHasMore=false_after_before_page",
    });
  };

  const clearHistoryHasMoreBypass = (key: string) => {
    historyHasMoreBypassUntil.delete(key);
    historyHasMoreBypassCount.delete(key);
  };

  const clearAllHistoryHasMoreBypass = () => {
    historyHasMoreBypassUntil.clear();
    historyHasMoreBypassCount.clear();
  };

  const canLoadOlderHistory = (st: AppState, key: string, mode: string): boolean => {
    const sync = getConversationHistorySyncState(st, key);
    if (sync.hasMore !== false) return true;
    const consumed = consumeHistoryHasMoreBypass(key);
    if (!consumed) return false;
    debugHook("history.has_more_bypass", {
      key,
      mode,
      reason: "consume",
      detail: "historyHasMore=false_after_before_page",
    });
    return true;
  };

  const armHistoryPrefetchTimeout = (key: string) => {
    clearHistoryPrefetchTimer(key);
    const timer = window.setTimeout(() => {
      historyPrefetchTimers.delete(key);
      historyPrefetchRequested.delete(key);
    }, HISTORY_PREFETCH_TIMEOUT_MS);
    historyPrefetchTimers.set(key, timer);
  };

  const requestHistory: HistoryFeature["requestHistory"] = (t, opts) => {
    const st = store.get();
    if (!st.authed) return;
    if (st.conn !== "connected") return;
    const key = conversationKey(t);
    if (!key) return;
    const force = Boolean(opts?.force);
    const sync = getConversationHistorySyncState(st, key);

    const previewOnly = sync.previewOnly;
    const cachedList = st.conversations?.[key] || [];
    const cachedCursor = sync.cursor;
    const cachedCursorValue = typeof cachedCursor === "number" && Number.isFinite(cachedCursor) && cachedCursor > 0 ? Math.floor(cachedCursor) : null;
    const cachedHasServer =
      !previewOnly &&
      (cachedList.some((m) => typeof m?.id === "number" && Number.isFinite(m.id) && m.id > 0) ||
        cachedCursorValue !== null);
    const hasServerHistoryState = cachedHasServer;
    const hasStaleLoaded = sync.loaded && !hasServerHistoryState;
    const effectiveLoaded = !force && sync.loaded && hasServerHistoryState;

    if (hasStaleLoaded) {
      debugHook("history.request.stale_loaded", {
        key,
        hasCursor: cachedCursorValue !== null,
        cachedLen: cachedList.length,
        force,
      });
      store.set((prev) => {
        if (!getConversationHistorySyncState(prev, key).loaded) return prev;
        return applyConversationHistorySyncState(prev, key, { loaded: false });
      });
    }

    if (!force && !effectiveLoaded && hasServerHistoryState) {
      const derivedCursor =
        typeof cachedCursor === "number" && Number.isFinite(cachedCursor) && cachedCursor > 0
          ? Math.floor(cachedCursor)
          : oldestServerMessageId(cachedList);
      store.set((prev) =>
        applyConversationHistorySyncState(prev, key, {
          loaded: true,
          previewOnly: false,
          loading: false,
          cursor: derivedCursor,
          source: "server",
          reconcilePending: false,
          lastServerAt: Date.now(),
        })
      );
    }

    // 0) Local-first: if we have a full history cache in IndexedDB, hydrate the tail before hitting the server.
    if (!effectiveLoaded && !cachedHasServer && st.selfId) {
      const missUntil = historyIdbNoCacheUntil.get(key) ?? 0;
      if (Date.now() >= missUntil && !historyIdbHydrating.has(key) && !historyRequested.has(key)) {
        historyIdbHydrating.add(key);
        markChatAutoScroll(key, true);
        store.set((prev) => applyConversationHistorySyncState(prev, key, { loading: true }));
        void (async () => {
          try {
            const snap = store.get();
            const uid = snap.selfId;
            if (!uid) return;
            const cached = await getHistoryLatestMessages(uid, key, { limit: HISTORY_IDB_TAIL_LIMIT });
            if (!cached.length) {
              historyIdbNoCacheUntil.set(key, Date.now() + HISTORY_IDB_MISS_TTL_MS);
              store.set((prev) => applyConversationHistorySyncState(prev, key, { loading: false }));
              requestHistory(t, opts);
              return;
            }
            const meta = await getHistoryConvoMeta(uid, key);
            const derivedCursor = oldestServerMessageId(cached);
            store.set((prev) => {
              const prevConv = prev.conversations?.[key] || [];
              const merged = prevConv.length ? mergeMessages(prevConv, cached) : cached;
              const cursor = derivedCursor || oldestServerMessageId(merged);
              return applyConversationHistorySyncState({
                ...prev,
                conversations: { ...prev.conversations, [key]: merged },
              }, key, {
                loaded: true,
                previewOnly: true,
                cursor,
                hasMore: meta ? !meta.backfilled : null,
                loading: false,
                source: "cache",
                reconcilePending: true,
                lastServerAt: null,
              });
            });
            // Local-first: draw cached history immediately, then revalidate through the shared
            // network budget so stale cache cannot trigger reload storms on slow clients.
            const after = store.get();
            const selectedKey = after.selected ? conversationKey(after.selected) : "";
            if (selectedKey === key && shouldUseHistoryNetwork(key, "selected_tail_after_cache", HISTORY_SELECTED_DELTA_REVALIDATE_MS)) {
              requestHistory(t, opts);
            } else if (
              selectedKey === key &&
              meta &&
              !metaFresh(meta.delta_checked_at, HISTORY_SELECTED_DELTA_REVALIDATE_MS) &&
              shouldUseHistoryNetwork(key, "selected_delta_after_cache", HISTORY_SELECTED_DELTA_REVALIDATE_MS)
            ) {
              requestHistory(t, { ...opts, deltaLimit: Math.min(Number(opts?.deltaLimit ?? 200), 200) });
            }
          } finally {
            historyIdbHydrating.delete(key);
          }
        })();
        return;
      }
    }

    // 1) Первый заход в чат: забираем "хвост" (последние сообщения), чтобы быстро заполнить экран.
    if (!effectiveLoaded && !cachedHasServer) {
      if (historyRequested.has(key)) return;
      if (!shouldUseHistoryNetwork(key, "tail", HISTORY_TAIL_REVALIDATE_MS, { force })) return;
      const cached = cachedList.length > 0;
      const baseTarget = t.kind === "dm" ? { type: "history", peer: t.id } : { type: "history", room: t.id };
      debugHook("history.request", {
        key,
        kind: t.kind,
        mode: "tail",
        force: Boolean(opts?.force),
        prefetchBefore: Boolean(opts?.prefetchBefore),
        hasServer: Boolean(cachedHasServer),
        cachedLen: cachedList.length,
      });
      // UX: ждём историю, если в кеше пусто, чтобы не дергать скролл на слабых устройствах.
      markChatAutoScroll(key, !cached);
      historyRequested.add(key);
      armHistoryRequestTimeout(key, "before");
      store.set((prev) => applyConversationHistorySyncState(prev, key, { loading: true }));
      send({ ...baseTarget, before_id: 0, limit: 200 });
      return;
    }

    // 2) Уже загружено: тихо синхронизируем "дельту" после reconnect/долгой паузы.
    if (historyDeltaRequested.has(key)) return;
    const since = newestServerMessageId(st.conversations[key] ?? []);
    const now = Date.now();
    const last = historyDeltaRequestedAt.get(key) ?? 0;
    if (!opts?.force && now - last < HISTORY_SELECTED_DELTA_REVALIDATE_MS) return;
    if (!shouldUseHistoryNetwork(key, "delta", HISTORY_SELECTED_DELTA_REVALIDATE_MS, { force: Boolean(opts?.force) })) return;
    historyDeltaRequestedAt.set(key, now);
    historyDeltaRequested.add(key);
    armHistoryRequestTimeout(key, "delta");

    // Если в локальном кэше нет ни одного серверного id (чат был пуст), "дельта" не применима —
    // забираем хвост ещё раз (это и поймает новые сообщения).
    if (!since) {
      const baseTarget = t.kind === "dm" ? { type: "history", peer: t.id, since_id: since } : { type: "history", room: t.id, since_id: since };
      debugHook("history.request", {
        key,
        kind: t.kind,
        mode: "tail_reset",
        force: Boolean(opts?.force),
        prefetchBefore: Boolean(opts?.prefetchBefore),
        since,
      });
      send({ ...baseTarget, before_id: 0, limit: 200 });
      return;
    }

    const rawLimit = Number(opts?.deltaLimit ?? 200);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(2000, Math.floor(rawLimit))) : 200;
    const deltaTarget = t.kind === "dm" ? { type: "history", peer: t.id, since_id: since } : { type: "history", room: t.id, since_id: since };
    debugHook("history.request", {
      key,
      kind: t.kind,
      mode: "delta",
      since,
      limit,
      force: Boolean(opts?.force),
      prefetchBefore: Boolean(opts?.prefetchBefore),
    });
    send({ ...deltaTarget, limit });

    if (!opts?.prefetchBefore) return;
    if (!canRunBackgroundHistory()) return;
    if (!opts?.force && !canLoadOlderHistory(st, key, "prefetch")) {
      debugHook("history.blocked", { key, mode: "prefetch", reason: "hasMore=false", limit: HISTORY_PREFETCH_LIMIT });
      return;
    }
    const prefetchSync = getConversationHistorySyncState(st, key);
    if (historyPrefetchRequested.has(key)) return;
    if (historyRequested.has(key)) return;
    if (prefetchSync.loading) return;
    const before = prefetchSync.cursor;
    if (!before || !Number.isFinite(before) || before <= 0) return;
    if (!shouldUseHistoryNetwork(key, "prefetch", HISTORY_BACKGROUND_NETWORK_MIN_MS)) return;
    historyPrefetchRequested.add(key);
    armHistoryPrefetchTimeout(key);
    debugHook("history.request", {
      key,
      kind: t.kind,
      mode: "prefetch",
      before,
      limit: HISTORY_PREFETCH_LIMIT,
      force: Boolean(opts?.force),
    });
    if (t.kind === "dm") {
      send({ type: "history", peer: t.id, before_id: before, limit: HISTORY_PREFETCH_LIMIT });
    } else {
      send({ type: "history", room: t.id, before_id: before, limit: HISTORY_PREFETCH_LIMIT });
    }
  };

  const armHistoryRequestTimeout = (key: string, mode: HistoryRequestMode) => {
    clearHistoryRequestTimer(key, mode);
    const timerKey = historyRequestTimerKey(key, mode);
    const timer = window.setTimeout(() => {
      historyRequestTimers.delete(timerKey);
      const attempts = (historyRequestAttempts.get(timerKey) ?? 0) + 1;
      historyRequestAttempts.set(timerKey, attempts);
      const canRetry = attempts <= HISTORY_REQUEST_RETRY_LIMIT;
      const snapshot = store.get();
      reportIncident?.(
        "history_request_timeout",
        {
          mode,
          attempts,
          final_failure: !canRetry,
          history_loaded: getConversationHistorySyncState(snapshot, key).loaded,
          history_loading: getConversationHistorySyncState(snapshot, key).loading,
          history_has_more: getConversationHistorySyncState(snapshot, key).hasMore,
          history_cursor: getConversationHistorySyncState(snapshot, key).cursor,
        },
        {
          key: `history_request_timeout:${key}:${mode}:${canRetry ? "retry" : "final"}`,
          dedupeMs: canRetry ? HISTORY_REQUEST_TIMEOUT_MS : HISTORY_AUTO_RETRY_MS,
        }
      );
      if (mode === "before") {
        if (!historyRequested.has(key)) return;
        historyRequested.delete(key);
        historyPreviewRequested.delete(key);
        store.set((prev) => {
          if (!getConversationHistorySyncState(prev, key).loading) return prev;
          if (canRetry) {
            const status = "История не отвечает, повторяем…";
            return prev.status === status ? prev : { ...prev, status };
          }
          return {
            ...applyConversationHistorySyncState(prev, key, { loading: false, loadingSlots: 0 }),
            status: "История не отвечает. Повторите позже.",
          };
        });
      } else {
        if (!historyDeltaRequested.has(key)) return;
        historyDeltaRequested.delete(key);
      }
      if (!canRetry) return;
      const st = store.get();
      if (!st.authed || st.conn !== "connected") return;
      if (!st.selected || conversationKey(st.selected) !== key) return;
      debugHook("history.timeout.retry", {
        key,
        mode,
        attempts,
        canRetry,
      });
      if (mode === "before") {
        if (getConversationHistorySyncState(st, key).loaded) {
          requestMoreHistory();
        } else {
          requestHistory(st.selected, { force: true, deltaLimit: 2000 });
        }
        return;
      }
      requestHistory(st.selected, { force: true, deltaLimit: 2000 });
    }, HISTORY_REQUEST_TIMEOUT_MS);
    historyRequestTimers.set(timerKey, timer);
  };

  const clearHistoryWarmupTimer = (key: string) => {
    const timer = historyWarmupTimers.get(key);
    if (timer === undefined) return;
    historyWarmupTimers.delete(key);
    try {
      window.clearTimeout(timer);
    } catch {
      // ignore
    }
  };

  const armHistoryWarmupTimer = (key: string) => {
    clearHistoryWarmupTimer(key);
    const timer = window.setTimeout(() => {
      historyWarmupTimers.delete(key);
      historyWarmupInFlight.delete(key);
      scheduleWarmup();
    }, HISTORY_WARMUP_TIMEOUT_MS);
    historyWarmupTimers.set(key, timer);
  };

  const clearHistoryBackfillTimer = (key: string) => {
    const timer = historyBackfillTimers.get(key);
    if (timer === undefined) return;
    historyBackfillTimers.delete(key);
    try {
      window.clearTimeout(timer);
    } catch {
      // ignore
    }
  };

  const armHistoryBackfillTimer = (key: string) => {
    clearHistoryBackfillTimer(key);
    const timer = window.setTimeout(() => {
      historyBackfillTimers.delete(key);
      if (!historyBackfillInFlight.has(key)) return;
      historyBackfillInFlight.delete(key);
      debugHook("history.backfill.timeout", { key, timeout_ms: HISTORY_BACKFILL_TIMEOUT_MS });
      scheduleBackfill();
    }, HISTORY_BACKFILL_TIMEOUT_MS);
    historyBackfillTimers.set(key, timer);
  };

  const shouldBackfillHistoryTarget = (st: AppState, key: string): boolean => {
    if (!key) return false;
    if (!st.selfId) return false;
    if (st.selected && conversationKey(st.selected) === key) return false;
    if (historyRequested.has(key) || historyDeltaRequested.has(key) || historyPrefetchRequested.has(key)) return false;
    if (historyWarmupInFlight.has(key) || historyWarmupQueued.has(key) || historyWarmupRequested.has(key)) return false;
    if (historyBackfillQueued.has(key) || historyBackfillInFlight.has(key)) return false;
    return true;
  };

  const fillHistoryBackfillQueue = (st: AppState) => {
    if (historyBackfillQueue.length >= HISTORY_BACKFILL_QUEUE_MAX) return;
    const targets = collectHistoryWarmupTargets(st);
    for (const target of targets) {
      if (historyBackfillQueue.length >= HISTORY_BACKFILL_QUEUE_MAX) break;
      const key = conversationKey(target);
      if (!key) continue;
      if (!shouldBackfillHistoryTarget(st, key)) continue;
      historyBackfillQueue.push(target);
      historyBackfillQueued.add(key);
    }
  };

  const startBackfillForTarget = async (target: TargetRef, key: string) => {
    try {
      const st = store.get();
      if (!st.authed || st.conn !== "connected") return;
      if (!st.netLeader) {
        historyBackfillInFlight.delete(key);
        clearHistoryBackfillTimer(key);
        return;
      }
      const uid = st.selfId;
      if (!uid) return;
      const meta = await getHistoryConvoMeta(uid, key);
      if (!store.get().netLeader) {
        historyBackfillInFlight.delete(key);
        clearHistoryBackfillTimer(key);
        return;
      }
      const now = Date.now();

      const maxId = Number(meta?.max_id ?? 0) || 0;
      const tailCheckedAt = meta?.tail_checked_at ?? 0;
      const tailStale = !tailCheckedAt || now - tailCheckedAt > HISTORY_BACKFILL_TAIL_REVALIDATE_MS;
      const needTail = !meta || maxId <= 0;
      if (needTail) {
        if (!shouldUseHistoryNetwork(key, "backfill_tail", HISTORY_BACKGROUND_NETWORK_MIN_MS)) {
          historyBackfillInFlight.delete(key);
          clearHistoryBackfillTimer(key);
          scheduleBackfill();
          return;
        }
        debugHook("history.backfill.request", {
          key,
          mode: "tail",
          limit: HISTORY_IDB_TAIL_LIMIT,
          reason: !meta ? "no_meta" : maxId <= 0 ? "no_max_id" : "unknown",
        });
        if (target.kind === "dm") send({ type: "history", peer: target.id, before_id: 0, limit: HISTORY_IDB_TAIL_LIMIT });
        else send({ type: "history", room: target.id, before_id: 0, limit: HISTORY_IDB_TAIL_LIMIT });
        return;
      }

      // Delta sync (tweb-like): after reconnect/long pause, check for new/edited/deleted messages without opening the chat.
      const deltaCheckedAt = meta?.delta_checked_at ?? 0;
      const deltaStale = !deltaCheckedAt || now - deltaCheckedAt > HISTORY_BACKFILL_DELTA_REVALIDATE_MS;
      if (deltaStale && maxId > 0) {
        if (!shouldUseHistoryNetwork(key, "backfill_delta", HISTORY_BACKGROUND_NETWORK_MIN_MS)) {
          historyBackfillInFlight.delete(key);
          clearHistoryBackfillTimer(key);
          scheduleBackfill();
          return;
        }
        if (historyDeltaRequested.has(key)) {
          debugHook("history.backfill.skip", { key, mode: "delta", reason: "delta_in_flight" });
          historyBackfillInFlight.delete(key);
          clearHistoryBackfillTimer(key);
          scheduleBackfill();
          return;
        }
        historyDeltaRequestedAt.set(key, now);
        historyDeltaRequested.add(key);
        armHistoryRequestTimeout(key, "delta");
        debugHook("history.backfill.request", {
          key,
          mode: "delta",
          since: maxId,
          limit: HISTORY_BACKFILL_DELTA_LIMIT,
          reason: !deltaCheckedAt ? "no_delta_checked_at" : "stale_delta",
        });
        if (target.kind === "dm") send({ type: "history", peer: target.id, since_id: maxId, limit: HISTORY_BACKFILL_DELTA_LIMIT });
        else send({ type: "history", room: target.id, since_id: maxId, limit: HISTORY_BACKFILL_DELTA_LIMIT });
        return;
      }

      if (tailStale) {
        if (!shouldUseHistoryNetwork(key, "backfill_tail_revalidate", HISTORY_BACKGROUND_NETWORK_MIN_MS)) {
          historyBackfillInFlight.delete(key);
          clearHistoryBackfillTimer(key);
          scheduleBackfill();
          return;
        }
        debugHook("history.backfill.request", {
          key,
          mode: "tail_revalidate",
          limit: HISTORY_IDB_TAIL_LIMIT,
          reason: "stale_tail",
        });
        if (target.kind === "dm") send({ type: "history", peer: target.id, before_id: 0, limit: HISTORY_IDB_TAIL_LIMIT });
        else send({ type: "history", room: target.id, before_id: 0, limit: HISTORY_IDB_TAIL_LIMIT });
        return;
      }

      if (!meta.backfilled) {
        const keepLatest = loadHistoryCachePrefs(uid).keepLatestPerConvo;
        if (keepLatest > 0) {
          const cached = await countHistoryMessagesForConvo(uid, key);
          if (cached >= keepLatest) {
            debugHook("history.backfill.skip", { key, mode: "before", reason: "cache_limit", cached, keepLatest });
            historyBackfillInFlight.delete(key);
            clearHistoryBackfillTimer(key);
            scheduleBackfill();
            return;
          }
        }
        const cursor = Number(meta.min_id ?? 0) || 0;
        if (cursor > 0) {
          if (!shouldUseHistoryNetwork(key, "backfill_before", HISTORY_BACKGROUND_NETWORK_MIN_MS)) {
            historyBackfillInFlight.delete(key);
            clearHistoryBackfillTimer(key);
            scheduleBackfill();
            return;
          }
          debugHook("history.backfill.request", { key, mode: "before", before: cursor, limit: HISTORY_BACKFILL_LIMIT });
          if (target.kind === "dm") send({ type: "history", peer: target.id, before_id: cursor, limit: HISTORY_BACKFILL_LIMIT });
          else send({ type: "history", room: target.id, before_id: cursor, limit: HISTORY_BACKFILL_LIMIT });
          return;
        }
        if (!shouldUseHistoryNetwork(key, "backfill_tail_repair", HISTORY_BACKGROUND_NETWORK_MIN_MS)) {
          historyBackfillInFlight.delete(key);
          clearHistoryBackfillTimer(key);
          scheduleBackfill();
          return;
        }
        debugHook("history.backfill.request", { key, mode: "tail_repair", limit: HISTORY_IDB_TAIL_LIMIT, reason: "missing_min_id" });
        if (target.kind === "dm") send({ type: "history", peer: target.id, before_id: 0, limit: HISTORY_IDB_TAIL_LIMIT });
        else send({ type: "history", room: target.id, before_id: 0, limit: HISTORY_IDB_TAIL_LIMIT });
        return;
      }
    } catch {
      // ignore
    }
    historyBackfillInFlight.delete(key);
    clearHistoryBackfillTimer(key);
    scheduleBackfill();
  };

  const drainHistoryBackfillQueue = () => {
    historyBackfillTimer = null;
    const st = store.get();
    if (!st.authed || st.conn !== "connected") {
      historyBackfillQueue.length = 0;
      historyBackfillQueued.clear();
      for (const key of historyBackfillInFlight) clearHistoryBackfillTimer(key);
      historyBackfillInFlight.clear();
      return;
    }
    if (!st.netLeader) return;
    if (!st.selfId) return;
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    const selectedKey = st.selected ? conversationKey(st.selected) : "";
    if (selectedKey) {
      const selectedSync = getConversationHistorySyncState(st, selectedKey);
      if (!selectedSync.loaded || selectedSync.loading) return;
    }
    if (!canRunBackgroundHistory()) {
      if (historyBackfillQueue.length) {
        historyBackfillTimer = window.setTimeout(drainHistoryBackfillQueue, HISTORY_BACKFILL_DELAY_MS);
      }
      return;
    }
    if (historyWarmupInFlight.size || historyWarmupQueue.length || historyWarmupQueued.size) {
      historyBackfillTimer = window.setTimeout(drainHistoryBackfillQueue, Math.max(350, HISTORY_BACKFILL_DELAY_MS));
      return;
    }
    if (!historyBackfillQueue.length) fillHistoryBackfillQueue(st);
    let slots = Math.max(0, HISTORY_BACKFILL_CONCURRENCY - historyBackfillInFlight.size);
    while (historyBackfillQueue.length && slots > 0) {
      const target = historyBackfillQueue.shift();
      if (!target) continue;
      const key = conversationKey(target);
      if (!key) continue;
      historyBackfillQueued.delete(key);
      if (!shouldBackfillHistoryTarget(st, key)) continue;
      historyBackfillInFlight.add(key);
      armHistoryBackfillTimer(key);
      void startBackfillForTarget(target, key);
      slots -= 1;
    }
  };

  const scheduleBackfill: HistoryFeature["scheduleBackfill"] = () => {
    if (historyBackfillTimer !== null) return;
    if (!store.get().netLeader) return;
    historyBackfillTimer = window.setTimeout(drainHistoryBackfillQueue, 450);
  };

  const shouldWarmupHistoryTarget = (st: AppState, key: string): boolean => {
    if (!key) return false;
    if (st.selected && conversationKey(st.selected) === key) return false;
    const sync = getConversationHistorySyncState(st, key);
    if (sync.loaded) return false;
    if (sync.loading) return false;
    if (historyRequested.has(key) || historyDeltaRequested.has(key) || historyPrefetchRequested.has(key)) return false;
    if (historyWarmupRequested.has(key) || historyWarmupQueued.has(key) || historyWarmupInFlight.has(key)) return false;
    if ((st.conversations[key] || []).length) return false;
    return true;
  };

  const collectHistoryWarmupTargets = (st: AppState): TargetRef[] => {
    const targets: TargetRef[] = [];
    const seen = new Set<string>();
    const add = (kind: TargetRef["kind"], idRaw: unknown) => {
      const id = String(idRaw || "").trim();
      if (!id) return;
      const target: TargetRef = { kind, id };
      const key = conversationKey(target);
      if (!key || seen.has(key)) return;
      seen.add(key);
      targets.push(target);
    };
    const topPeers = Array.isArray(st.topPeers) ? st.topPeers : [];
    if (topPeers.length) {
      for (const entry of topPeers) add("dm", entry?.id);
    } else {
      for (const friend of st.friends || []) add("dm", friend?.id);
    }
    for (const group of st.groups || []) add("group", group?.id);
    for (const board of st.boards || []) add("board", board?.id);
    return targets;
  };

  const fillHistoryWarmupQueue = (st: AppState) => {
    if (historyWarmupQueue.length >= HISTORY_WARMUP_QUEUE_MAX) return;
    const targets = collectHistoryWarmupTargets(st);
    for (const target of targets) {
      if (historyWarmupQueue.length >= HISTORY_WARMUP_QUEUE_MAX) break;
      const key = conversationKey(target);
      if (!key) continue;
      if (!shouldWarmupHistoryTarget(st, key)) continue;
      historyWarmupQueue.push(target);
      historyWarmupQueued.add(key);
    }
  };

  const startWarmupForTarget = async (target: TargetRef, key: string) => {
    let usedNetwork = false;
    try {
      const st = store.get();
      if (!st.authed || st.conn !== "connected") return;
      if (!st.netLeader) return;
      if (!st.selfId) return;
      if (!canRunBackgroundHistory()) return;

      const uid = st.selfId;
      const cached = await getHistoryLatestMessages(uid, key, { limit: 1 });
      if (!store.get().netLeader) return;
      if (cached.length) {
        const meta = await getHistoryConvoMeta(uid, key);
        store.set((prev) => {
          if ((prev.conversations?.[key] || []).length) return prev;
          return applyConversationHistorySyncState({
            ...prev,
            conversations: { ...prev.conversations, [key]: cached },
          }, key, {
            previewOnly: true,
            hasMore: meta ? !meta.backfilled : null,
            source: "cache",
            reconcilePending: true,
          });
        });
        return;
      }

      debugHook("history.warmup.skip_network", { key, reason: "local_first_no_cache" });
    } catch {
      // ignore
    } finally {
      if (!usedNetwork) {
        historyWarmupInFlight.delete(key);
        clearHistoryWarmupTimer(key);
        scheduleWarmup();
        scheduleBackfill();
      }
    }
  };

  const drainHistoryWarmupQueue = () => {
    historyWarmupTimer = null;
    const st = store.get();
    if (!st.authed || st.conn !== "connected") {
      historyWarmupQueue.length = 0;
      historyWarmupQueued.clear();
      historyWarmupInFlight.clear();
      return;
    }
    if (!st.netLeader) return;
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    const selectedKey = st.selected ? conversationKey(st.selected) : "";
    if (selectedKey) {
      const selectedSync = getConversationHistorySyncState(st, selectedKey);
      if (!selectedSync.loaded || selectedSync.loading) return;
    }
    if (!canRunBackgroundHistory()) {
      if (historyWarmupQueue.length) {
        historyWarmupTimer = window.setTimeout(drainHistoryWarmupQueue, HISTORY_WARMUP_DELAY_MS);
      }
      return;
    }
    if (!historyWarmupQueue.length) fillHistoryWarmupQueue(st);
    let slots = Math.max(0, HISTORY_WARMUP_CONCURRENCY - historyWarmupInFlight.size);
    while (historyWarmupQueue.length && slots > 0) {
      const target = historyWarmupQueue.shift();
      if (!target) continue;
      const key = conversationKey(target);
      if (!key) continue;
      historyWarmupQueued.delete(key);
      if (!shouldWarmupHistoryTarget(st, key)) continue;
      historyWarmupInFlight.add(key);
      historyWarmupRequested.add(key);
      armHistoryWarmupTimer(key);
      void startWarmupForTarget(target, key);
      slots -= 1;
    }
    if (historyWarmupQueue.length) {
      historyWarmupTimer = window.setTimeout(drainHistoryWarmupQueue, HISTORY_WARMUP_DELAY_MS);
    }
  };

  const scheduleWarmup: HistoryFeature["scheduleWarmup"] = () => {
    if (historyWarmupTimer !== null) return;
    if (!store.get().netLeader) return;
    historyWarmupTimer = window.setTimeout(drainHistoryWarmupQueue, 200);
  };

  const requestHistoryPreview = (t: TargetRef) => {
    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    if (!canRunBackgroundHistory()) return;
    const key = conversationKey(t);
    if (!key) return;
    if (historyPreviewRequested.has(key)) return;
    if (getConversationHistorySyncState(st, key).loaded) return;
    if ((st.conversations[key] || []).length) return;
    const last = historyPreviewLastAt.get(key) ?? 0;
    const now = Date.now();
    if (now - last < 5 * 60 * 1000) return;
    historyPreviewLastAt.set(key, now);
    if (!shouldUseHistoryNetwork(key, "preview", HISTORY_BACKGROUND_NETWORK_MIN_MS)) return;
    historyPreviewRequested.add(key);
    if (t.kind === "dm") {
      send({ type: "history", peer: t.id, before_id: 0, limit: 1, preview: true });
    } else {
      send({ type: "history", room: t.id, before_id: 0, limit: 1, preview: true });
    }
  };

  const drainHistoryPreviewQueue = () => {
    historyPreviewTimer = null;
    const st = store.get();
    if (!st.authed || st.conn !== "connected") {
      historyPreviewQueue.length = 0;
      return;
    }
    let sent = 0;
    while (historyPreviewQueue.length && sent < 20) {
      const t = historyPreviewQueue.shift();
      if (!t) continue;
      requestHistoryPreview(t);
      sent += 1;
    }
    if (historyPreviewQueue.length) {
      historyPreviewTimer = window.setTimeout(drainHistoryPreviewQueue, 120);
    }
  };

  const enqueueHistoryPreview: HistoryFeature["enqueueHistoryPreview"] = (t) => {
    if (!canRunBackgroundHistory()) return;
    if (historyPreviewQueue.length >= HISTORY_PREVIEW_QUEUE_MAX) return;
    historyPreviewQueue.push(t);
    if (historyPreviewTimer !== null) return;
    historyPreviewTimer = window.setTimeout(drainHistoryPreviewQueue, 120);
  };

  const requestMoreHistory: HistoryFeature["requestMoreHistory"] = () => {
    const st = store.get();
    if (!st.authed) return;
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.selected) return;
    const key = conversationKey(st.selected);
    if (!getConversationHistorySyncState(st, key).loaded) {
      requestHistory(st.selected);
      return;
    }
    if (historyRequested.has(key)) return;
    if (!canLoadOlderHistory(st, key, "more")) {
      debugHook("history.blocked", { key, mode: "more", reason: "hasMore=false" });
      return;
    }
    const before = getConversationHistorySyncState(st, key).cursor;
    if (!before || !Number.isFinite(before) || before <= 0) return;

    // Local-first: try to satisfy "load older" from IndexedDB cache to reduce server load (Telegram-like).
    if (st.selfId) {
      historyRequested.add(key);
      setHistoryLoadingSlots(key, resolveHistoryLoadingSlotCount(HISTORY_MORE_LIMIT));
      store.set((prev) => applyConversationHistorySyncState(prev, key, { loading: true }));
      void (async () => {
        let usedNetwork = false;
        try {
          const snap = store.get();
          const uid = snap.selfId;
          if (!uid) return;
          const cached = await getHistoryMessagesBefore(uid, key, { beforeId: before, limit: 200 });
          if (cached.length) {
            store.set((prev) => {
              const baseConv = prev.conversations?.[key] || [];
              const nextConv = mergeMessages(baseConv, cached);
              const delta = nextConv.length - baseConv.length;
              const actualPrependCount = prependedCount(baseConv, nextConv);
              const cursor = oldestServerMessageId(nextConv);
              const prevVirtualStart = prev.historyVirtualStart?.[key];
              const prependShift = actualPrependCount !== null && actualPrependCount >= 0 ? actualPrependCount : delta;
              const nextVirtualStart = shiftVirtualStartForPrepend(prevVirtualStart, prependShift);
              const shouldShiftVirtual = nextVirtualStart !== null && nextVirtualStart !== prevVirtualStart;
              return applyConversationHistorySyncState({
                ...prev,
                conversations: { ...prev.conversations, [key]: nextConv },
              }, key, {
                cursor,
                loading: false,
                loadingSlots: 0,
                virtualStart: shouldShiftVirtual && nextVirtualStart !== null ? nextVirtualStart : prevVirtualStart,
              });
            });
            return;
          }

          const meta = await getHistoryConvoMeta(uid, key);
          if (meta?.backfilled) {
            store.set((prev) => applyConversationHistorySyncState(prev, key, { hasMore: false, loading: false, loadingSlots: 0 }));
            return;
          }

          // Fallback: no cache (or not fully backfilled) — request from server.
          const live = store.get();
          if (!live.authed || live.conn !== "connected") return;
          const selected = live.selected;
          if (!selected) return;
          const selectedKey = conversationKey(selected);
          if (!selectedKey || selectedKey !== key) return;
          if (!shouldUseHistoryNetwork(key, "more", 3000)) return;
          usedNetwork = true;
          armHistoryRequestTimeout(key, "before");
          debugHook("history.request", {
            key,
            mode: "more",
            before,
            kind: selected.kind,
            force: false,
            prefetchBefore: false,
            reason: "idb_miss",
          });
          if (selected.kind === "dm") {
            send({ type: "history", peer: selected.id, before_id: before, limit: 200 });
          } else {
            send({ type: "history", room: selected.id, before_id: before, limit: 200 });
          }
        } finally {
          if (!usedNetwork) {
            historyRequested.delete(key);
            store.set((prev) => {
              if (!getConversationHistorySyncState(prev, key).loading) return prev;
              return applyConversationHistorySyncState(prev, key, { loading: false, loadingSlots: 0 });
            });
          }
        }
      })();
      return;
    }

    historyRequested.add(key);
    setHistoryLoadingSlots(key, resolveHistoryLoadingSlotCount(HISTORY_MORE_LIMIT));
    armHistoryRequestTimeout(key, "before");
    store.set((prev) => applyConversationHistorySyncState(prev, key, { loading: true }));
    debugHook("history.request", { key, mode: "more", before, kind: st.selected?.kind, force: false, prefetchBefore: false });
    if (!shouldUseHistoryNetwork(key, "more", 3000)) {
      historyRequested.delete(key);
      clearHistoryRequestTimer(key, "before");
      clearHistoryLoadingSlots(key);
      store.set((prev) => applyConversationHistorySyncState(prev, key, { loading: false }));
      return;
    }
    if (st.selected.kind === "dm") {
      send({ type: "history", peer: st.selected.id, before_id: before, limit: 200 });
    } else {
      send({ type: "history", room: st.selected.id, before_id: before, limit: 200 });
    }
  };

  const markChatAutoScroll: HistoryFeature["markChatAutoScroll"] = (key: string, waitForHistory = false) => {
    const k = String(key || "").trim();
    if (!k) return;
    if (!waitForHistory) markChatPendingBottomStick(chatHost, k);
    pendingChatAutoScroll = { key: k, waitForHistory };
  };

  const applyPendingAutoScrollAfterRender: HistoryFeature["applyPendingAutoScrollAfterRender"] = (st) => {
    const autoScrollKey = st.selected ? conversationKey(st.selected) : "";
    if (pendingChatAutoScroll && pendingChatAutoScroll.key !== autoScrollKey) {
      pendingChatAutoScroll = null;
    }
    if (pendingChatAutoScroll && autoScrollKey && st.page === "main" && (!st.modal || st.modal.kind === "context_menu")) {
      const waitForHistory = pendingChatAutoScroll.waitForHistory;
      const loaded = Boolean(getConversationHistorySyncState(st, autoScrollKey).loaded);
      if (!waitForHistory || loaded) {
        scrollToBottom(autoScrollKey);
        pendingChatAutoScroll = null;
      }
    }
  };

  const maybeAutoLoadMoreOnScroll: HistoryFeature["maybeAutoLoadMoreOnScroll"] = ({ scrollTop, scrollingUp, lastUserScrollAt }) => {
    const now = Date.now();
    if (now < historyAutoBlockUntil) return;
    if (historyViewportRecentlyCompensated(chatHost, 350, now)) return;
    const userScrollRecent = now - lastUserScrollAt < 2500;
    if (!userScrollRecent) return;

    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    if (!st.selected) return;

    const key = conversationKey(st.selected);
    if (!key) return;
    if (!getConversationHistorySyncState(st, key).loaded) return;
    if (!canLoadOlderHistory(st, key, "scroll")) return;
    if (getConversationHistorySyncState(st, key).loading) return;
    if (historyRequested.has(key)) return;
    const maxTop = Math.max(0, chatHost.scrollHeight - chatHost.clientHeight);
    const atBottom = scrollTop >= maxTop - 24;
    if (atBottom) {
      const last = historyBottomSyncAt.get(key) || 0;
      if (now - last >= HISTORY_BOTTOM_SYNC_MIN_MS) {
        historyBottomSyncAt.set(key, now);
        debugHook("history.bottom_sync", { key, mode: "scroll", deltaLimit: 2000 });
        requestHistory(st.selected, { deltaLimit: 2000 });
      }
      return;
    }

    const cursor = getConversationHistorySyncState(st, key).cursor;
    if (!cursor || !Number.isFinite(cursor) || cursor <= 0) return;

    // Telegram-like: если пользователь доскроллил до верха — подтянуть более ранние сообщения.
    const nearTopThreshold = Math.max(96, Math.min(220, Math.round(chatHost.clientHeight * 0.25)));
    const nearTop = scrollTop <= nearTopThreshold;
    if (!nearTop) return;
    // Чтобы не "заливать" историю при каждом маленьком скролле — требуем только явный upward-скролл
    // или действительно верхнюю границу (когда scrollTop ≈ 0).
    if (!scrollingUp && scrollTop > 4) return;

    if (key === lastHistoryAutoKey && now - lastHistoryAutoAt < 900) return;
    lastHistoryAutoKey = key;
    lastHistoryAutoAt = now;
    historyAutoBlockUntil = now + 200;
    requestMoreHistory();
  };

  const maybeFillViewport: HistoryFeature["maybeFillViewport"] = () => {
    const now = Date.now();
    if (now < historyAutoBlockUntil) return;
    if (historyViewportRecentlyCompensated(chatHost, 350, now)) return;

    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    if (!st.selected) return;

    const key = conversationKey(st.selected);
    if (!key) return;
    if (!getConversationHistorySyncState(st, key).loaded) return;
    if (!canLoadOlderHistory(st, key, "fill")) return;
    if (getConversationHistorySyncState(st, key).loading) return;
    if (historyRequested.has(key)) return;
    const cursor = getConversationHistorySyncState(st, key).cursor;
    if (!cursor || !Number.isFinite(cursor) || cursor <= 0) return;

    if (chatHost.scrollHeight > chatHost.clientHeight + 32) return;
    if (key === lastHistoryFillKey && now - lastHistoryFillAt < 900) return;
    lastHistoryFillKey = key;
    lastHistoryFillAt = now;
    historyAutoBlockUntil = now + 200;
    requestMoreHistory();
  };

  const maybeAutoRetrySelected: HistoryFeature["maybeAutoRetrySelected"] = () => {
    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    if (!st.selected) return;

    const key = conversationKey(st.selected);
    if (!key) return;
    const sync = getConversationHistorySyncState(st, key);
    if (sync.loaded) return;
    if (sync.loading) return;
    if (historyRequested.has(key)) return;

    const now = Date.now();
    const last = historyAutoRetryAt.get(key) || 0;
    if (now - last < HISTORY_AUTO_RETRY_MS) return;
    historyAutoRetryAt.set(key, now);
    clearHistoryRequestTimers(key, { resetAttempts: true });
    requestHistory(st.selected, { force: true, deltaLimit: 2000 });
  };

  const forceRetrySelected: HistoryFeature["forceRetrySelected"] = (t) => {
    const key = conversationKey(t);
    if (key) {
      historyRequested.delete(key);
      historyDeltaRequested.delete(key);
      historyPreviewRequested.delete(key);
      clearHistoryRequestTimers(key, { resetAttempts: true });
    }
    requestHistory(t, { force: true, deltaLimit: 2000 });
  };

  const clearPendingRequests: HistoryFeature["clearPendingRequests"] = () => {
    if (
      !historyRequested.size &&
      !historyDeltaRequested.size &&
      !historyPreviewRequested.size &&
      !historyPrefetchRequested.size &&
      !historyWarmupQueue.length &&
      !historyWarmupInFlight.size &&
      !historyWarmupRequested.size &&
      !historyWarmupQueued.size &&
      !historyBackfillQueue.length &&
      !historyBackfillInFlight.size
    ) {
      return;
    }
    const pendingBefore = new Set<string>(historyRequested);
    const pendingAll = new Set<string>([
      ...historyRequested,
      ...historyDeltaRequested,
      ...historyPreviewRequested,
      ...historyPrefetchRequested,
    ]);
    historyRequested.clear();
    historyDeltaRequested.clear();
    historyPreviewRequested.clear();
    historyPrefetchRequested.clear();
    historyPrefetchBootstrap.clear();
    historyWarmupQueue.length = 0;
    historyWarmupQueued.clear();
    historyWarmupRequested.clear();
    historyWarmupInFlight.clear();
    historyBackfillQueue.length = 0;
    historyBackfillQueued.clear();
    for (const key of historyBackfillInFlight) clearHistoryBackfillTimer(key);
    historyBackfillInFlight.clear();
    historyPreviewQueue.length = 0;
    if (historyPreviewTimer !== null) {
      try {
        window.clearTimeout(historyPreviewTimer);
      } catch {
        // ignore
      }
      historyPreviewTimer = null;
    }
    if (historyWarmupTimer !== null) {
      try {
        window.clearTimeout(historyWarmupTimer);
      } catch {
        // ignore
      }
      historyWarmupTimer = null;
    }
    for (const key of pendingAll) {
      clearHistoryRequestTimers(key);
      clearHistoryPrefetchTimer(key);
    }
    for (const timer of historyWarmupTimers.values()) {
      try {
        window.clearTimeout(timer);
      } catch {
        // ignore
      }
    }
    historyWarmupTimers.clear();
    for (const timer of historyBackfillTimers.values()) {
      try {
        window.clearTimeout(timer);
      } catch {
        // ignore
      }
    }
    historyBackfillTimers.clear();
    store.set((prev) => {
      if (!pendingBefore.size) return prev;
      for (const key of pendingBefore) {
        if (!getConversationHistorySyncState(prev, key).loading) continue;
        prev = applyConversationHistorySyncState(prev, key, { loading: false, loadingSlots: 0 });
      }
      return prev;
    });
  };

  const handleHistoryResultMessage: HistoryFeature["handleHistoryResultMessage"] = (msg) => {
    const key = msg?.room ? roomKey(String(msg.room)) : msg?.peer ? dmKey(String(msg.peer)) : "";
    const rawHasMore = (msg as any).has_more;
    const rows = Array.isArray(msg?.rows) ? msg.rows : [];
    const before = msg?.before_id;
    const preview = Boolean(msg?.preview);
    const st = store.get();
    debugHook("history.result", {
      key,
      rows: Array.isArray(rows) ? rows.length : 0,
      before: before ?? null,
      preview,
      hasMore: rawHasMore !== undefined ? Boolean(rawHasMore) : undefined,
      readUpToId: msg?.read_up_to_id ?? null,
      hasHistoryLoading: Boolean(key && getConversationHistorySyncState(st, key).loading),
    });
    if (!key) return;
    const isPreview = Boolean(msg?.preview);
    const isBefore = msg?.before_id !== undefined && msg?.before_id !== null;
    const priorHasMore = getConversationHistorySyncState(st, key).hasMore;
    if (!preview && priorHasMore === false && isBefore) {
      if (rows.length > 0) {
        if (rawHasMore === false) {
          markHistoryHasMoreBypass(key);
        } else {
          clearHistoryHasMoreBypass(key);
        }
      } else {
        clearHistoryHasMoreBypass(key);
      }
    } else if (rawHasMore === true) {
      clearHistoryHasMoreBypass(key);
    }
    if (isPreview) {
      historyPreviewRequested.delete(key);
    } else {
      clearHistoryLoadingSlots(key);
      if (isBefore) {
        if (historyRequested.has(key)) {
          historyRequested.delete(key);
          clearHistoryRequestTimer(key, "before", { resetAttempts: true });
        } else if (historyPrefetchRequested.has(key)) {
          historyPrefetchRequested.delete(key);
          clearHistoryPrefetchTimer(key);
        } else {
          clearHistoryRequestTimer(key, "before", { resetAttempts: true });
        }
      } else {
        historyDeltaRequested.delete(key);
        clearHistoryRequestTimer(key, "delta", { resetAttempts: true });
      }
      historyPreviewRequested.delete(key);
    }
    if (historyWarmupInFlight.has(key)) {
      historyWarmupInFlight.delete(key);
      clearHistoryWarmupTimer(key);
      scheduleWarmup();
    }
    if (historyBackfillInFlight.has(key)) {
      historyBackfillInFlight.delete(key);
      clearHistoryBackfillTimer(key);
      scheduleBackfill();
    }
  };

  const maybeBootstrapPrefetch: HistoryFeature["maybeBootstrapPrefetch"] = (st) => {
    if (!st.authed || !st.selfId || !st.selected) return;
    if (!canRunBackgroundHistory()) return;
    const key = conversationKey(st.selected);
    const cursor = key ? getConversationHistorySyncState(st, key).cursor : null;
    if (
      key &&
      getConversationHistorySyncState(st, key).loaded &&
      canLoadOlderHistory(st, key, "bootstrap") &&
      typeof cursor === "number" &&
      Number.isFinite(cursor) &&
      cursor > 0 &&
      !historyPrefetchBootstrap.has(key) &&
      !historyPrefetchRequested.has(key) &&
      !historyRequested.has(key) &&
      !historyDeltaRequested.has(key) &&
      !getConversationHistorySyncState(st, key).loading
    ) {
      historyPrefetchBootstrap.add(key);
      requestHistory(st.selected, { prefetchBefore: true });
    }
  };

  const hasPendingActivityForUpdate: HistoryFeature["hasPendingActivityForUpdate"] = () =>
    Boolean(
      historyRequested.size ||
        historyDeltaRequested.size ||
        historyPreviewRequested.size ||
        historyPreviewQueue.length ||
        historyPreviewTimer !== null ||
        historyPrefetchRequested.size ||
        historyWarmupInFlight.size ||
        historyWarmupQueue.length ||
        historyWarmupTimer !== null ||
        historyBackfillInFlight.size ||
        historyBackfillQueue.length ||
        historyBackfillTimer !== null
    );
  registerPwaReloadBlocker("history", hasPendingActivityForUpdate);

  const onDisconnect: HistoryFeature["onDisconnect"] = () => {
    clearPendingRequests();
    historyDeltaRequestedAt.clear();
    clearAllHistoryHasMoreBypass();
    historyBottomSyncAt.clear();
  };

  const onLogout: HistoryFeature["onLogout"] = () => {
    clearPendingRequests();
    historyDeltaRequestedAt.clear();
    historyPreviewLastAt.clear();
    historyNetworkLastAt.clear();
    clearAllHistoryHasMoreBypass();
    historyBottomSyncAt.clear();
  };

  return {
    requestHistory,
    requestMoreHistory,
    enqueueHistoryPreview,
    scheduleWarmup,
    scheduleBackfill,
    maybeAutoLoadMoreOnScroll,
    maybeFillViewport,
    maybeAutoRetrySelected,
    forceRetrySelected,
    clearPendingRequests,
    handleHistoryResultMessage,
    onDisconnect,
    onLogout,
    markChatAutoScroll,
    applyPendingAutoScrollAfterRender,
    maybeBootstrapPrefetch,
    hasPendingActivityForUpdate,
  };
}
