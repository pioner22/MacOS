import { requestOutboxSnapshot, syncOutboxToServiceWorker } from "../../../helpers/pwa/outboxSync";
import { updateOutboxEntry, type OutboxMap } from "../../../helpers/chat/outbox";
import { applyOutboxMutation, applyOutboxSnapshot } from "../../../helpers/runtime/deliverySync";
import { planOutboxDrain, shouldReconcileOutboxFromWorker } from "../../../helpers/runtime/deliveryCoordinator";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, OutboxEntry } from "../../../stores/types";
import { scheduleSaveOutbox, setOutboxSwReadyForUser } from "../persistence/localPersistenceTimers";

export const OUTBOX_SCHEDULE_GRACE_MS = 1200;

const OUTBOX_RETRY_MIN_MS = 900;
const OUTBOX_DRAIN_MAX = 12;

export interface OutboxFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => boolean;
  reportIncident?: (kind: string, detail?: Record<string, unknown> | null, opts?: { key?: string; dedupeMs?: number }) => boolean;
}

export interface OutboxFeature {
  drainOutbox: (limit?: number) => void;
  syncFromServiceWorker: (userId: string) => Promise<void>;
  dispose: () => void;
}

function mergeOutboxSnapshot(prevOutbox: AppState["outbox"], snapshot: OutboxEntry[] | OutboxMap): OutboxMap {
  const rawMap: OutboxMap = Array.isArray(snapshot) ? { unknown: snapshot } : (snapshot as OutboxMap);
  const merged: OutboxMap = {};
  for (const [key, list] of Object.entries(rawMap || {})) {
    const arr = Array.isArray(list) ? list : [];
    const normalized = arr
      .map((e) => {
        const status: OutboxEntry["status"] = e?.status === "sent" ? "sent" : "queued";
        return { ...e, status };
      })
      .filter((e) => typeof e.localId === "string" && Boolean(e.localId.trim()));
    if (normalized.length) merged[key] = normalized;
  }
  for (const [key, list] of Object.entries(prevOutbox || {})) {
    const base = Array.isArray(merged[key]) ? merged[key] : [];
    const seen = new Set(base.map((e) => String(e?.localId || "").trim()).filter(Boolean));
    const extras = (Array.isArray(list) ? list : []).filter((e) => {
      const lid = typeof e?.localId === "string" ? e.localId.trim() : "";
      return Boolean(lid) && !seen.has(lid);
    });
    if (extras.length) merged[key] = [...base, ...extras].sort((a, b) => a.ts - b.ts);
  }
  return merged;
}

