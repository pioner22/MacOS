import type {
  ChatAttachment,
  ChatMessage,
  ChatMessageRef,
  ConversationHistoryEmptyNotice,
  ConversationHistorySyncState,
  MessageReactions,
} from "../../stores/types";
import type { StorageLike } from "./drafts";
import { APP_MSG_MAX_LEN } from "../../config/app";
import { buildCacheHydratedHistorySyncMap, createConversationHistorySyncState } from "./historySync";

const HISTORY_CACHE_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_CACHE_MAX_AGE_MS = 45 * DAY_MS;
const HISTORY_CACHE_MAX_CONVERSATIONS = 400;
const HISTORY_CACHE_MAX_MESSAGES = 2800;
const IOS_HISTORY_CACHE_MAX_AGE_MS = 21 * DAY_MS;
const IOS_HISTORY_CACHE_MAX_CONVERSATIONS = 80;
const IOS_HISTORY_CACHE_MAX_MESSAGES = 220;
const HISTORY_CACHE_MAX_RAW_BYTES = 2_400_000;
const IOS_HISTORY_CACHE_MAX_RAW_BYTES = 850_000;
const HISTORY_CACHE_MAX_KEY_LEN = 96;

type HistoryCachePayload = {
  v: number;
  updated: number;
  conversations: Record<string, ChatMessage[]>;
  cursors: Record<string, number>;
  hasMore: Record<string, boolean>;
  loaded?: string[];
  emptyNotices?: Record<string, ConversationHistoryEmptyNotice>;
};

export type HistoryCache = {
  conversations: Record<string, ChatMessage[]>;
  historyCursor: Record<string, number>;
  historyHasMore: Record<string, boolean>;
  historyLoaded: Record<string, boolean>;
  historySync: Record<string, ConversationHistorySyncState>;
};

type HistoryCacheLimits = {
  maxAgeMs: number;
  maxConversations: number;
  maxMessages: number;
  maxRawBytes: number;
};

function debugPush(kind: string, data?: any): void {
  try {
    const api = (globalThis as any)?.__yagodka_debug_monitor;
    if (api && typeof api.push === "function") api.push(kind, data);
  } catch {
    // ignore
  }
}

function debugPushError(kind: string, err: unknown, extra?: any): void {
  try {
    const api = (globalThis as any)?.__yagodka_debug_monitor;
    if (api && typeof api.pushError === "function") api.pushError(kind, err, extra);
  } catch {
    // ignore
  }
}

function isQuotaExceededError(err: unknown): boolean {
  try {
    const name = err && typeof err === "object" ? String((err as any).name || "") : "";
    if (name === "QuotaExceededError") return true;
    const msg = err instanceof Error ? String(err.message || "") : String(err || "");
    return /quota/i.test(msg);
  } catch {
    return false;
  }
}

function isAppleMobile(): boolean {
  try {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    const ua = String(nav?.userAgent || "");
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS often reports "Macintosh" but has touch points.
    if (/Macintosh/i.test(ua) && Number(nav?.maxTouchPoints || 0) > 1) return true;
    return false;
  } catch {
    return false;
  }
}

function cacheLimits(): HistoryCacheLimits {
  const appleMobile = isAppleMobile();
  return {
    maxAgeMs: appleMobile ? IOS_HISTORY_CACHE_MAX_AGE_MS : HISTORY_CACHE_MAX_AGE_MS,
    maxConversations: appleMobile ? IOS_HISTORY_CACHE_MAX_CONVERSATIONS : HISTORY_CACHE_MAX_CONVERSATIONS,
    maxMessages: appleMobile ? IOS_HISTORY_CACHE_MAX_MESSAGES : HISTORY_CACHE_MAX_MESSAGES,
    maxRawBytes: appleMobile ? IOS_HISTORY_CACHE_MAX_RAW_BYTES : HISTORY_CACHE_MAX_RAW_BYTES,
  };
}

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_chat_history_v${HISTORY_CACHE_VERSION}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

function sanitizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length <= APP_MSG_MAX_LEN) return value;
  return value.slice(0, APP_MSG_MAX_LEN);
}

