import type { Store } from "../../../stores/store";
import type { AppState, DesktopUpdateRuntimeState, DesktopUpdateState, ToastKind } from "../../../stores/types";
import type { ShowToastOptions } from "../ui/toastFeature";

interface DesktopUpdateInfo {
  version?: string;
  releaseDate?: string;
}

interface DesktopUpdateProgress {
  percent?: number;
  transferred?: number;
  total?: number;
}

export interface DesktopUpdateConnectionReadiness {
  connect: boolean;
  reason: string;
  buildId: string | null;
  stage?: DesktopUpdateState;
}

interface DesktopUpdateBridge {
  getStatus?: () => Promise<unknown>;
  check?: () => Promise<unknown>;
  download?: () => Promise<unknown>;
  install?: () => Promise<unknown>;
  onStatus?: (callback: (status: unknown) => void) => (() => void) | void;
}

export interface DesktopUpdateFeatureDeps {
  store: Store<AppState>;
  showToast: (message: string, opts?: ShowToastOptions) => void;
  flushBeforeInstall: () => void;
}

function desktopUpdatesBridge(): DesktopUpdateBridge | null {
  try {
    const bridge = (globalThis as typeof globalThis & { yagodkaDesktop?: YagodkaDesktopBridge }).yagodkaDesktop;
    return bridge?.updates && typeof bridge.updates === "object" ? bridge.updates : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function readNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(raw: unknown): DesktopUpdateRuntimeState {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawState = readString(obj.state) as DesktopUpdateState;
  const state: DesktopUpdateState =
    rawState === "idle" ||
    rawState === "disabled" ||
    rawState === "checking" ||
    rawState === "available" ||
    rawState === "not_available" ||
    rawState === "downloading" ||
    rawState === "ready" ||
    rawState === "installing" ||
    rawState === "failed"
      ? rawState
      : "idle";
  const info = obj.updateInfo && typeof obj.updateInfo === "object" ? (obj.updateInfo as Record<string, unknown>) : null;
  const progress = obj.progress && typeof obj.progress === "object" ? (obj.progress as Record<string, unknown>) : null;
  return {
    state,
    supported: Boolean(obj.supported),
    reason: readString(obj.reason),
    appVersion: readString(obj.appVersion),
    feedUrl: readString(obj.feedUrl),
    autoCheck: Boolean(obj.autoCheck),
    updateInfo: info
      ? {
          version: readString(info.version),
          releaseDate: readString(info.releaseDate),
        }
      : null,
    progress: progress
      ? {
          percent: readNumber(progress.percent),
          transferred: readNumber(progress.transferred),
          total: readNumber(progress.total),
        }
      : null,
    error: readString(obj.error),
    updatedAt: Date.now(),
  };
}

function updateVersion(status: DesktopUpdateRuntimeState): string {
  return status.updateInfo?.version || "";
}

function reasonLabel(reason: string): string {
  if (reason === "not_packaged") return "доступно только в собранном приложении";
  if (reason === "macos_only") return "доступно только на macOS";
  if (reason === "feed_disabled") return "release feed выключен";
  if (reason === "electron_updater_missing") return "модуль обновлений не установлен";
  if (reason === "untrusted_sender") return "недоверенный источник";
  return reason || "недоступно";
}

function statusMessage(status: DesktopUpdateRuntimeState): string {
  const version = updateVersion(status);
  if (status.state === "disabled") return `Desktop обновления: ${reasonLabel(status.reason)}`;
  if (status.state === "checking") return "Проверяем desktop обновления…";
  if (status.state === "available") return version ? `Доступно desktop обновление v${version}` : "Доступно desktop обновление";
  if (status.state === "not_available") return "Desktop обновлений нет";
  if (status.state === "downloading") {
    const pct = Math.max(0, Math.min(100, Math.round(status.progress?.percent || 0)));
    return pct ? `Скачиваем desktop обновление ${pct}%` : "Скачиваем desktop обновление…";
  }
  if (status.state === "ready") return version ? `Desktop обновление v${version} готово` : "Desktop обновление готово";
  if (status.state === "installing") return "Перезапускаем для desktop обновления…";
  if (status.state === "failed") return `Desktop обновление не выполнено: ${status.error || "ошибка"}`;
  return "Desktop обновления готовы";
}

function statusKind(status: DesktopUpdateRuntimeState): ToastKind {
  if (status.state === "failed" || status.state === "disabled") return "warn";
  if (status.state === "available" || status.state === "ready" || status.state === "not_available") return "success";
  return "info";
}

export function createDesktopUpdateFeature(deps: DesktopUpdateFeatureDeps) {
  const { store, showToast, flushBeforeInstall } = deps;
  let unlistenStatus: (() => void) | null = null;
  let bound = false;
  let lastCheckPromise: Promise<DesktopUpdateRuntimeState> | null = null;

  const shouldBlockConnection = (status: DesktopUpdateRuntimeState): boolean =>
    status.supported &&
    (["checking", "available", "downloading", "ready", "installing"].includes(status.state) ||
      (status.state === "failed" && status.reason === "desktop_update_check_timeout"));

  const shouldOpenModal = (status: DesktopUpdateRuntimeState): boolean =>
    status.supported &&
    (["available", "downloading", "ready", "installing"].includes(status.state) ||
      (status.state === "failed" && status.reason === "desktop_update_check_timeout"));

  const applyStatusToStore = (status: DesktopUpdateRuntimeState, opts?: { openModal?: boolean; closeModal?: boolean }) => {
    const message = statusMessage(status);
    store.set((prev) => {
      const patch: Partial<AppState> = { desktopUpdate: status };
      if (message && (status.state === "checking" || status.state === "downloading" || status.state === "installing" || status.state === "available" || status.state === "ready")) {
        patch.status = message;
      }
      if (opts?.openModal || shouldOpenModal(status)) {
        patch.modal = { kind: "desktop_update" };
      } else if ((opts?.closeModal || status.state === "not_available" || status.state === "disabled") && prev.modal?.kind === "desktop_update") {
        patch.modal = null;
      }
      return { ...prev, ...patch };
    });
  };

  const showStatus = (status: DesktopUpdateRuntimeState, forceToast = false) => {
    applyStatusToStore(status);
    const message = statusMessage(status);
    if (!message) return;
    if (status.state === "downloading") {
      store.set({ status: message });
      return;
    }
    const actions: ShowToastOptions["actions"] = [];
    if (status.state === "available") {
      actions.push({ id: "desktop-update-download", label: "Скачать", primary: true, onClick: () => void download() });
    } else if (status.state === "ready") {
      actions.push({ id: "desktop-update-install", label: "Перезапустить", primary: true, onClick: () => void install() });
    } else if (status.state === "failed" || status.state === "not_available" || status.state === "disabled") {
      actions.push({ id: "desktop-update-check", label: "Проверить", onClick: () => void check() });
    }
    if (!forceToast) return;
    showToast(message, {
      kind: statusKind(status),
      timeoutMs: actions.length ? 12000 : 5200,
      actions,
    });
  };

  const request = async (action: "getStatus" | "check" | "download" | "install", forceToast = true): Promise<DesktopUpdateRuntimeState> => {
    const updates = desktopUpdatesBridge();
    const fn = updates?.[action];
    if (typeof fn !== "function") {
      const status = normalizeStatus({ state: "disabled", supported: false, reason: "electron_updater_missing" });
      showStatus(status, forceToast);
      return status;
    }
    try {
      const raw = await fn.call(updates);
      const status = normalizeStatus(raw);
      showStatus(status, forceToast);
      return status;
    } catch (error) {
      const status = normalizeStatus({ state: "failed", supported: false, error: error instanceof Error ? error.message : String(error) });
      showStatus(status, true);
      return status;
    }
  };

  const check = () => {
    lastCheckPromise = request("check", true).finally(() => {
      lastCheckPromise = null;
    });
    return lastCheckPromise;
  };
  const download = () => request("download", true);
  const install = async () => {
    try {
      flushBeforeInstall();
    } catch {
      // ignore
    }
    await request("install", true);
  };

  const bind = () => {
    if (bound) return;
    bound = true;
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest(
          "button[data-action='desktop-update-check'],button[data-action='desktop-update-download'],button[data-action='desktop-update-install']"
        ) as HTMLButtonElement | null;
        if (!button) return;
        event.preventDefault();
        const action = String(button.getAttribute("data-action") || "");
        if (action === "desktop-update-check") void check();
        else if (action === "desktop-update-download") void download();
        else if (action === "desktop-update-install") void install();
      },
      true
    );
  };

  const start = () => {
    const updates = desktopUpdatesBridge();
    if (!updates) return;
    if (typeof updates.onStatus === "function") {
      const off = updates.onStatus((status) => showStatus(normalizeStatus(status), true));
      if (typeof off === "function") unlistenStatus = off;
    }
    void request("getStatus", false).then((status) => {
      if (status.supported && status.autoCheck && (status.state === "idle" || status.state === "not_available")) {
        void check();
      }
    });
  };

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

  async function whenClientReadyForConnection(opts?: { timeoutMs?: number }): Promise<DesktopUpdateConnectionReadiness> {
    if (!desktopUpdatesBridge()) return { connect: true, reason: "desktop_update_unavailable", buildId: null };
    const timeoutMs = Math.max(1200, Math.min(9000, Math.trunc(Number(opts?.timeoutMs ?? 6500) || 6500)));
    const current = store.get().desktopUpdate;
    const fallback =
      current && (current.supported || current.state !== "idle")
        ? current
        : normalizeStatus({
            state: "failed",
            supported: true,
            reason: "desktop_update_check_timeout",
            appVersion: current?.appVersion,
            error: "Проверка обновления заняла слишком много времени.",
          });
    const status =
      lastCheckPromise && current.state === "checking"
        ? await withTimeout(lastCheckPromise, timeoutMs, fallback)
        : await withTimeout(request(current.autoCheck || current.state === "idle" ? "check" : "getStatus", false), timeoutMs, fallback);
    if (shouldBlockConnection(status)) {
      applyStatusToStore(status, { openModal: shouldOpenModal(status) });
      return {
        connect: false,
        reason: `desktop_update_${status.state}`,
        buildId: updateVersion(status) || null,
        stage: status.state,
      };
    }
    return {
      connect: true,
      reason: status.state === "failed" ? "desktop_update_check_failed" : "desktop_update_ready",
      buildId: updateVersion(status) || null,
      stage: status.state,
    };
  }

  const stop = () => {
    try {
      unlistenStatus?.();
    } catch {
      // ignore
    }
    unlistenStatus = null;
  };

  return { bind, start, stop, check, download, install, whenClientReadyForConnection };
}
