import type { ChatMessage } from "../../stores/types";
import { loadHistoryCachePrefs } from "./historyCachePrefs";

const DB_NAME = "yagodka-history-v1";
const DB_VERSION = 1;

const STORE_MESSAGES = "messages";
const STORE_CONVOS = "convos";
const INDEX_BY_CONVO_ID = "by_convo_id";

type HistoryMessageRow = {
  uid: string;
  id: number;
  convo: string;
  ts: number;
  msg: ChatMessage;
};

export type HistoryConvoMeta = {
  uid: string;
  convo: string;
  updated: number;
  min_id: number;
  max_id: number;
  backfilled: boolean;
  tail_checked_at?: number;
  delta_checked_at?: number;
};

type HistoryIngestMeta = {
  beforeId: number | null;
  hasMore: boolean | null;
  preview: boolean;
  sinceId: number | null;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

const pruneTimers = new Map<string, number>();
const pruneInFlight = new Set<string>();

function pruneKey(uid: string, convo: string): string {
  return `${uid}:${convo}`;
}

function clearPruneTimer(key: string) {
  const t = pruneTimers.get(key);
  if (t === undefined) return;
  pruneTimers.delete(key);
  try {
    globalThis.clearTimeout(t);
  } catch {
    // ignore
  }
}

function schedulePruneConvo(uid: string, convo: string, delayMs = 1200) {
  const key = pruneKey(uid, convo);
  if (pruneTimers.has(key)) return;
  const timer = globalThis.setTimeout(() => {
    pruneTimers.delete(key);
    if (pruneInFlight.has(key)) {
      schedulePruneConvo(uid, convo, 1800);
      return;
    }
    pruneInFlight.add(key);
    void (async () => {
      try {
        const prefs = loadHistoryCachePrefs(uid);
        const keepLatest = Math.max(0, Math.trunc(Number(prefs.keepLatestPerConvo ?? 0) || 0));
        if (!keepLatest) return;
        const maxDeletesPerRun = 1200;
        const deleted = await pruneHistoryConvo(uid, convo, { keepLatest, maxDeletesPerRun });
        if (deleted >= maxDeletesPerRun) schedulePruneConvo(uid, convo, 450);
      } finally {
        pruneInFlight.delete(key);
      }
    })();
  }, Math.max(50, Math.min(30_000, Math.trunc(delayMs) || 0)));
  pruneTimers.set(key, timer);
}

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && Boolean(indexedDB) && typeof indexedDB.open === "function";
  } catch {
    return false;
  }
}

function normalizeId(raw: string): string | null {
  const uid = String(raw || "").trim();
  return uid ? uid : null;
}

function normalizeConvo(raw: string): string | null {
  const key = String(raw || "").trim();
  if (!key) return null;
  // Expect keys like "dm:..." / "room:..." / "board:..."; keep generic.
  if (key.length > 160) return key.slice(0, 160);
  return key;
}

function convoRange(uid: string, convo: string): IDBKeyRange {
  return IDBKeyRange.bound([uid, convo, 0], [uid, convo, Number.MAX_SAFE_INTEGER]);
}

function userMessagesRange(uid: string): IDBKeyRange {
  return IDBKeyRange.bound([uid, 0], [uid, Number.MAX_SAFE_INTEGER]);
}

function userConvosRange(uid: string): IDBKeyRange {
  return IDBKeyRange.bound([uid, ""], [uid, "\uffff"]);
}

function toReqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb_request_failed"));
  });
}

function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

