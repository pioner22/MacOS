import { getRuntimeDeliveryDomainSyncState } from "./deliverySync";
import type { AppState, FileTransferEntry, OutboxEntry } from "../../stores/types";

export type RuntimeDeliveryDomain = "drafts" | "fileTransfers" | "outbox";

export interface PlannedOutboxEntry {
  key: string;
  localId: string;
  text: string;
  ts: number;
  lastAttemptAt: number;
  to?: string;
  room?: string;
  whenOnline?: boolean;
  silent?: boolean;
  scheduleAt?: number;
}

export interface OutboxDrainPlan {
  drainable: PlannedOutboxEntry[];
  nextScheduleAt: number | null;
  retryAt: number | null;
  blocked: "none" | "not_authed" | "no_connection" | "not_leader";
}

export interface DeliveryRetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type DeliveryRetryDomain = "file_upload_http" | "file_download_http";

export type DeliveryDeviceCapsLike = {
  constrained?: boolean | null;
  slowNetwork?: boolean | null;
};

export function hasDraftEntries(drafts: Record<string, string>): boolean {
  return Object.keys(drafts || {}).length > 0;
}

export function hasOutboxEntries(outbox: Record<string, OutboxEntry[]>): boolean {
  return Object.values(outbox || {}).some((list) => Array.isArray(list) && list.length > 0);
}

export function hasPendingOutboxEntries(outbox: Record<string, OutboxEntry[]>): boolean {
  for (const list of Object.values(outbox || {})) {
    for (const entry of Array.isArray(list) ? list : []) {
      if (entry?.status !== "sent") return true;
    }
  }
  return false;
}

export function shouldRegisterOutboxBackgroundSync(outbox: Record<string, OutboxEntry[]>): boolean {
  return hasPendingOutboxEntries(outbox);
}

export function hasWhenOnlineOutboxEntries(outbox: Record<string, OutboxEntry[]>): boolean {
  for (const list of Object.values(outbox || {})) {
    for (const entry of Array.isArray(list) ? list : []) {
      if (entry?.whenOnline) return true;
    }
  }
  return false;
}

export function summarizeFileTransferActivity(fileTransfers: FileTransferEntry[]): {
  total: number;
  uploading: number;
  downloading: number;
  active: number;
  error: number;
  terminal: number;
} {
  const list = Array.isArray(fileTransfers) ? fileTransfers : [];
  const uploading = list.filter((t) => t?.status === "uploading").length;
  const downloading = list.filter((t) => t?.status === "downloading").length;
  const error = list.filter((t) => t?.status === "error").length;
  const terminal = list.filter((t) => isTerminalFileTransferStatus(t?.status)).length;
  return {
    total: list.length,
    uploading,
    downloading,
    active: uploading + downloading,
    error,
    terminal,
  };
}

export function hasActiveFileTransferEntries(fileTransfers: FileTransferEntry[]): boolean {
  const summary = summarizeFileTransferActivity(fileTransfers);
  return summary.active > 0;
}

export function isTerminalFileTransferStatus(status: FileTransferEntry["status"] | string | null | undefined): boolean {
  return status === "complete" || status === "uploaded" || status === "error" || status === "rejected";
}

export function hasTerminalFileTransferEntries(fileTransfers: FileTransferEntry[]): boolean {
  const summary = summarizeFileTransferActivity(fileTransfers);
  return summary.terminal > 0;
}

export function shouldPersistRuntimeDeliveryDomain(state: AppState, domain: RuntimeDeliveryDomain): boolean {
  if (!state.authed || !state.selfId) return false;
  const sync = getRuntimeDeliveryDomainSyncState(state, domain);
  if (domain === "drafts") return sync.loaded || hasDraftEntries(state.drafts);
  if (domain === "fileTransfers") return sync.loaded || Array.isArray(state.fileTransfers) && state.fileTransfers.length > 0;
  return sync.loaded || hasOutboxEntries(state.outbox);
}

export function shouldSyncOutboxToWorker(state: AppState, readyUserId: string | null): boolean {
  const uid = String(state.selfId || "").trim();
  const ready = String(readyUserId || "").trim();
  return Boolean(uid && ready && uid === ready && shouldPersistRuntimeDeliveryDomain(state, "outbox"));
}

