import { sanitizeOutboxMap, type OutboxMap } from "../chat/outbox";
import { shouldRegisterOutboxBackgroundSync } from "../runtime/deliveryCoordinator";

const OUTBOX_SYNC_TIMEOUT_MS = 900;
const OUTBOX_SYNC_TAG = "yagodka-outbox-sync";

export type OutboxWorkerSyncStatus =
  | "synced"
  | "synced_no_pending"
  | "skipped_no_user"
  | "skipped_no_controller"
  | "post_failed"
  | "register_failed";

export interface OutboxWorkerSyncResult {
  ok: boolean;
  status: OutboxWorkerSyncStatus;
  pending: boolean;
  registered: boolean;
  error?: string | null;
}

async function getServiceWorkerController(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const controller = navigator.serviceWorker.controller;
  if (controller) return controller;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active ?? null;
  } catch {
    return null;
  }
}

function normalizeOutboxForSync(outbox: OutboxMap): OutboxMap {
  const sanitized = sanitizeOutboxMap(outbox);
  const next: OutboxMap = {};
  for (const [key, list] of Object.entries(sanitized)) {
    const filtered = (list || []).filter((e) => e && e.status !== "sending");
    if (filtered.length) next[key] = filtered;
  }
  return next;
}

export async function syncOutboxToServiceWorker(
  userId: string,
  outbox: OutboxMap
): Promise<OutboxWorkerSyncResult> {
  const uid = String(userId || "").trim();
  const payloadOutbox = normalizeOutboxForSync(outbox);
  const pending = shouldRegisterOutboxBackgroundSync(payloadOutbox);
  if (!uid) return { ok: false, status: "skipped_no_user", pending, registered: false };
  const controller = await getServiceWorkerController();
  if (!controller) return { ok: !pending, status: "skipped_no_controller", pending, registered: false };
  try {
    controller.postMessage({
      type: "PWA_OUTBOX_SYNC",
      userId: uid,
      outbox: payloadOutbox,
    });
  } catch (err) {
    const error = err instanceof Error ? String(err.message || "") : String(err || "");
    return { ok: false, status: "post_failed", pending, registered: false, error: error || null };
  }

  if (!pending) return { ok: true, status: "synced_no_pending", pending, registered: false };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sync = (reg as any)?.sync;
    if (sync && typeof sync.register === "function") {
      await sync.register(OUTBOX_SYNC_TAG);
      return { ok: true, status: "synced", pending, registered: true };
    }
    return { ok: true, status: "synced", pending, registered: false };
  } catch (err) {
    const error = err instanceof Error ? String(err.message || "") : String(err || "");
    return { ok: false, status: "register_failed", pending, registered: false, error: error || null };
  }
}

export async function requestOutboxSnapshot(userId: string): Promise<OutboxMap | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const controller = await getServiceWorkerController();
  if (!controller) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: OutboxMap | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), OUTBOX_SYNC_TIMEOUT_MS);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const data = event?.data;
      if (data && typeof data === "object" && data.outbox && typeof data.outbox === "object") {
        finish(data.outbox as OutboxMap);
        return;
      }
      finish(null);
    };
    try {
      controller.postMessage({ type: "PWA_OUTBOX_REQUEST", userId: uid }, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

export async function clearOutboxForUser(userId: string): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  const controller = await getServiceWorkerController();
  if (!controller) return;
  try {
    controller.postMessage({ type: "PWA_OUTBOX_CLEAR", userId: uid });
  } catch {
    // ignore
  }
}