async function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!idbAvailable()) return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const store = db.createObjectStore(STORE_MESSAGES, { keyPath: ["uid", "id"] });
          store.createIndex(INDEX_BY_CONVO_ID, ["uid", "convo", "id"], { unique: false });
        } else {
          const tx = req.transaction;
          const store = tx?.objectStore(STORE_MESSAGES);
          if (store && !store.indexNames.contains(INDEX_BY_CONVO_ID)) {
            store.createIndex(INDEX_BY_CONVO_ID, ["uid", "convo", "id"], { unique: false });
          }
        }
        if (!db.objectStoreNames.contains(STORE_CONVOS)) {
          db.createObjectStore(STORE_CONVOS, { keyPath: ["uid", "convo"] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function validServerId(raw: unknown): number | null {
  const id = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return id > 0 ? id : null;
}

function pickMinMaxIds(msgs: ChatMessage[]): { minId: number | null; maxId: number | null } {
  let minId: number | null = null;
  let maxId: number | null = null;
  for (const m of msgs) {
    const id = validServerId((m as any)?.id);
    if (id === null) continue;
    minId = minId === null ? id : Math.min(minId, id);
    maxId = maxId === null ? id : Math.max(maxId, id);
  }
  return { minId, maxId };
}

function sanitizeMeta(raw: any): HistoryConvoMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const uid = normalizeId(raw.uid);
  const convo = normalizeConvo(raw.convo);
  if (!uid || !convo) return null;
  const updated = Number(raw.updated ?? 0);
  const min_id = Number(raw.min_id ?? 0);
  const max_id = Number(raw.max_id ?? 0);
  const backfilled = Boolean(raw.backfilled);
  const tail_checked_at = Number(raw.tail_checked_at ?? 0);
  const delta_checked_at = Number(raw.delta_checked_at ?? 0);
  const meta: HistoryConvoMeta = {
    uid,
    convo,
    updated: Number.isFinite(updated) && updated > 0 ? Math.trunc(updated) : 0,
    min_id: Number.isFinite(min_id) && min_id > 0 ? Math.trunc(min_id) : 0,
    max_id: Number.isFinite(max_id) && max_id > 0 ? Math.trunc(max_id) : 0,
    backfilled,
    ...(Number.isFinite(tail_checked_at) && tail_checked_at > 0 ? { tail_checked_at: Math.trunc(tail_checked_at) } : {}),
    ...(Number.isFinite(delta_checked_at) && delta_checked_at > 0 ? { delta_checked_at: Math.trunc(delta_checked_at) } : {}),
  };
  return meta;
}

export async function getHistoryConvoMeta(userId: string, convo: string): Promise<HistoryConvoMeta | null> {
  const uid = normalizeId(userId);
  const key = normalizeConvo(convo);
  if (!uid || !key) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction([STORE_CONVOS], "readonly");
    const store = tx.objectStore(STORE_CONVOS);
    const raw = await toReqPromise<any>(store.get([uid, key]));
    await waitTx(tx);
    return sanitizeMeta(raw);
  } catch {
    return null;
  }
}

export async function ingestHistoryResult(
  userId: string | null | undefined,
  convo: string,
  msgs: ChatMessage[],
  meta: HistoryIngestMeta
): Promise<void> {
  const uid = userId ? normalizeId(userId) : null;
  const key = normalizeConvo(convo);
  if (!uid || !key) return;
  const db = await openDb();
  if (!db) return;
  const rows = Array.isArray(msgs) ? msgs : [];
  const { minId, maxId } = pickMinMaxIds(rows);
  const now = Date.now();

  const shouldMarkTailChecked = meta.beforeId === 0;
  const shouldMarkDeltaChecked = meta.beforeId === null;
  const shouldMarkBackfilled = (() => {
    if (meta.hasMore === null) return false;
    if (meta.hasMore === true) return false;
    // If server explicitly says "no more", treat as fully backfilled (older pages exhausted).
    // For tail (before_id=0) it means the whole conversation fits into the tail page.
    return true;
  })();

  let stored = false;
  try {
    const tx = db.transaction([STORE_MESSAGES, STORE_CONVOS], "readwrite");
    const msgStore = tx.objectStore(STORE_MESSAGES);
    for (const m of rows) {
      const id = validServerId((m as any)?.id);
      if (id === null) continue;
      const tsRaw = Number((m as any)?.ts ?? 0);
      const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : 0;
      const row: HistoryMessageRow = { uid, id, convo: key, ts, msg: m };
      msgStore.put(row);
    }

    const convStore = tx.objectStore(STORE_CONVOS);
    const prevRaw = await toReqPromise<any>(convStore.get([uid, key]));
    const prev = sanitizeMeta(prevRaw);
    const next: HistoryConvoMeta = prev
      ? { ...prev, uid, convo: key }
      : {
          uid,
          convo: key,
          updated: 0,
          min_id: 0,
          max_id: 0,
          backfilled: false,
        };

    next.updated = now;
    if (minId !== null) {
      next.min_id = next.min_id > 0 ? Math.min(next.min_id, minId) : minId;
    }
    if (maxId !== null) {
      next.max_id = next.max_id > 0 ? Math.max(next.max_id, maxId) : maxId;
    }
    if (shouldMarkTailChecked) next.tail_checked_at = now;
    if (shouldMarkDeltaChecked) next.delta_checked_at = now;
    if (shouldMarkBackfilled) next.backfilled = true;

    convStore.put(next);
    await waitTx(tx);
    stored = true;
  } catch {
    // ignore
  }
  if (stored) schedulePruneConvo(uid, key, meta.beforeId && meta.beforeId > 0 ? 700 : 1400);
}

export async function patchHistoryMessageById(
  userId: string | null | undefined,
  messageId: number,
  patch: (msg: ChatMessage) => ChatMessage
): Promise<void> {
  const uid = userId ? normalizeId(userId) : null;
  const id = validServerId(messageId);
  if (!uid || id === null) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([STORE_MESSAGES], "readwrite");
    const store = tx.objectStore(STORE_MESSAGES);
    const prev = await toReqPromise<any>(store.get([uid, id]));
    if (!prev || typeof prev !== "object") {
      await waitTx(tx);
      return;
    }
    const msg = (prev as any).msg as ChatMessage | null;
    const convo = normalizeConvo((prev as any).convo);
    const tsPrev = Number((prev as any).ts ?? 0);
    if (!msg || !convo) {
      await waitTx(tx);
      return;
    }
    const nextMsg = patch(msg);
    const tsRaw = Number((nextMsg as any)?.ts ?? tsPrev);
    const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : (Number.isFinite(tsPrev) && tsPrev > 0 ? tsPrev : 0);
    const row: HistoryMessageRow = { uid, id, convo, ts, msg: nextMsg };
    store.put(row);
    await waitTx(tx);
  } catch {
    // ignore
  }
}

