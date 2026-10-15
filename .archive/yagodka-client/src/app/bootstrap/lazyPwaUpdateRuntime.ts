import type { Store } from "../../stores/store";
import type { AppState, PwaUpdateStage } from "../../stores/types";
import { shouldReloadForBuild } from "../../helpers/pwa/shouldReloadForBuild";
import { isPwaUpdateBusy } from "../../helpers/pwa/updateState";
import { scheduleDeferredTask } from "./scheduleDeferredTask";
import { recoverFromLazyImportError } from "./lazyImportRecovery";

type BufferedUpdateEvent = {
  type: "yagodka:pwa-build" | "yagodka:pwa-sw-error" | "yagodka:pwa-update";
  detail?: unknown;
};

type LazyPwaUpdateRuntimeDeps = {
  store: Store<AppState>;
  send: (payload: any) => void;
  flushBeforeReload: () => void;
  getLastUserInputAt: () => number;
  hasPendingHistoryActivityForUpdate: () => boolean;
  hasPendingPreviewActivityForUpdate: () => boolean;
  hasPendingFileActivityForUpdate: () => boolean;
};

export interface ClientUpdateConnectionReadiness {
  connect: boolean;
  reason: string;
  buildId: string | null;
  stage?: PwaUpdateStage;
}

export function createLazyPwaUpdateRuntime(deps: LazyPwaUpdateRuntimeDeps): {
  startDeferredBoot: () => void;
  applyPwaUpdateNow: (opts?: { mode?: "auto" | "manual"; buildId?: string }) => Promise<void>;
  deferPwaUpdate: () => void;
  forceUpdateReload: (reason?: string) => void;
  forcePwaUpdate: () => Promise<void>;
  scheduleAutoApplyPwaUpdate: (delayMs?: number) => void;
  whenClientReadyForConnection: (opts?: { timeoutMs?: number }) => Promise<ClientUpdateConnectionReadiness>;
} {
  const bufferedEvents: BufferedUpdateEvent[] = [];
  let buffersInstalled = false;
  let runtimeLoaded = false;
  let runtimePromise: Promise<any> | null = null;

  const bufferEvent =
    (type: BufferedUpdateEvent["type"]) =>
    (ev: Event): void => {
      if (runtimeLoaded) return;
      const detail = ev instanceof CustomEvent ? ev.detail : undefined;
      bufferedEvents.push({ type, detail });
    };

  const onBuild = bufferEvent("yagodka:pwa-build");
  const onSwError = bufferEvent("yagodka:pwa-sw-error");
  const onUpdate = bufferEvent("yagodka:pwa-update");

  function deriveStoreReadiness(reason = "store_fallback"): ClientUpdateConnectionReadiness {
    const st = deps.store.get();
    const currentBuildId = String(st.clientVersion || "").trim();
    const updateLatest = String(st.updateLatest || "").trim();
    const runtimeBuildId = String((st as any).pwaUpdate?.buildId || "").trim();
    const runtimeStage = (String((st as any).pwaUpdate?.stage || "idle") as PwaUpdateStage) || "idle";
    const buildId = updateLatest || runtimeBuildId || null;
    const busy = isPwaUpdateBusy(runtimeStage);
    const needsLatest = Boolean(updateLatest && shouldReloadForBuild(currentBuildId, updateLatest));
    const needsRuntime = Boolean(runtimeBuildId && shouldReloadForBuild(currentBuildId, runtimeBuildId));
    const hasPendingManualUpdate = needsLatest || needsRuntime || Boolean(st.pwaUpdateAvailable && buildId);
    if (busy) return { connect: true, reason: "update_busy_nonblocking", buildId, stage: runtimeStage };
    if (hasPendingManualUpdate) return { connect: true, reason: "update_pending_nonblocking", buildId, stage: runtimeStage };
    return { connect: true, reason, buildId: buildId && !shouldReloadForBuild(currentBuildId, buildId) ? buildId : null, stage: runtimeStage };
  }

  async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    const limit = Math.max(0, Math.trunc(Number(timeoutMs) || 0));
    if (limit <= 0 || typeof window === "undefined" || typeof window.setTimeout !== "function") {
      try {
        return await promise;
      } catch {
        return fallback;
      }
    }
    return await new Promise<T>((resolve) => {
      let done = false;
      let timer: number | null = null;
      const finish = (value: T) => {
        if (done) return;
        done = true;
        if (timer !== null) {
          try {
            window.clearTimeout(timer);
          } catch {
            // ignore
          }
        }
        resolve(value);
      };
      timer = window.setTimeout(() => finish(fallback), limit);
      promise.then((value) => finish(value)).catch(() => finish(fallback));
    });
  }

  function installBuffers(): void {
    if (buffersInstalled) return;
    buffersInstalled = true;
    window.addEventListener("yagodka:pwa-build", onBuild);
    window.addEventListener("yagodka:pwa-sw-error", onSwError);
    window.addEventListener("yagodka:pwa-update", onUpdate);
  }

  function removeBuffers(): void {
    if (!buffersInstalled) return;
    buffersInstalled = false;
    window.removeEventListener("yagodka:pwa-build", onBuild);
    window.removeEventListener("yagodka:pwa-sw-error", onSwError);
    window.removeEventListener("yagodka:pwa-update", onUpdate);
  }

  function replayBufferedEvents(): void {
    const queued = bufferedEvents.splice(0, bufferedEvents.length);
    for (const event of queued) {
      if (event.type === "yagodka:pwa-update") {
        window.dispatchEvent(new Event(event.type));
        continue;
      }
      window.dispatchEvent(new CustomEvent(event.type, { detail: event.detail }));
    }
  }

  function ensureRuntimeLoaded(): Promise<any> {
    if (runtimeLoaded && runtimePromise) return runtimePromise;
    if (!runtimePromise) {
      runtimePromise = import("../features/pwa/pwaUpdateFeature")
        .then(({ createPwaUpdateFeature }) => {
          const feature = createPwaUpdateFeature({
            store: deps.store,
            send: deps.send,
            flushBeforeReload: deps.flushBeforeReload,
            getLastUserInputAt: deps.getLastUserInputAt,
            hasPendingHistoryActivityForUpdate: deps.hasPendingHistoryActivityForUpdate,
            hasPendingPreviewActivityForUpdate: deps.hasPendingPreviewActivityForUpdate,
            hasPendingFileActivityForUpdate: deps.hasPendingFileActivityForUpdate,
          });
          feature.installEventListeners();
          runtimeLoaded = true;
          removeBuffers();
          replayBufferedEvents();
          return feature;
        })
        .catch((err) => {
          recoverFromLazyImportError(err, "pwa_update_runtime");
          runtimePromise = null;
          throw err;
        });
    }
    return runtimePromise;
  }

  function startDeferredBoot(): void {
    scheduleDeferredTask(() => {
      void ensureRuntimeLoaded().catch(() => {});
    });
  }

  async function applyPwaUpdateNow(opts?: { mode?: "auto" | "manual"; buildId?: string }): Promise<void> {
    const feature = await ensureRuntimeLoaded();
    await feature.applyPwaUpdateNow(opts);
  }

  function deferPwaUpdate(): void {
    void ensureRuntimeLoaded()
      .then((feature) => {
        if (typeof feature.deferPwaUpdate === "function") feature.deferPwaUpdate();
      })
      .catch(() => {});
  }

  function forceUpdateReload(reason?: string): void {
    void ensureRuntimeLoaded()
      .then((feature) => {
        feature.forceUpdateReload(reason);
      })
      .catch(() => {});
  }

  async function forcePwaUpdate(): Promise<void> {
    const feature = await ensureRuntimeLoaded();
    await feature.forcePwaUpdate();
  }

  function scheduleAutoApplyPwaUpdate(delayMs?: number): void {
    void ensureRuntimeLoaded()
      .then((feature) => {
        feature.scheduleAutoApplyPwaUpdate(delayMs);
      })
      .catch(() => {});
  }

  async function whenClientReadyForConnection(opts?: { timeoutMs?: number }): Promise<ClientUpdateConnectionReadiness> {
    const timeoutMs = Math.max(800, Math.min(8000, Math.trunc(Number(opts?.timeoutMs ?? 4500) || 4500)));
    const feature = await withTimeout(ensureRuntimeLoaded(), timeoutMs, null);
    if (!feature || typeof feature.whenClientReadyForConnection !== "function") {
      return deriveStoreReadiness("update_runtime_timeout");
    }
    return await withTimeout(
      Promise.resolve(feature.whenClientReadyForConnection()),
      timeoutMs,
      deriveStoreReadiness("update_reconcile_timeout")
    );
  }

  installBuffers();

  return {
    startDeferredBoot,
    applyPwaUpdateNow,
    deferPwaUpdate,
    forceUpdateReload,
    forcePwaUpdate,
    scheduleAutoApplyPwaUpdate,
    whenClientReadyForConnection,
  };
}
