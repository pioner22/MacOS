import type { Store } from "../../stores/store";
import type { AppState, ChatMessage } from "../../stores/types";
import { getConversationHistorySyncState } from "./historySync";

export type EnsureHistoryMessageStatus = "found" | "cancelled" | "timeout" | "not_found" | "no_conn";

export type EnsureHistoryMessageResult =
  | { status: "found"; idx: number }
  | { status: Exclude<EnsureHistoryMessageStatus, "found"> };

type HistoryTarget = { type: "history"; peer: string } | { type: "history"; room: string };

type HistorySig = {
  len: number;
  oldest: number | null;
  cursor: number | null;
  hasMore: boolean | null;
};

function historyTargetForChatKey(chatKey: string): HistoryTarget | null {
  const key = String(chatKey || "").trim();
  if (key.startsWith("dm:")) {
    const peer = key.slice("dm:".length).trim();
    return peer ? { type: "history", peer } : null;
  }
  if (key.startsWith("room:")) {
    const room = key.slice("room:".length).trim();
    return room ? { type: "history", room } : null;
  }
  return null;
}

function normalizeServerId(value: unknown): number | null {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
  return n && n > 0 ? n : null;
}

function findMsgIdxById(messages: ChatMessage[], msgId: number): number {
  if (!Number.isFinite(msgId) || msgId <= 0) return -1;
  return messages.findIndex((m) => typeof m?.id === "number" && Number.isFinite(m.id) && m.id === msgId);
}

function oldestServerMessageId(messages: ChatMessage[]): number | null {
  let oldest: number | null = null;
  for (const m of messages) {
    const id = normalizeServerId(m?.id);
    if (id === null) continue;
    oldest = oldest === null ? id : Math.min(oldest, id);
  }
  return oldest;
}

function historySig(st: AppState, key: string): HistorySig {
  const msgs = st.conversations?.[key] || [];
  const sync = getConversationHistorySyncState(st, key);
  return {
    len: msgs.length,
    oldest: oldestServerMessageId(msgs),
    cursor: normalizeServerId(sync.cursor),
    hasMore: typeof sync.hasMore === "boolean" ? sync.hasMore : null,
  };
}

function sigEqual(a: HistorySig, b: HistorySig): boolean {
  return a.len === b.len && a.oldest === b.oldest && a.cursor === b.cursor && a.hasMore === b.hasMore;
}

async function waitForHistorySigChange(
  store: Store<AppState>,
  key: string,
  prev: HistorySig,
  opts: { timeoutMs: number; shouldCancel?: () => boolean }
): Promise<{ kind: "changed"; sig: HistorySig } | { kind: "cancelled" } | { kind: "timeout" }> {
  const timeoutMs = Math.max(250, Math.trunc(opts.timeoutMs || 0));
  const shouldCancel = opts.shouldCancel;
  return await new Promise((resolve) => {
    let done = false;
    const cleanup = (timer: number, unsub: () => void) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        unsub();
      } catch {
        // ignore
      }
    };
    const timer = window.setTimeout(() => {
      cleanup(timer, unsub);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    const unsub = store.subscribe(() => {
      if (done) return;
      if (shouldCancel?.()) {
        cleanup(timer, unsub);
        resolve({ kind: "cancelled" });
        return;
      }
      const next = historySig(store.get(), key);
      if (sigEqual(prev, next)) return;
      cleanup(timer, unsub);
      resolve({ kind: "changed", sig: next });
    });
    if (shouldCancel?.()) {
      cleanup(timer, unsub);
      resolve({ kind: "cancelled" });
    }
  });
}

export async function ensureChatMessageLoadedById(opts: {
  store: Store<AppState>;
  send: (payload: any) => void;
  chatKey: string;
  msgId: number;
  limit?: number;
  maxPages?: number;
  stepTimeoutMs?: number;
  shouldCancel?: () => boolean;
}): Promise<EnsureHistoryMessageResult> {
  const { store, send } = opts;
  const chatKey = String(opts.chatKey || "").trim();
  const msgId = Math.trunc(Number(opts.msgId));
  const target = historyTargetForChatKey(chatKey);
  if (!target || !Number.isFinite(msgId) || msgId <= 0) return { status: "not_found" };

  const limit = Math.max(20, Math.min(400, Math.trunc(Number(opts.limit) || 200)));
  const maxPages = Math.max(1, Math.min(20, Math.trunc(Number(opts.maxPages) || 8)));
  const stepTimeoutMs = Math.max(400, Math.min(15000, Math.trunc(Number(opts.stepTimeoutMs) || 2400)));
  const shouldCancel = opts.shouldCancel;

  let lastBeforeId: number | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    if (shouldCancel?.()) return { status: "cancelled" };
    const st = store.get();
    if (!st.authed || st.conn !== "connected") return { status: "no_conn" };
    const conv = st.conversations?.[chatKey] || [];
    const idx = findMsgIdxById(conv, msgId);
    if (idx >= 0) return { status: "found", idx };

    const cursor = normalizeServerId(getConversationHistorySyncState(st, chatKey).cursor);
    const oldest = oldestServerMessageId(conv);
    const beforeId = cursor ?? oldest ?? 0;

    // If we already have messages at/older than msgId, but it is still missing, further backfill won't help.
    if (beforeId > 0 && beforeId <= msgId) return { status: "not_found" };

    if (lastBeforeId !== null && beforeId === lastBeforeId) {
      return { status: "not_found" };
    }
    lastBeforeId = beforeId;

    const prevSig = historySig(st, chatKey);
    send({ ...target, before_id: beforeId, limit });
    const wait = await waitForHistorySigChange(store, chatKey, prevSig, { timeoutMs: stepTimeoutMs, shouldCancel });
    if (wait.kind === "cancelled") return { status: "cancelled" };
    if (wait.kind === "timeout") return { status: "timeout" };
  }

  const after = store.get();
  const finalConv = after.conversations?.[chatKey] || [];
  const finalIdx = findMsgIdxById(finalConv, msgId);
  return finalIdx >= 0 ? { status: "found", idx: finalIdx } : { status: "not_found" };
}