export async function deleteHistoryMessageById(
  userId: string | null | undefined,
  messageId: number
): Promise<void> {
  const uid = userId ? normalizeId(userId) : null;
  const id = validServerId(messageId);
  if (!uid || id === null) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([STORE_MESSAGES], "readwrite");
    const store = tx.objectStore(STORE_MESSAGES);
    store.delete([uid, id]);
    await waitTx(tx);
  } catch {
    // ignore
  }
}

export async function clearHistoryConvo(userId: string | null | undefined, convo: string): Promise<void> {
  const uid = userId ? normalizeId(userId) : null;
  const key = normalizeConvo(convo);
  if (!uid || !key) return;
  const pkey = pruneKey(uid, key);
  clearPruneTimer(pkey);
  pruneInFlight.delete(pkey);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([STORE_MESSAGES, STORE_CONVOS], "readwrite");
    const msgStore = tx.objectStore(STORE_MESSAGES);
    const cursorReq = msgStore.index(INDEX_BY_CONVO_ID).openCursor(convoRange(uid, key));
    await new Promise<void>((resolve) => {
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        try {
          cursor.delete();
        } catch {
          // ignore individual stale rows
        }
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    });
    tx.objectStore(STORE_CONVOS).delete([uid, key]);
    await waitTx(tx);
  } catch {
    // ignore
  }
}