function sanitizeAttachment(raw: unknown): ChatAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const att = raw as any;
  const kind = String(att.kind || "");
  if (kind === "file") {
    const name = String(att.name || "").trim();
    if (!name) return null;
    const size = Number(att.size ?? 0);
    const fileId = typeof att.fileId === "string" ? att.fileId : null;
    const localId = typeof att.localId === "string" ? att.localId : null;
    const mime = typeof att.mime === "string" ? att.mime : null;
    return {
      kind: "file",
      name,
      size: Number.isFinite(size) ? size : 0,
      ...(fileId ? { fileId } : {}),
      ...(localId ? { localId } : {}),
      ...(mime ? { mime } : {}),
    };
  }
  if (kind === "action") {
    const payload = att.payload && typeof att.payload === "object" ? att.payload : null;
    if (!payload) return null;
    return { kind: "action", payload };
  }
  return null;
}

function sanitizeRef(raw: unknown): ChatMessageRef | null {
  if (!raw || typeof raw !== "object") return null;
  const ref = raw as any;
  const next: ChatMessageRef = {};
  const id = ref.id;
  if (typeof id === "number" && Number.isFinite(id)) next.id = id;
  if (id === null) next.id = null;
  const localId = typeof ref.localId === "string" ? ref.localId.trim() : "";
  if (localId) next.localId = localId;
  const from = typeof ref.from === "string" ? ref.from.trim() : "";
  if (from) next.from = from;
  const text = sanitizeText(ref.text);
  if (text) next.text = text;
  const attachment = sanitizeAttachment(ref.attachment);
  if (attachment) next.attachment = attachment;
  const viaBot = typeof ref.via_bot === "string" ? ref.via_bot.trim() : "";
  if (viaBot) next.via_bot = viaBot;
  const postAuthor = typeof ref.post_author === "string" ? ref.post_author.trim() : "";
  if (postAuthor) next.post_author = postAuthor;
  if (ref.hidden_profile === true) next.hidden_profile = true;
  return Object.keys(next).length ? next : null;
}

function sanitizeReactions(raw: unknown): MessageReactions | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as any;
  const countsRaw = rec.counts;
  if (!countsRaw || typeof countsRaw !== "object") return null;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(countsRaw as Record<string, unknown>)) {
    const key = String(k || "").trim();
    const num = Number(v);
    if (!key || !Number.isFinite(num) || num <= 0) continue;
    counts[key] = Math.floor(num);
  }
  const mine = typeof rec.mine === "string" ? rec.mine : null;
  if (!Object.keys(counts).length && !mine) return null;
  return mine ? { counts, mine } : { counts };
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as any;
  const kind = msg.kind === "in" || msg.kind === "out" || msg.kind === "sys" ? msg.kind : null;
  if (!kind) return null;
  const ts = Number(msg.ts ?? 0);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const from = typeof msg.from === "string" ? msg.from : kind === "sys" ? "" : "";
  if (!from && kind !== "sys") return null;
  const next: ChatMessage = {
    kind,
    ts,
    from,
    text: sanitizeText(msg.text),
  };
  const to = typeof msg.to === "string" ? msg.to.trim() : "";
  if (to) next.to = to;
  const room = typeof msg.room === "string" ? msg.room.trim() : "";
  if (room) next.room = room;
  const localId = typeof msg.localId === "string" ? msg.localId.trim() : "";
  if (localId) next.localId = localId;
  const id = msg.id;
  if (typeof id === "number" && Number.isFinite(id)) next.id = id;
  if (id === null) next.id = null;
  const status = msg.status;
  if (status === "sending" || status === "queued" || status === "sent" || status === "delivered" || status === "read" || status === "error")
    next.status = status;
  if (msg.edited === true) next.edited = true;
  if (typeof msg.edited_ts === "number" && Number.isFinite(msg.edited_ts)) next.edited_ts = msg.edited_ts;
  const attachment = sanitizeAttachment(msg.attachment);
  if (attachment) next.attachment = attachment;
  const reply = sanitizeRef(msg.reply);
  if (reply) next.reply = reply;
  const forward = sanitizeRef(msg.forward);
  if (forward) next.forward = forward;
  const reactions = sanitizeReactions(msg.reactions);
  if (reactions) next.reactions = reactions;
  if (msg.whenOnline === true) next.whenOnline = true;
  if (typeof msg.scheduleAt === "number" && Number.isFinite(msg.scheduleAt)) next.scheduleAt = msg.scheduleAt;
  return next;
}