export function createOutboxFeature(deps: OutboxFeatureDeps): OutboxFeature {
  const { store, send, reportIncident } = deps;
  let disposed = false;

  let outboxSyncPendingForUser: string | null = null;
  let outboxScheduleTimer: number | null = null;
  let outboxScheduleNextAt = 0;

  function clearOutboxScheduleTimer() {
    if (outboxScheduleTimer !== null) {
      window.clearTimeout(outboxScheduleTimer);
      outboxScheduleTimer = null;
    }
    outboxScheduleNextAt = 0;
  }

  function armOutboxScheduleTimer(nextAt: number) {
    if (!Number.isFinite(nextAt) || nextAt <= 0) {
      clearOutboxScheduleTimer();
      return;
    }
    if (outboxScheduleTimer !== null && outboxScheduleNextAt === nextAt) return;
    clearOutboxScheduleTimer();
    outboxScheduleNextAt = nextAt;
    const delay = Math.max(0, nextAt - Date.now());
    outboxScheduleTimer = window.setTimeout(() => {
      outboxScheduleTimer = null;
      outboxScheduleNextAt = 0;
      drainOutbox();
    }, delay);
  }

  function reportWorkerSyncResult(userId: string, result: Awaited<ReturnType<typeof syncOutboxToServiceWorker>>): void {
    if (result.ok || !result.pending) return;
    reportIncident?.(
      "delivery_outbox_worker_sync_failed",
      {
        user_id: userId,
        status: result.status,
        registered: result.registered,
        pending: result.pending,
        reason: result.error || result.status,
      },
      { key: `delivery_outbox_worker_sync_failed:${userId}:${result.status}`, dedupeMs: 60_000 }
    );
  }

  async function syncFromServiceWorker(userId: string) {
    const uid = String(userId || "").trim();
    if (!uid) {
      drainOutbox();
      return;
    }
    if (outboxSyncPendingForUser === uid) return;
    if (!shouldReconcileOutboxFromWorker(store.get(), uid)) {
      drainOutbox();
      return;
    }
    outboxSyncPendingForUser = uid;
    try {
      const snapshot = await requestOutboxSnapshot(uid);
      if (disposed) return;
      if (snapshot && typeof snapshot === "object") {
        store.set((prev) => {
          if (prev.selfId !== uid) return prev;
          const mergedOutbox = mergeOutboxSnapshot(prev.outbox, snapshot as any);
          let conversations = prev.conversations;
          let convChanged = false;
          for (const [k, list] of Object.entries(mergedOutbox)) {
            const out = Array.isArray(list) ? list : [];
            if (!out.length) continue;
            const prevConv = conversations[k] ?? [];
            const has = new Set(prevConv.map((m) => (typeof m.localId === "string" ? m.localId : "")).filter(Boolean));
            const add = out
              .filter((e) => !has.has(e.localId))
              .map((e) => ({
                kind: "out" as const,
                from: prev.selfId || "",
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
            convChanged = true;
            conversations = {
              ...conversations,
              [k]: [...prevConv, ...add].sort((a, b) => {
                const sa = typeof a.id === "number" && Number.isFinite(a.id) ? a.id : a.ts;
                const sb = typeof b.id === "number" && Number.isFinite(b.id) ? b.id : b.ts;
                return sa - sb;
              }),
            };
          }
          const next = convChanged ? { ...prev, conversations } : prev;
          return applyOutboxSnapshot(next, mergedOutbox, { source: "cache", reconcilePending: true });
        });
        scheduleSaveOutbox(store);
      }
    } catch {
      // ignore
    } finally {
      setOutboxSwReadyForUser(uid);
      outboxSyncPendingForUser = null;
      try {
        void syncOutboxToServiceWorker(uid, store.get().outbox).then((result) => reportWorkerSyncResult(uid, result));
      } catch {
        // ignore
      }
      drainOutbox();
    }
  }

  function drainOutbox(limit = OUTBOX_DRAIN_MAX) {
    if (disposed) return;
    const st = store.get();
    if (!Object.keys(st.outbox || {}).length) {
      clearOutboxScheduleTimer();
      return;
    }
    const nowMs = Date.now();
    const plan = planOutboxDrain(st, {
      nowMs,
      scheduleGraceMs: OUTBOX_SCHEDULE_GRACE_MS,
      retryMinMs: OUTBOX_RETRY_MIN_MS,
      maxEntries: limit,
    });
    const nextAt =
      plan.nextScheduleAt !== null && plan.retryAt !== null
        ? Math.min(plan.nextScheduleAt, plan.retryAt)
        : plan.nextScheduleAt ?? plan.retryAt ?? 0;
    if (nextAt) armOutboxScheduleTimer(nextAt);
    else clearOutboxScheduleTimer();
    if (!plan.drainable.length) return;

    const sent: Array<{ key: string; localId: string }> = [];
    for (const it of plan.drainable) {
      const ok = send(
        it.to
          ? { type: "send", to: it.to, text: it.text, ...(it.silent ? { silent: true } : {}) }
          : { type: "send", room: it.room, text: it.text, ...(it.silent ? { silent: true } : {}) }
      );
      if (!ok) break;
      sent.push({ key: it.key, localId: it.localId });
    }
    if (!sent.length) return;

    store.set((prev) => {
      let outbox = prev.outbox;
      let conversations = prev.conversations;
      for (const s of sent) {
        outbox = updateOutboxEntry(outbox, s.key, s.localId, (e) => ({
          ...e,
          status: "sending",
          attempts: (e.attempts ?? 0) + 1,
          lastAttemptAt: nowMs,
        }));
        const conv = conversations[s.key];
        if (Array.isArray(conv) && conv.length) {
          const idx = conv.findIndex((m) => m.kind === "out" && typeof m.localId === "string" && m.localId === s.localId);
          if (idx >= 0) {
            const next = [...conv];
            next[idx] = { ...next[idx], status: "sending" };
            conversations = { ...conversations, [s.key]: next };
          }
        }
      }
      return { ...applyOutboxMutation({ ...prev, conversations, status: "Отправляем сообщения из очереди…" }, outbox) };
    });
    scheduleSaveOutbox(store);
  }

  function dispose() {
    disposed = true;
    clearOutboxScheduleTimer();
    outboxSyncPendingForUser = null;
  }

  return { drainOutbox, syncFromServiceWorker, dispose };
}