async function cursorToMessages(cursorReq: IDBRequest<IDBCursorWithValue | null>, limit: number): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [];
  return await new Promise((resolve) => {
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return resolve(out.reverse());
      const row = cursor.value as any;
      const msg = row && typeof row === "object" ? (row.msg as ChatMessage | null) : null;
      if (msg) out.push(msg);
      if (out.length >= limit) return resolve(out.reverse());
      cursor.continue();
    };
    cursorReq.onerror = () => resolve(out.reverse());
  });
}

export async function getHistoryLatestMessages(
  userId: string,
  convo: string,
  opts: { limit: number }
): Promise<ChatMessage[]> {
  const uid = normalizeId(userId);
  const key = normalizeConvo(convo);
  const rawLimit = Math.trunc(Number(opts.limit ?? 0) || 0);
  const limit = rawLimit > 0 ? Math.min(800, rawLimit) : 0;
  if (!uid || !key || limit <= 0) return [];
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction([STORE_MESSAGES], "readonly");
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index(INDEX_BY_CONVO_ID);
    const range = convoRange(uid, key);
    const cursorReq = index.openCursor(range, "prev");
    const msgs = await cursorToMessages(cursorReq, limit);
    await waitTx(tx);
    return msgs;
  } catch {
    return [];
  }
}

export async function getHistoryMessagesBefore(
  userId: string,
  convo: string,
  opts: { beforeId: number; limit: number }
): Promise<ChatMessage[]> {
  const uid = normalizeId(userId);
  const key = normalizeConvo(convo);
  const beforeId = validServerId(opts.beforeId);
  const rawLimit = Math.trunc(Number(opts.limit ?? 0) || 0);
  const limit = rawLimit > 0 ? Math.min(800, rawLimit) : 0;
  if (!uid || !key || beforeId === null || limit <= 0) return [];
  const upper = Math.max(0, beforeId - 1);
  if (upper <= 0) return [];
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction([STORE_MESSAGES], "readonly");
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index(INDEX_BY_CONVO_ID);
    const range = IDBKeyRange.bound([uid, key, 0], [uid, key, upper]);
    const cursorReq = index.openCursor(range, "prev");
    const msgs = await cursorToMessages(cursorReq, limit);
    await waitTx(tx);
    return msgs;
  } catch {
    return [];
  }
}

export type HistoryCacheStats = {
  messages: number;
  convos: number;
};

export async function getHistoryCacheStats(userId: string): Promise<HistoryCacheStats | null> {
  const uid = normalizeId(userId);
  if (!uid) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction([STORE_MESSAGES, STORE_CONVOS], "readonly");
    const msgStore = tx.objectStore(STORE_MESSAGES);
    const convStore = tx.objectStore(STORE_CONVOS);
    const [messages, convos] = await Promise.all([
      toReqPromise<number>(msgStore.count(userMessagesRange(uid))),
      toReqPromise<number>(convStore.count(userConvosRange(uid))),
    ]);
    await waitTx(tx);
    return {
      messages: Number.isFinite(messages) && messages >= 0 ? Math.trunc(messages) : 0,
      convos: Number.isFinite(convos) && convos >= 0 ? Math.trunc(convos) : 0,
    };
  } catch {
    return null;
  }
}

export async function clearHistoryCacheForUser(userId: string): Promise<void> {
  const uid = normalizeId(userId);
  if (!uid) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([STORE_MESSAGES, STORE_CONVOS], "readwrite");
    const msgStore = tx.objectStore(STORE_MESSAGES);
    const convStore = tx.objectStore(STORE_CONVOS);
    msgStore.delete(userMessagesRange(uid));
    convStore.delete(userConvosRange(uid));
    await waitTx(tx);
  } catch {
    // ignore
  }
}

export async function countHistoryMessagesForConvo(userId: string, convo: string): Promise<number> {
  const uid = normalizeId(userId);
  const key = normalizeConvo(convo);
  if (!uid || !key) return 0;
  const db = await openDb();
  if (!db) return 0;
  try {
    const tx = db.transaction([STORE_MESSAGES], "readonly");
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index(INDEX_BY_CONVO_ID);
    const count = await toReqPromise<number>(index.count(convoRange(uid, key)));
    await waitTx(tx);
    return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
  } catch {
    return 0;
  }
}