export function shouldReconcileFileTransfersFromCache(
  state: Pick<AppState, "authed" | "selfId" | "deliverySync" | "fileTransfers">,
  userId: string
): boolean {
  const uid = String(state.selfId || "").trim();
  const target = String(userId || "").trim();
  if (!state.authed || !uid || !target || uid !== target) return false;
  const sync = getRuntimeDeliveryDomainSyncState(state, "fileTransfers");
  return Boolean(sync.reconcilePending || !sync.loaded || hasTerminalFileTransferEntries(state.fileTransfers));
}

export function mergeRestoredFileTransfers(
  live: FileTransferEntry[],
  cached: FileTransferEntry[]
): FileTransferEntry[] {
  const current = Array.isArray(live) ? live : [];
  const restored = Array.isArray(cached) ? cached : [];
  if (!restored.length) return current;
  const byId = new Set(current.map((entry) => String(entry?.id || "").trim()).filter(Boolean));
  const byLocalId = new Set(current.map((entry) => String(entry?.localId || "").trim()).filter(Boolean));
  const extras = restored.filter((entry) => {
    const id = String(entry?.id || "").trim();
    const localId = String(entry?.localId || "").trim();
    if (id && byId.has(id)) return false;
    if (localId && byLocalId.has(localId)) return false;
    return true;
  });
  return extras.length ? [...current, ...extras] : current;
}

export function getDeliveryRetryPolicy(
  domain: DeliveryRetryDomain,
  deviceCaps?: DeliveryDeviceCapsLike | null
): DeliveryRetryPolicy {
  if (domain === "file_download_http") {
    return {
      maxRetries: 6,
      baseDelayMs: deviceCaps?.slowNetwork ? 900 : deviceCaps?.constrained ? 650 : 400,
      maxDelayMs: 8000,
    };
  }
  return {
    maxRetries: 4,
    baseDelayMs: 400,
    maxDelayMs: 5000,
  };
}

export function parseDeliveryRetryAfterMs(value: string | null | undefined, nowMs = Date.now()): number {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return Math.round(num * 1000);
  const dt = Date.parse(raw);
  if (Number.isFinite(dt) && dt > 0) return Math.max(0, dt - nowMs);
  return 0;
}

export function computeDeliveryRetryDelayMs(
  attempt: number,
  policy: DeliveryRetryPolicy,
  opts?: { retryAfterMs?: number | null; jitterRatio?: number }
): number {
  const safeAttempt = Math.max(0, Math.trunc(Number(attempt) || 0));
  const base = Math.max(0, Math.trunc(Number(policy.baseDelayMs) || 0));
  const max = Math.max(base, Math.trunc(Number(policy.maxDelayMs) || base));
  const retryAfterMs = Math.max(0, Math.trunc(Number(opts?.retryAfterMs) || 0));
  const jitterRatio = Math.max(0, Math.min(1, Number(opts?.jitterRatio ?? 0.2) || 0));
  const backoff = Math.min(max, base * 2 ** safeAttempt);
  const jitter = Math.round(backoff * jitterRatio);
  return Math.max(retryAfterMs, backoff + jitter);
}

export function shouldFallbackUploadHttpToLegacy(code: string, status: number | null | undefined): boolean {
  const normalized = String(code || "").trim();
  if (normalized === "upload_http_404" || normalized === "upload_http_405") return true;
  if (normalized === "upload_offset_conflict" || normalized === "upload_offset_query_failed") return true;
  return typeof status === "number" && Number.isFinite(status) && status >= 500 && status < 600;
}

export function shouldReconcileOutboxFromWorker(
  state: Pick<AppState, "authed" | "selfId" | "deliverySync" | "outbox">,
  userId: string
): boolean {
  const uid = String(state.selfId || "").trim();
  const target = String(userId || "").trim();
  if (!state.authed || !uid || !target || uid !== target) return false;
  const sync = getRuntimeDeliveryDomainSyncState(state, "outbox");
  return Boolean(sync.reconcilePending || (!sync.loaded && hasOutboxEntries(state.outbox)));
}

