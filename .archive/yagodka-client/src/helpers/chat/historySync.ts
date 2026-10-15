import type {
  AppState,
  ChatMessage,
  ConversationHistoryEmptyNotice,
  ConversationHistoryEmptyNoticeKind,
  ConversationHistoryEmptyNoticeScope,
  ConversationHistorySyncState,
  HistorySyncSource,
} from "../../stores/types";

export function newestServerMessageId(msgs: ChatMessage[]): number | null {
  let max: number | null = null;
  for (const m of msgs) {
    const id = m.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    if (max === null || id > max) max = id;
  }
  return max;
}

function normalizeCursor(raw: unknown): number | null {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return n > 0 ? n : null;
}

function normalizeLoadingSlots(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return n > 0 ? Math.max(0, Math.min(12, n)) : 0;
}

function normalizeVirtualStart(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return n > 0 ? n : 0;
}

function normalizeSource(raw: unknown, fallback: HistorySyncSource): HistorySyncSource {
  const value = String(raw || "").trim().toLowerCase();
  return value === "cache" || value === "server" || value === "empty" ? (value as HistorySyncSource) : fallback;
}

function normalizeLastServerAt(raw: unknown): number | null {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return n > 0 ? n : null;
}

function normalizeEmptyNoticeKind(raw: unknown): ConversationHistoryEmptyNoticeKind {
  const value = String(raw || "").trim();
  return value === "message_deleted" ? "message_deleted" : "cleared";
}

function normalizeEmptyNoticeScope(raw: unknown): ConversationHistoryEmptyNoticeScope {
  const value = String(raw || "").trim();
  return value === "dm" || value === "room" || value === "unknown" ? value : "unknown";
}

function normalizeDeletedCount(raw: unknown): number | null {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return n > 0 ? n : null;
}

export function createConversationHistoryEmptyNotice(
  patch?: Partial<ConversationHistoryEmptyNotice> | null
): ConversationHistoryEmptyNotice | null {
  if (!patch || typeof patch !== "object") return null;
  const byRaw = typeof patch.by === "string" ? patch.by.trim() : "";
  return {
    kind: normalizeEmptyNoticeKind(patch.kind),
    scope: normalizeEmptyNoticeScope(patch.scope),
    by: byRaw || null,
    at: normalizeLastServerAt(patch.at),
    deleted: normalizeDeletedCount(patch.deleted),
  };
}

export function createConversationHistorySyncState(
  patch?: Partial<ConversationHistorySyncState> | null
): ConversationHistorySyncState {
  const loaded = Boolean(patch?.loaded);
  const previewOnly = Boolean(patch?.previewOnly);
  const source = normalizeSource(patch?.source, previewOnly ? "cache" : loaded ? "server" : "empty");
  return {
    loaded,
    previewOnly,
    cursor: normalizeCursor(patch?.cursor),
    hasMore: typeof patch?.hasMore === "boolean" ? patch.hasMore : null,
    loading: Boolean(patch?.loading),
    loadingSlots: normalizeLoadingSlots(patch?.loadingSlots),
    virtualStart: normalizeVirtualStart(patch?.virtualStart),
    source,
    reconcilePending: Boolean(
      patch?.reconcilePending ??
        (source === "cache" && (loaded || previewOnly))
    ),
    lastServerAt: normalizeLastServerAt(patch?.lastServerAt),
    emptyNotice: createConversationHistoryEmptyNotice(patch?.emptyNotice),
  };
}