function sortTs(m: ChatMessage): number {
  const ts = Number(m.ts);
  return Number.isFinite(ts) ? ts : 0;
}

function sortId(m: ChatMessage): number {
  const id = m.id;
  const n = typeof id === "number" ? id : id == null ? 0 : Number(id);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeMessageList(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const msg = sanitizeMessage(item);
    if (!msg) continue;
    out.push(msg);
  }
  out.sort((a, b) => {
    const at = sortTs(a);
    const bt = sortTs(b);
    if (at !== bt) return at - bt;
    const ai = sortId(a);
    const bi = sortId(b);
    if (ai !== bi) return ai - bi;
    const al = typeof a.localId === "string" ? a.localId : "";
    const bl = typeof b.localId === "string" ? b.localId : "";
    if (al !== bl) return al.localeCompare(bl);
    return 0;
  });
  return out;
}

function oldestId(list: ChatMessage[]): number | null {
  let min: number | null = null;
  for (const m of list) {
    const id = m.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    min = min === null ? id : Math.min(min, id);
  }
  return min;
}

function trimTail(list: ChatMessage[], maxMessages: number): ChatMessage[] {
  const capRaw = Number(maxMessages || 0);
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.max(50, Math.min(5000, Math.floor(capRaw))) : HISTORY_CACHE_MAX_MESSAGES;
  if (list.length <= cap) return list;
  return list.slice(Math.max(0, list.length - cap));
}

function sanitizeConversationMap(raw: unknown, limits: { maxMessages: number }): Record<string, ChatMessage[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ChatMessage[]> = {};
  for (const [kRaw, vRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof kRaw !== "string") continue;
    const key = kRaw.trim();
    if (!key || key.length > HISTORY_CACHE_MAX_KEY_LEN) continue;
    const list = sanitizeMessageList(vRaw);
    if (!list.length) continue;
    out[key] = trimTail(list, limits.maxMessages);
  }
  return out;
}

function sanitizeCursorMap(raw: unknown, allowed: Set<string>): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [kRaw, vRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof kRaw !== "string") continue;
    const key = kRaw.trim();
    if (!key || !allowed.has(key)) continue;
    const num = Number(vRaw);
    if (!Number.isFinite(num) || num <= 0) continue;
    out[key] = Math.floor(num);
  }
  return out;
}

function sanitizeHasMoreMap(raw: unknown, allowed: Set<string>): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [kRaw, vRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof kRaw !== "string") continue;
    const key = kRaw.trim();
    if (!key || !allowed.has(key)) continue;
    if (typeof vRaw !== "boolean") continue;
    out[key] = vRaw;
  }
  return out;
}

function sanitizeLoadedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim();
    if (!key || key.length > HISTORY_CACHE_MAX_KEY_LEN) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function sanitizeEmptyNoticeMap(raw: unknown, allowed: Set<string>): Record<string, ConversationHistoryEmptyNotice> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ConversationHistoryEmptyNotice> = {};
  for (const [kRaw, vRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof kRaw !== "string") continue;
    const key = kRaw.trim();
    if (!key || !allowed.has(key)) continue;
    const notice = createConversationHistorySyncState({ emptyNotice: vRaw as any }).emptyNotice;
    if (notice) out[key] = notice;
  }
  return out;
}