export function shouldAttemptOutboxDrain(
  state: Pick<AppState, "authed" | "selfId" | "conn" | "netLeader" | "outbox">
): boolean {
  return Boolean(
    state.authed &&
      state.selfId &&
      state.conn === "connected" &&
      state.netLeader &&
      hasPendingOutboxEntries(state.outbox)
  );
}

export function planOutboxDrain(
  state: Pick<AppState, "authed" | "selfId" | "conn" | "netLeader" | "outbox" | "friends">,
  opts?: {
    nowMs?: number;
    scheduleGraceMs?: number;
    retryMinMs?: number;
    maxEntries?: number;
  }
): OutboxDrainPlan {
  const nowMs = Math.max(0, Math.trunc(Number(opts?.nowMs) || Date.now()));
  const scheduleGraceMs = Math.max(0, Math.trunc(Number(opts?.scheduleGraceMs) || 0));
  const retryMinMs = Math.max(0, Math.trunc(Number(opts?.retryMinMs) || 0));
  const maxEntries = Math.max(1, Math.trunc(Number(opts?.maxEntries) || 1));

  let nextScheduleAt: number | null = null;
  let retryAt: number | null = null;
  const pending: PlannedOutboxEntry[] = [];

  for (const [key, list] of Object.entries(state.outbox || {})) {
    for (const entry of Array.isArray(list) ? list : []) {
      const localId = typeof entry?.localId === "string" ? entry.localId.trim() : "";
      const text = typeof entry?.text === "string" ? entry.text : "";
      const to = typeof entry?.to === "string" && entry.to.trim() ? entry.to.trim() : undefined;
      const room = typeof entry?.room === "string" && entry.room.trim() ? entry.room.trim() : undefined;
      if (!localId || !text || (!to && !room) || entry?.status === "sent") continue;

      const ts = Number.isFinite(entry?.ts) ? Math.trunc(Number(entry.ts)) : 0;
      const scheduleAt = Number.isFinite(entry?.scheduleAt) && Number(entry.scheduleAt) > 0 ? Math.trunc(Number(entry.scheduleAt)) : 0;
      if (scheduleAt && scheduleAt > nowMs + scheduleGraceMs) {
        nextScheduleAt = nextScheduleAt === null ? scheduleAt : Math.min(nextScheduleAt, scheduleAt);
        continue;
      }

      const lastAttemptAt =
        Number.isFinite(entry?.lastAttemptAt) && Number(entry.lastAttemptAt) > 0 ? Math.trunc(Number(entry.lastAttemptAt)) : 0;
      if (lastAttemptAt && nowMs - lastAttemptAt < retryMinMs) {
        const nextRetry = lastAttemptAt + retryMinMs;
        retryAt = retryAt === null ? nextRetry : Math.min(retryAt, nextRetry);
        continue;
      }

      pending.push({
        key,
        localId,
        text,
        ts,
        lastAttemptAt,
        ...(to ? { to } : {}),
        ...(room ? { room } : {}),
        ...(entry?.whenOnline ? { whenOnline: true } : {}),
        ...(entry?.silent ? { silent: true } : {}),
        ...(scheduleAt ? { scheduleAt } : {}),
      });
    }
  }

  if (!state.authed || !state.selfId) {
    return { drainable: [], nextScheduleAt, retryAt, blocked: "not_authed" };
  }
  if (state.conn !== "connected") {
    return { drainable: [], nextScheduleAt, retryAt, blocked: "no_connection" };
  }
  if (!state.netLeader) {
    if (pending.length) {
      const leaderRetryAt = nowMs + 2500;
      retryAt = retryAt === null ? leaderRetryAt : Math.min(retryAt, leaderRetryAt);
    }
    return { drainable: [], nextScheduleAt, retryAt, blocked: "not_leader" };
  }

  const onlineById = new Map<string, boolean>();
  for (const f of state.friends || []) {
    const id = String(f?.id || "").trim();
    if (!id) continue;
    onlineById.set(id, Boolean(f?.online));
  }

  const drainable = pending
    .filter((entry) => !(entry.whenOnline && entry.to && !onlineById.get(entry.to)))
    .sort((a, b) => a.ts - b.ts)
    .slice(0, maxEntries);

  return { drainable, nextScheduleAt, retryAt, blocked: "none" };
}