type PruneCursorResult = {
  deleted: number;
  oldestRemainingId: number | null;
};

async function pruneOldestMessages(
  tx: IDBTransaction,
  uid: string,
  convo: string,
  toDelete: number
): Promise<PruneCursorResult> {
  const store = tx.objectStore(STORE_MESSAGES);
  const index = store.index(INDEX_BY_CONVO_ID);
  const range = convoRange(uid, convo);
  const deleted = Math.max(0, Math.trunc(toDelete) || 0);
  if (deleted <= 0) return { deleted: 0, oldestRemainingId: null };

  return await new Promise((resolve) => {
    let removed = 0;
    const cursorReq = index.openCursor(range, "next");
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return resolve({ deleted: removed, oldestRemainingId: null });
      const row = cursor.value as any;
      const id = validServerId(row?.id);
      if (removed < deleted) {
        try {
          cursor.delete();
        } catch {
          // ignore
        }
        removed += 1;
        cursor.continue();
        return;
      }
      // Stopped deleting: current cursor points at the oldest remaining message.
      return resolve({ deleted: removed, oldestRemainingId: id });
    };
    cursorReq.onerror = () => resolve({ deleted: removed, oldestRemainingId: null });
  });
}

async function findOldestMessageId(tx: IDBTransaction, uid: string, convo: string): Promise<number | null> {
  const store = tx.objectStore(STORE_MESSAGES);
  const index = store.index(INDEX_BY_CONVO_ID);
  const range = convoRange(uid, convo);
  const cursorReq = index.openCursor(range, "next");
  return await new Promise((resolve) => {
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return resolve(null);
      const row = cursor.value as any;
      resolve(validServerId(row?.id));
    };
    cursorReq.onerror = () => resolve(null);
  });
}

export async function pruneHistoryConvo(
  userId: string,
  convo: string,
  opts: { keepLatest: number; maxDeletesPerRun?: number }
): Promise<number> {
  const uid = normalizeId(userId);
  const key = normalizeConvo(convo);
  const keepLatest = Math.max(0, Math.trunc(Number(opts.keepLatest ?? 0) || 0));
  const maxDeletesPerRun = Math.max(50, Math.min(2500, Math.trunc(Number(opts.maxDeletesPerRun ?? 900) || 0)));
  if (!uid || !key || keepLatest <= 0) return 0;

  const total = await countHistoryMessagesForConvo(uid, key);
  const overflow = Math.max(0, total - keepLatest);
  const toDelete = Math.min(overflow, maxDeletesPerRun);
  if (toDelete <= 0) return 0;

  const db = await openDb();
  if (!db) return 0;
  try {
    const tx = db.transaction([STORE_MESSAGES, STORE_CONVOS], "readwrite");
    const convStore = tx.objectStore(STORE_CONVOS);
    const prevRaw = await toReqPromise<any>(convStore.get([uid, key]));
    const prev = sanitizeMeta(prevRaw);

    const cursorResult = await pruneOldestMessages(tx, uid, key, toDelete);
    const oldestRemainingId =
      cursorResult.oldestRemainingId !== null ? cursorResult.oldestRemainingId : await findOldestMessageId(tx, uid, key);

    if (!oldestRemainingId) {
      convStore.delete([uid, key]);
      await waitTx(tx);
      return cursorResult.deleted;
    }

    const now = Date.now();
    const next: HistoryConvoMeta = prev
      ? { ...prev, uid, convo: key }
      : {
          uid,
          convo: key,
          updated: 0,
          min_id: 0,
          max_id: 0,
          backfilled: false,
        };
    next.updated = now;
    next.min_id = oldestRemainingId;
    convStore.put(next);
    await waitTx(tx);
    return cursorResult.deleted;
  } catch {
    return 0;
  }
}