export function historySyncStateFromLegacy(state: AppState, key: string): ConversationHistorySyncState {
  const loaded = Boolean(state.historyLoaded?.[key]);
  const previewOnly = Boolean(state.historyPreviewOnly?.[key]);
  const cursor = normalizeCursor(state.historyCursor?.[key]);
  const hasMore = typeof state.historyHasMore?.[key] === "boolean" ? Boolean(state.historyHasMore[key]) : null;
  const loading = Boolean(state.historyLoading?.[key]);
  const loadingSlots = normalizeLoadingSlots(state.historyLoadingSlots?.[key]);
  const virtualStart = normalizeVirtualStart(state.historyVirtualStart?.[key]);
  return createConversationHistorySyncState({
    loaded,
    previewOnly,
    cursor,
    hasMore,
    loading,
    loadingSlots,
    virtualStart,
    source: previewOnly ? "cache" : loaded ? "server" : "empty",
    reconcilePending: previewOnly,
    lastServerAt: !previewOnly && loaded ? Date.now() : null,
  });
}

export function getConversationHistorySyncState(state: AppState, key: string): ConversationHistorySyncState {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return createConversationHistorySyncState();
  const raw = state.historySync?.[cleanKey];
  if (!raw) return historySyncStateFromLegacy(state, cleanKey);
  return createConversationHistorySyncState({
    ...raw,
    loaded: Boolean(state.historyLoaded?.[cleanKey]),
    previewOnly: Boolean(state.historyPreviewOnly?.[cleanKey]),
    cursor: state.historyCursor?.[cleanKey],
    hasMore: Object.prototype.hasOwnProperty.call(state.historyHasMore || {}, cleanKey)
      ? state.historyHasMore?.[cleanKey]
      : null,
    loading: Boolean(state.historyLoading?.[cleanKey]),
    loadingSlots: state.historyLoadingSlots?.[cleanKey],
    virtualStart: state.historyVirtualStart?.[cleanKey],
  });
}

function putBooleanFlag(map: Record<string, boolean>, key: string, value: boolean): Record<string, boolean> {
  if (!value) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) return map;
    const next = { ...map };
    delete next[key];
    return next;
  }
  if (map[key] === true) return map;
  return { ...map, [key]: true };
}

function putBooleanTriState(map: Record<string, boolean>, key: string, value: boolean | null): Record<string, boolean> {
  if (typeof value !== "boolean") {
    if (!Object.prototype.hasOwnProperty.call(map, key)) return map;
    const next = { ...map };
    delete next[key];
    return next;
  }
  if (map[key] === value) return map;
  return { ...map, [key]: value };
}

function putPositiveNumber(map: Record<string, number>, key: string, value: number): Record<string, number> {
  if (!(value > 0)) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) return map;
    const next = { ...map };
    delete next[key];
    return next;
  }
  if (map[key] === value) return map;
  return { ...map, [key]: value };
}

function putNonNegativeNumber(map: Record<string, number>, key: string, value: number): Record<string, number> {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  const nextValue = Math.max(0, n);
  if (map[key] === nextValue) return map;
  return { ...map, [key]: nextValue };
}

export function applyConversationHistorySyncState(
  prev: AppState,
  key: string,
  patch: Partial<ConversationHistorySyncState>
): AppState {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return prev;
  const current = getConversationHistorySyncState(prev, cleanKey);
  const nextState = createConversationHistorySyncState({ ...current, ...patch });
  const prevRaw = prev.historySync?.[cleanKey];
  const nextHistorySync =
    prevRaw &&
    JSON.stringify(prevRaw) === JSON.stringify(nextState)
      ? prev.historySync
      : { ...(prev.historySync || {}), [cleanKey]: nextState };

  const nextHistoryLoaded = putBooleanFlag(prev.historyLoaded || {}, cleanKey, nextState.loaded);
  const nextHistoryPreviewOnly = putBooleanFlag(prev.historyPreviewOnly || {}, cleanKey, nextState.previewOnly);
  const nextHistoryCursor = putPositiveNumber(prev.historyCursor || {}, cleanKey, nextState.cursor || 0);
  const nextHistoryHasMore = putBooleanTriState(prev.historyHasMore || {}, cleanKey, nextState.hasMore);
  const nextHistoryLoading = putBooleanFlag(prev.historyLoading || {}, cleanKey, nextState.loading);
  const nextHistoryLoadingSlots = putPositiveNumber(prev.historyLoadingSlots || {}, cleanKey, nextState.loadingSlots);
  const prevHistoryVirtualStart = prev.historyVirtualStart || {};
  const hasVirtualStartPatch = Object.prototype.hasOwnProperty.call(patch, "virtualStart");
  const hasPrevVirtualStart = Object.prototype.hasOwnProperty.call(prevHistoryVirtualStart, cleanKey);
  const nextHistoryVirtualStart =
    hasVirtualStartPatch || hasPrevVirtualStart
      ? putNonNegativeNumber(prevHistoryVirtualStart, cleanKey, nextState.virtualStart)
      : prevHistoryVirtualStart;

  return {
    ...prev,
    historySync: nextHistorySync,
    historyLoaded: nextHistoryLoaded,
    historyPreviewOnly: nextHistoryPreviewOnly,
    historyCursor: nextHistoryCursor,
    historyHasMore: nextHistoryHasMore,
    historyLoading: nextHistoryLoading,
    historyLoadingSlots: nextHistoryLoadingSlots,
    historyVirtualStart: nextHistoryVirtualStart,
  };
}