export function loadHistoryCacheForUser(userId: string, storage?: StorageLike | null): HistoryCache {
  const key = storageKey(userId);
  if (!key) return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {}, historySync: {} };
  const st = storage ?? defaultStorage();
  if (!st) return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {}, historySync: {} };
  const limits = cacheLimits();
  try {
    const raw = st.getItem(key);
    if (!raw) return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {}, historySync: {} };
    if (raw.length > limits.maxRawBytes) {
      debugPush("history_cache.load.skip_oversize", {
        bytes: raw.length,
        maxRawBytes: limits.maxRawBytes,
        maxConversations: limits.maxConversations,
        maxMessages: limits.maxMessages,
      });
      try {
        st.removeItem(key);
      } catch {
        // ignore
      }
      return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {}, historySync: {} };
    }
    const parsed = JSON.parse(raw) as HistoryCachePayload;
    if (!parsed || typeof parsed !== "object") return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {}, historySync: {} };
    if (parsed.v !== HISTORY_CACHE_VERSION) return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {}, historySync: {} };
    const updated = Number(parsed.updated ?? 0);
    if (!Number.isFinite(updated) || Date.now() - updated > limits.maxAgeMs) {
      try {
        st.removeItem(key);
      } catch {
        // ignore
      }
      return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {}, historySync: {} };
    }
    const conversations = sanitizeConversationMap(parsed.conversations, limits);
    const loadedKeys = sanitizeLoadedKeys(parsed.loaded);
    const historyLoaded: Record<string, boolean> = {};
    for (const key of loadedKeys) historyLoaded[key] = true;
    for (const key of Object.keys(conversations)) historyLoaded[key] = true;
    const allowed = new Set(Object.keys(historyLoaded));
    const historyCursor = sanitizeCursorMap(parsed.cursors, allowed);
    const historyHasMore = sanitizeHasMoreMap(parsed.hasMore, allowed);
    const historySync = buildCacheHydratedHistorySyncMap(historyLoaded, historyCursor, historyHasMore);
    const emptyNotices = sanitizeEmptyNoticeMap(parsed.emptyNotices, allowed);
    for (const [noticeKey, emptyNotice] of Object.entries(emptyNotices)) {
      historySync[noticeKey] = createConversationHistorySyncState({
        ...(historySync[noticeKey] || {}),
        emptyNotice,
      });
    }
    return { conversations, historyCursor, historyHasMore, historyLoaded, historySync };
  } catch {
    return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {}, historySync: {} };
  }
}

function buildEncodedHistoryCache(
  payload: {
    conversations: Record<string, ChatMessage[]>;
    historyCursor: Record<string, number>;
    historyHasMore: Record<string, boolean>;
    historyLoaded: Record<string, boolean>;
    historyEmptyNotices?: Record<string, ConversationHistoryEmptyNotice>;
  },
  limits: { maxConversations: number; maxMessages: number }
): HistoryCachePayload | null {
  const safe = sanitizeConversationMap(payload.conversations, { maxMessages: limits.maxMessages });
  const entries = Object.entries(safe)
    .map(([k, list]) => {
      const last = list.length ? list[list.length - 1] : null;
      const lastKey = last ? Number(last.id ?? last.ts ?? 0) : 0;
      return { key: k, list, lastKey };
    })
    .sort((a, b) => b.lastKey - a.lastKey)
    .slice(0, limits.maxConversations);

  const conversations: Record<string, ChatMessage[]> = {};
  const cursors: Record<string, number> = {};
  const hasMore: Record<string, boolean> = {};
  const emptyNotices: Record<string, ConversationHistoryEmptyNotice> = {};
  const loaded: string[] = [];
  const loadedSeen = new Set<string>();
  for (const entry of entries) {
    const list = entry.list;
    conversations[entry.key] = list;
    loaded.push(entry.key);
    loadedSeen.add(entry.key);
    const cursor = oldestId(list);
    if (cursor !== null) cursors[entry.key] = cursor;
    const trimmed = list.length >= limits.maxMessages;
    const known = payload.historyHasMore[entry.key];
    if (typeof known === "boolean") hasMore[entry.key] = trimmed ? true : known;
    else if (trimmed) hasMore[entry.key] = true;
  }
  if (loaded.length < limits.maxConversations) {
    const extra = Object.entries(payload.historyLoaded || {})
      .filter(([key, value]) => Boolean(value) && !loadedSeen.has(key))
      .map(([key]) => key.trim())
      .filter((key) => key && key.length <= HISTORY_CACHE_MAX_KEY_LEN);
    for (const key of extra) {
      if (loaded.length >= limits.maxConversations) break;
      if (loadedSeen.has(key)) continue;
      loaded.push(key);
      loadedSeen.add(key);
      const cursor = payload.historyCursor[key];
      if (typeof cursor === "number" && Number.isFinite(cursor) && cursor > 0) cursors[key] = Math.floor(cursor);
      const known = payload.historyHasMore[key];
      if (typeof known === "boolean") hasMore[key] = known;
      const notice = (payload as any).historyEmptyNotices?.[key] as ConversationHistoryEmptyNotice | undefined;
      if (notice) emptyNotices[key] = notice;
    }
  }

  if (!Object.keys(conversations).length && !loaded.length) return null;
  return {
    v: HISTORY_CACHE_VERSION,
    updated: Date.now(),
    conversations,
    cursors,
    hasMore,
    loaded,
    ...(Object.keys(emptyNotices).length ? { emptyNotices } : {}),
  };
}

