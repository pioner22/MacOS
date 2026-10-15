import type { Store } from "../../stores/store";
import type { AppState } from "../../stores/types";
import type { GatewayTransport } from "../../lib/net/gatewayClient";

export interface ClientUpdateReadinessWorker {
  whenClientReadyForConnection: (opts?: { timeoutMs?: number }) => Promise<ClientUpdateConnectionReadiness>;
}

export interface ClientUpdateConnectionReadiness {
  connect: boolean;
  reason: string;
  buildId: string | null;
  stage?: string;
}

export interface ClientConnectionWorker {
  startAfterClientUpdateReady: () => void;
  connectNow: (reason?: string) => void;
}

export interface ClientConnectionWorkerDeps {
  store: Store<AppState>;
  gateway: GatewayTransport;
  updateWorker: ClientUpdateReadinessWorker;
  desktopUpdateWorker?: ClientUpdateReadinessWorker | null;
  readinessTimeoutMs?: number;
}

function updateCheckStatus(): string {
  return "Проверяем обновление клиента перед подключением…";
}

function blockedStatus(readiness: ClientUpdateConnectionReadiness): string {
  const build = readiness.buildId ? ` (${readiness.buildId})` : "";
  if (readiness.reason.startsWith("desktop_update_")) {
    if (readiness.reason === "desktop_update_checking") {
      return "Проверяем desktop обновление перед подключением…";
    }
    if (readiness.reason === "desktop_update_downloading") {
      return `Скачиваем desktop обновление${build}. Подключение начнётся после перезапуска актуальной версии.`;
    }
    if (readiness.reason === "desktop_update_ready") {
      return `Desktop обновление${build} готово. Перезапустите приложение для подключения.`;
    }
    if (readiness.reason === "desktop_update_installing") {
      return "Перезапускаем desktop приложение для обновления…";
    }
    if (readiness.reason === "desktop_update_failed") {
      return "Не удалось проверить desktop обновление. Повторите проверку, подключение пока остановлено.";
    }
    return `Доступно desktop обновление${build}. Сначала обновите приложение, затем подключение запустится автоматически после перезапуска.`;
  }
  if (readiness.reason.startsWith("update_") && readiness.reason !== "update_pending") {
    return `Обновление клиента выполняется${build}. Подключение к серверу начнётся после завершения обновления.`;
  }
  return `Доступно обновление клиента${build}. Сначала обновите приложение, затем подключение запустится автоматически после перезапуска.`;
}

export function createClientConnectionWorker(deps: ClientConnectionWorkerDeps): ClientConnectionWorker {
  const { store, gateway, updateWorker, desktopUpdateWorker } = deps;
  const readinessWorkers = [desktopUpdateWorker, updateWorker].filter((worker): worker is ClientUpdateReadinessWorker =>
    Boolean(worker && typeof worker.whenClientReadyForConnection === "function")
  );
  const readinessTimeoutMs = Math.max(800, Math.min(8000, Math.trunc(Number(deps.readinessTimeoutMs ?? 4500) || 4500)));
  let connectStarted = false;
  let readinessInFlight = false;
  let readinessRetryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  function connectNow(reason = "manual"): void {
    if (connectStarted) return;
    connectStarted = true;
    if (readinessRetryTimer !== null) {
      globalThis.clearTimeout(readinessRetryTimer);
      readinessRetryTimer = null;
    }
    try {
      (globalThis as any).__yagodka_connect_reason = reason;
    } catch {
      // ignore
    }
    gateway.connect();
  }

  function markChecking(): void {
    store.set((prev) => {
      if (prev.conn === "connected") return prev;
      const nextStatus = updateCheckStatus();
      if (prev.status === nextStatus) return prev;
      return { ...prev, status: nextStatus };
    });
  }

  function markBlocked(readiness: ClientUpdateConnectionReadiness): void {
    const status = blockedStatus(readiness);
    const isDesktopUpdate = readiness.reason.startsWith("desktop_update_");
    store.set((prev) => ({
      ...prev,
      conn: prev.conn === "connected" ? prev.conn : "disconnected",
      status,
      pwaUpdateAvailable: isDesktopUpdate ? prev.pwaUpdateAvailable : prev.pwaUpdateAvailable || readiness.reason === "update_pending",
      ...(isDesktopUpdate
        ? { modal: { kind: "desktop_update" as const } }
        : readiness.reason === "update_pending" || prev.pwaUpdateAvailable
          ? { modal: { kind: "pwa_update" as const } }
          : {}),
    }));
  }

  function scheduleReadinessRetry(readiness: ClientUpdateConnectionReadiness): void {
    if (connectStarted) return;
    const retryableReasons = new Set([
      "desktop_update_checking",
      "desktop_update_downloading",
      "desktop_update_installing",
      "update_checking",
      "update_downloading",
      "update_applying",
      "update_verifying",
    ]);
    if (!retryableReasons.has(readiness.reason)) return;
    if (readinessRetryTimer !== null) {
      globalThis.clearTimeout(readinessRetryTimer);
      readinessRetryTimer = null;
    }
    const delayMs = readiness.reason === "desktop_update_checking" ? 1400 : 3200;
    readinessRetryTimer = globalThis.setTimeout(() => {
      readinessRetryTimer = null;
      void startAfterClientUpdateReady();
    }, delayMs);
  }

  async function startAfterClientUpdateReady(): Promise<void> {
    if (connectStarted || readinessInFlight) return;
    readinessInFlight = true;
    markChecking();
    try {
      let readyReason = "client_update_ready";
      for (const worker of readinessWorkers) {
        const readiness = await worker.whenClientReadyForConnection({ timeoutMs: readinessTimeoutMs });
        if (!readiness.connect) {
          markBlocked(readiness);
          scheduleReadinessRetry(readiness);
          return;
        }
        readyReason = readiness.reason || readyReason;
      }
      connectNow(readyReason);
    } finally {
      readinessInFlight = false;
    }
  }

  return {
    startAfterClientUpdateReady: () => {
      void startAfterClientUpdateReady();
    },
    connectNow,
  };
}