export function dropConversationHistorySyncState(prev: AppState, key: string): AppState {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return prev;
  const nextHistorySync = { ...(prev.historySync || {}) };
  delete nextHistorySync[cleanKey];
  const nextHistoryLoaded = { ...(prev.historyLoaded || {}) };
  delete nextHistoryLoaded[cleanKey];
  const nextHistoryPreviewOnly = { ...(prev.historyPreviewOnly || {}) };
  delete nextHistoryPreviewOnly[cleanKey];
  const nextHistoryCursor = { ...(prev.historyCursor || {}) };
  delete nextHistoryCursor[cleanKey];
  const nextHistoryHasMore = { ...(prev.historyHasMore || {}) };
  delete nextHistoryHasMore[cleanKey];
  const nextHistoryLoading = { ...(prev.historyLoading || {}) };
  delete nextHistoryLoading[cleanKey];
  const nextHistoryLoadingSlots = { ...(prev.historyLoadingSlots || {}) };
  delete nextHistoryLoadingSlots[cleanKey];
  const nextHistoryVirtualStart = { ...(prev.historyVirtualStart || {}) };
  delete nextHistoryVirtualStart[cleanKey];
  return {
    ...prev,
    historySync: nextHistorySync,
    historyLoaded: nextHistoryLoaded,
    historyPreviewOnly: nextHistoryPreviewOnly,
    historyCursor: nextHistoryCursor,
    historyHasMore: nextHistoryHasMore,
    historyLoading: nextHistoryLoading,
    historyLoadingSlots: nextHistoryLoadingSlots,
    historyVirtualStart: nextHistoryVirtualStart,
  };
}

export function buildCacheHydratedHistorySyncMap(
  historyLoaded: Record<string, boolean>,
  historyCursor: Record<string, number>,
  historyHasMore: Record<string, boolean>
): Record<string, ConversationHistorySyncState> {
  const out: Record<string, ConversationHistorySyncState> = {};
  const keys = new Set<string>([
    ...Object.keys(historyLoaded || {}),
    ...Object.keys(historyCursor || {}),
    ...Object.keys(historyHasMore || {}),
  ]);
  for (const key of keys) {
    const loaded = Boolean(historyLoaded?.[key]);
    const cursor = normalizeCursor(historyCursor?.[key]);
    const hasMore = typeof historyHasMore?.[key] === "boolean" ? Boolean(historyHasMore[key]) : null;
    out[key] = createConversationHistorySyncState({
      loaded,
      previewOnly: loaded || cursor !== null,
      cursor,
      hasMore,
      loading: false,
      loadingSlots: 0,
      virtualStart: 0,
      source: loaded || cursor !== null ? "cache" : "empty",
      reconcilePending: loaded || cursor !== null,
      lastServerAt: null,
    });
  }
  return out;
}