export function saveHistoryCacheForUser(
  userId: string,
  payload: {
    conversations: Record<string, ChatMessage[]>;
    historyCursor: Record<string, number>;
    historyHasMore: Record<string, boolean>;
    historyLoaded: Record<string, boolean>;
    historySync?: Record<string, ConversationHistorySyncState>;
  },
  storage?: StorageLike | null
): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  const baseLimits = cacheLimits();
  try {
    const canonicalCursor: Record<string, number> = payload.historySync ? {} : { ...(payload.historyCursor || {}) };
    const canonicalHasMore: Record<string, boolean> = payload.historySync ? {} : { ...(payload.historyHasMore || {}) };
    const canonicalLoaded: Record<string, boolean> = payload.historySync ? {} : { ...(payload.historyLoaded || {}) };
    const canonicalEmptyNotices: Record<string, ConversationHistoryEmptyNotice> = {};
    if (payload.historySync) {
      for (const [syncKey, raw] of Object.entries(payload.historySync)) {
        const sync = createConversationHistorySyncState(raw);
        if (sync.loaded) canonicalLoaded[syncKey] = true;
        if (sync.cursor) canonicalCursor[syncKey] = sync.cursor;
        if (typeof sync.hasMore === "boolean") canonicalHasMore[syncKey] = sync.hasMore;
        if (sync.emptyNotice) canonicalEmptyNotices[syncKey] = sync.emptyNotice;
      }
    }
    for (const [legacyKey, value] of Object.entries(payload.historyLoaded || {})) {
      if (value) canonicalLoaded[legacyKey] = true;
      else delete canonicalLoaded[legacyKey];
    }
    for (const [legacyKey, value] of Object.entries(payload.historyCursor || {})) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) canonicalCursor[legacyKey] = Math.floor(value);
      else delete canonicalCursor[legacyKey];
    }
    for (const [legacyKey, value] of Object.entries(payload.historyHasMore || {})) {
      if (typeof value === "boolean") canonicalHasMore[legacyKey] = value;
      else delete canonicalHasMore[legacyKey];
    }
    const canonicalPayload = {
      conversations: payload.conversations,
      historyCursor: canonicalCursor,
      historyHasMore: canonicalHasMore,
      historyLoaded: canonicalLoaded,
      historyEmptyNotices: canonicalEmptyNotices,
    };
    let limits = { maxConversations: baseLimits.maxConversations, maxMessages: baseLimits.maxMessages };
    let encoded = buildEncodedHistoryCache(canonicalPayload, limits);
    if (!encoded) {
      st.removeItem(key);
      return;
    }
    let json = JSON.stringify(encoded);
    try {
      st.setItem(key, json);
      return;
    } catch (err) {
      if (!isQuotaExceededError(err)) throw err;
      debugPushError("history_cache.save.quota", err, { bytes: json.length, ...limits });
      try {
        st.removeItem(key);
      } catch {
        // ignore
      }
    }

    // Fallback: progressively reduce cache limits and retry a few times.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limits = {
        maxConversations: Math.max(40, Math.floor(limits.maxConversations * 0.65)),
        maxMessages: Math.max(200, Math.floor(limits.maxMessages * 0.6)),
      };
      encoded = buildEncodedHistoryCache(canonicalPayload, limits);
      if (!encoded) return;
      json = JSON.stringify(encoded);
      try {
        st.setItem(key, json);
        debugPush("history_cache.save.recovered", { attempt: attempt + 1, bytes: json.length, ...limits });
        return;
      } catch (err2) {
        if (!isQuotaExceededError(err2)) return;
        debugPushError("history_cache.save.retry.quota", err2, { attempt: attempt + 1, bytes: json.length, ...limits });
      }
    }
  } catch {
    // ignore
  }
}
