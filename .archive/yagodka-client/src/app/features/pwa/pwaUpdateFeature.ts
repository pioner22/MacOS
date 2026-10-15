import { APP_VERSION } from "../../../config/app";
import { stashSessionTokenForReload } from "../../../helpers/auth/session";
import { buildClientInfoTags } from "../../../helpers/device/clientTags";
import { storeActiveBuildId } from "../../../helpers/pwa/buildIdStore";
import { getPwaStabilityHoldRemainingMs, readPwaStabilityHold } from "../../../helpers/pwa/stabilityHold";
import { hasPwaReloadBlockers } from "../../../helpers/pwa/reloadSafety";
import { activatePwaUpdate, checkForPwaUpdate, hasPwaUpdate } from "../../../helpers/pwa/registerServiceWorker";
import { isServiceWorkerRuntimeAvailable } from "../../../helpers/pwa/serviceWorkerRuntime";
import { shouldReloadForBuild } from "../../../helpers/pwa/shouldReloadForBuild";
import { clearPendingPwaBuild, readPendingPwaBuild, writePendingPwaBuild } from "../../../helpers/pwa/pendingUpdate";
import { createPwaUpdateState, isPwaUpdateBusy, mergePwaUpdateState } from "../../../helpers/pwa/updateState";
import { hasActiveFileTransferEntries } from "../../../helpers/runtime/deliveryCoordinator";
import { isIOS, isStandaloneDisplayMode } from "../../../helpers/ui/iosInputAssistant";
import type { Store } from "../../../stores/store";
import type { AppState, PwaUpdateDecision, PwaUpdateStage } from "../../../stores/types";

export type PwaUpdateMode = "auto" | "manual";

export interface PwaUpdateFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  flushBeforeReload: () => void;
  getLastUserInputAt: () => number;
  hasPendingHistoryActivityForUpdate: () => boolean;
  hasPendingPreviewActivityForUpdate: () => boolean;
  hasPendingFileActivityForUpdate: () => boolean;
}

export interface PwaUpdateFeature {
  installEventListeners: () => void;
  dispose: () => void;
  applyPwaUpdateNow: (opts?: { mode?: PwaUpdateMode; buildId?: string }) => Promise<void>;
  deferPwaUpdate: () => void;
  forceUpdateReload: (reason?: string) => void;
  forcePwaUpdate: () => Promise<void>;
  scheduleAutoApplyPwaUpdate: (delayMs?: number) => void;
  whenClientReadyForConnection: () => Promise<ClientUpdateConnectionReadiness>;
}

type PwaAutoApplyGuard = { buildId: string; tries: number; ts: number };

export interface ClientUpdateConnectionReadiness {
  connect: boolean;
  reason: string;
  buildId: string | null;
  stage?: PwaUpdateStage;
}

export function createPwaUpdateFeature(deps: PwaUpdateFeatureDeps): PwaUpdateFeature {
  const {
    store,
    send,
    flushBeforeReload,
    getLastUserInputAt,
    hasPendingHistoryActivityForUpdate,
    hasPendingPreviewActivityForUpdate,
    hasPendingFileActivityForUpdate,
  } = deps;

  let listenersInstalled = false;
  let pwaAutoApplyTimer: number | null = null;
  let pwaForceInFlight = false;
  const PWA_AUTO_APPLY_GUARD_KEY = "yagodka_pwa_auto_apply_guard_v1";
  const PWA_AUTO_APPLY_LOG_KEY = "yagodka_pwa_update_log_v1";
  const PWA_AUTO_APPLY_GUARD_RESET_MS = 10 * 60 * 1000;
  const PWA_AUTO_APPLY_MAX_TRIES = 3;
  const PWA_AUTO_APPLY_RETRY_MS = 20 * 1000;
  const PWA_AUTO_APPLY_LOG_LIMIT = 24;
  const PWA_AUTO_APPLY_STATUS = "Получено обновление веб-клиента. Откройте обновление вручную, когда приложение не используется.";
  const PWA_MANUAL_PROMPT_DETAIL = "Можно обновить сейчас или отложить до перезапуска. Подключение к серверу продолжит работать.";
  const PWA_DEFERRED_STATUS = "Обновление веб-клиента отложено до перезапуска.";
  const PWA_MANUAL_CHECK_TIMEOUT_MS = 3500;
  const PWA_FORCE_WATCHDOG_MS = 12_000;
  const PWA_RESET_STEP_TIMEOUT_MS = 4_500;
  const PWA_FOREGROUND_CHECK_TIMEOUT_MS = 2200;
  const PWA_FOREGROUND_STARTUP_DELAY_MS = 12_000;
  const PWA_FOREGROUND_CHECK_INTERVAL_MS = 45_000;
  const PWA_FOREGROUND_IDLE_GRACE_MS = 2800;
  let pwaPendingBuildId = "";
  let pwaAutoApplySuppressed = false;
  let pwaBootReconcileStarted = false;
  let pwaBootReconcilePromise: Promise<void> | null = null;
  let pwaUpdateEventVerifyInFlight = false;
  let foregroundBuildCheckTimer: number | null = null;
  let foregroundBuildCheckDueAt = 0;
  let foregroundBuildCheckInFlight = false;
  let lastForegroundBuildCheckAt = 0;
  let storeUnsubscribe: (() => void) | null = null;

  const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
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
  };

  const getStorage = (kind: "session" | "local"): Storage | null => {
    try {
      if (typeof window === "undefined") return null;
      return kind === "session" ? window.sessionStorage : window.localStorage;
    } catch {
      return null;
    }
  };

  const readGuardFrom = (storage: Storage | null): PwaAutoApplyGuard | null => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(PWA_AUTO_APPLY_GUARD_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const buildId = typeof (parsed as any).buildId === "string" ? String((parsed as any).buildId).trim() : "";
      const tries = Number.isFinite((parsed as any).tries) ? Math.max(0, Math.trunc((parsed as any).tries)) : 0;
      const ts = Number.isFinite((parsed as any).ts) ? Math.max(0, Math.trunc((parsed as any).ts)) : 0;
      if (!buildId || !ts) return null;
      return { buildId, tries, ts };
    } catch {
      return null;
    }
  };

  const readPwaAutoApplyGuard = (): PwaAutoApplyGuard | null => {
    const session = readGuardFrom(getStorage("session"));
    const local = readGuardFrom(getStorage("local"));
    if (session && local) return session.ts >= local.ts ? session : local;
    return session || local;
  };

  const writePwaAutoApplyGuard = (guard: PwaAutoApplyGuard | null) => {
    const session = getStorage("session");
    const local = getStorage("local");
    try {
      if (!guard) {
        session?.removeItem(PWA_AUTO_APPLY_GUARD_KEY);
        local?.removeItem(PWA_AUTO_APPLY_GUARD_KEY);
        return;
      }
      const payload = JSON.stringify(guard);
      session?.setItem(PWA_AUTO_APPLY_GUARD_KEY, payload);
      local?.setItem(PWA_AUTO_APPLY_GUARD_KEY, payload);
    } catch {
      // ignore
    }
  };

  const clearPwaAutoApplyGuard = () => {
    writePwaAutoApplyGuard(null);
    pwaAutoApplySuppressed = false;
  };

  const shouldOpenPwaUpdatePrompt = (st: AppState): boolean => {
    const kind = st.modal?.kind;
    return !kind || kind === "pwa_update" || kind === "auth" || kind === "welcome" || kind === "update";
  };

  const setPwaUpdateRuntime = (
    stage: PwaUpdateStage,
    opts: {
      buildId?: string | null;
      message?: string;
      detail?: string;
      error?: string | null;
      userDecision?: PwaUpdateDecision;
      status?: string;
      available?: boolean;
      updateLatest?: string | null;
      modal?: "open" | "close" | "keep";
    } = {}
  ) => {
    store.set((prev) => {
      const runtimePatch: Parameters<typeof mergePwaUpdateState>[2] = {};
      if (Object.prototype.hasOwnProperty.call(opts, "buildId")) runtimePatch.buildId = opts.buildId;
      if (Object.prototype.hasOwnProperty.call(opts, "message")) runtimePatch.message = opts.message;
      if (Object.prototype.hasOwnProperty.call(opts, "detail")) runtimePatch.detail = opts.detail;
      if (Object.prototype.hasOwnProperty.call(opts, "error")) runtimePatch.error = opts.error;
      if (Object.prototype.hasOwnProperty.call(opts, "userDecision")) runtimePatch.userDecision = opts.userDecision;
      const patch: Partial<AppState> = {
        pwaUpdate: mergePwaUpdateState((prev as any).pwaUpdate, stage, runtimePatch),
      };
      if (Object.prototype.hasOwnProperty.call(opts, "status")) patch.status = opts.status ?? "";
      else if (opts.message) patch.status = opts.message;
      if (Object.prototype.hasOwnProperty.call(opts, "available")) patch.pwaUpdateAvailable = Boolean(opts.available);
      if (Object.prototype.hasOwnProperty.call(opts, "updateLatest")) patch.updateLatest = opts.updateLatest ?? null;
      if (opts.modal === "open" && shouldOpenPwaUpdatePrompt(prev)) patch.modal = { kind: "pwa_update" };
      if (opts.modal === "close" && prev.modal?.kind === "pwa_update") patch.modal = null;
      return { ...prev, ...patch };
    });
  };

  const setPendingPwaBuild = (buildId: string, status?: string) => {
    const id = String(buildId || "").trim();
    if (!id) return;
    writePendingPwaBuild(id);
    if (pwaPendingBuildId !== id) {
      pwaPendingBuildId = id;
      pwaAutoApplySuppressed = false;
    }
    store.set((prev) => {
      const prevRuntime = (prev as any).pwaUpdate;
      const prevBuildId = String(prev.updateLatest || prevRuntime?.buildId || "").trim();
      const deferredSameBuild = prevBuildId === id && prevRuntime?.userDecision === "later";
      if (deferredSameBuild) {
        if (prev.status === PWA_DEFERRED_STATUS && prev.pwaUpdateAvailable && prev.modal?.kind !== "pwa_update") return prev;
        return {
          ...prev,
          updateLatest: id,
          pwaUpdateAvailable: true,
          status: PWA_DEFERRED_STATUS,
          pwaUpdate: mergePwaUpdateState(prevRuntime, "available", {
            buildId: id,
            message: "Обновление отложено",
            detail: "Обновление отложено до перезапуска. Можно обновить вручную позже.",
            userDecision: "later",
            error: null,
          }),
          ...(prev.modal?.kind === "pwa_update" ? { modal: null } : {}),
        };
      }
      const shouldOpenPrompt = shouldOpenPwaUpdatePrompt(prev);
      const promptAlreadyVisible = prev.modal?.kind === "pwa_update";
      const samePending =
        prev.pwaUpdateAvailable &&
        prevBuildId === id &&
        prevRuntime?.stage === "available" &&
        prevRuntime?.userDecision === "pending" &&
        (promptAlreadyVisible || !shouldOpenPrompt);
      if (samePending) return prev;
      return {
        ...prev,
        updateLatest: id,
        pwaUpdateAvailable: true,
        status: status || "Доступно обновление веб-клиента. Можно обновить сейчас или позже.",
        pwaUpdate: mergePwaUpdateState(prevRuntime, "available", {
          buildId: id,
          message: "Доступно обновление веб-клиента",
          detail: status || "Нажмите «Обновить», когда будет удобно. Клиент скачает и проверит файлы после подтверждения.",
          userDecision: "pending",
          error: null,
        }),
        ...(shouldOpenPrompt ? { modal: { kind: "pwa_update" } } : {}),
      };
    });
  };

  const adoptActiveBuild = (buildId: string) => {
    const id = String(buildId || "").trim();
    if (!id) return;
    clearPendingPwaBuild(id);
    storeActiveBuildId(id);
    if (store.get().clientVersion !== id) {
      store.set({ clientVersion: id });
    }
    const st = store.get();
    if (st.conn === "connected" && st.authed) {
      send({ type: "client_info", client: "web", version: id, ...buildClientInfoTags() });
    }
  };

  const clearCurrentPwaUpdatePrompt = (buildId?: string) => {
    const id = String(buildId || "").trim();
    if (id) clearPendingPwaBuild(id);
    if (id && pwaPendingBuildId === id) pwaPendingBuildId = "";
    clearPwaAutoApplyGuard();
    store.set((prev) => {
      const updateLatest = String(prev.updateLatest ?? "").trim();
      const keepUpdateLatest = updateLatest && shouldReloadForBuild(currentClientBuildId(), updateLatest);
      const patch: Partial<AppState> = {
        pwaUpdateAvailable: false,
        pwaUpdate: createPwaUpdateState(),
        ...(keepUpdateLatest ? {} : { updateLatest: null }),
      };
      if (prev.modal?.kind === "pwa_update") patch.modal = null;
      return { ...prev, ...patch };
    });
  };

  const currentClientBuildId = (): string => String(store.get().clientVersion || APP_VERSION || "").trim();

  const getClientUpdateConnectionReadiness = (reason = "current"): ClientUpdateConnectionReadiness => {
    if (!isServiceWorkerRuntimeAvailable()) return { connect: true, reason: "sw_unavailable", buildId: null };
    const st = store.get();
    const currentBuildId = currentClientBuildId();
    const updateLatest = String(st.updateLatest ?? "").trim();
    const runtimeBuildId = String((st as any).pwaUpdate?.buildId ?? "").trim();
    const pendingBuildId = String(pwaPendingBuildId || readPendingPwaBuild(currentBuildId) || "").trim();
    const buildId = updateLatest || runtimeBuildId || pendingBuildId || null;
    const runtimeStage = ((st as any).pwaUpdate?.stage || "idle") as PwaUpdateStage;
    const busy = isPwaUpdateBusy(runtimeStage);
    const needsLatest = Boolean(updateLatest && shouldReloadForBuild(currentBuildId, updateLatest));
    const needsRuntime = Boolean(runtimeBuildId && shouldReloadForBuild(currentBuildId, runtimeBuildId));
    const needsPending = Boolean(pendingBuildId && shouldReloadForBuild(currentBuildId, pendingBuildId));
    const hasPendingManualUpdate = needsLatest || needsRuntime || needsPending || Boolean(st.pwaUpdateAvailable && buildId);
    if (busy) {
      restoreManualPwaUpdatePrompt(buildId);
      return { connect: true, reason: "update_busy_nonblocking", buildId, stage: runtimeStage };
    }
    if (hasPendingManualUpdate) return { connect: true, reason: "update_pending_nonblocking", buildId, stage: runtimeStage };
    return { connect: true, reason, buildId: buildId && !shouldReloadForBuild(currentBuildId, buildId) ? buildId : null, stage: runtimeStage };
  };

  function restoreManualPwaUpdatePrompt(buildId: string | null) {
    const id = String(buildId || "").trim();
    const opts: Parameters<typeof setPwaUpdateRuntime>[1] = {
      buildId: id || null,
      message: "Получено обновление веб-клиента",
      detail: PWA_MANUAL_PROMPT_DETAIL,
      userDecision: "pending",
      error: null,
      status: "Обновление веб-клиента готово. Можно обновить сейчас или отложить до перезапуска.",
      available: true,
      modal: "open",
    };
    if (id) opts.updateLatest = id;
    setPwaUpdateRuntime("available", opts);
    logPwaUpdate("busy_stage_recovered", id || "unknown");
  }

  const logPwaUpdate = (event: string, detail?: string) => {
    const storage = getStorage("local");
    if (!storage) return;
    try {
      const now = new Date().toISOString();
      const line = detail ? `${now} ${event} ${detail}` : `${now} ${event}`;
      const raw = storage.getItem(PWA_AUTO_APPLY_LOG_KEY);
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      const next = Array.isArray(list) ? [...list, line] : [line];
      if (next.length > PWA_AUTO_APPLY_LOG_LIMIT) next.splice(0, next.length - PWA_AUTO_APPLY_LOG_LIMIT);
      storage.setItem(PWA_AUTO_APPLY_LOG_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const markPwaAutoApplyAttempt = (buildId: string) => {
    const id = String(buildId || "").trim();
    if (!id) return;
    const now = Date.now();
    const prev = readPwaAutoApplyGuard();
    if (prev && prev.buildId === id && now - prev.ts < PWA_AUTO_APPLY_GUARD_RESET_MS) {
      writePwaAutoApplyGuard({ buildId: id, tries: Math.min(prev.tries + 1, 9), ts: now });
      logPwaUpdate("auto_try", `${id}#${Math.min(prev.tries + 1, 9)}`);
      return;
    }
    writePwaAutoApplyGuard({ buildId: id, tries: 1, ts: now });
    logPwaUpdate("auto_try", `${id}#1`);
  };

  const shouldBlockPwaAutoApply = (buildId: string): boolean => {
    const id = String(buildId || "").trim();
    if (!id) return false;
    const guard = readPwaAutoApplyGuard();
    if (!guard) return false;
    if (guard.buildId !== id) return false;
    if (Date.now() - guard.ts > PWA_AUTO_APPLY_GUARD_RESET_MS) return false;
    return guard.tries >= PWA_AUTO_APPLY_MAX_TRIES;
  };

  function buildUpdateReloadUrl(): string {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("__yg_update", String(Date.now()));
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  function navigateForUpdateReload(reason?: string) {
    stashSessionTokenForReload(reason || "pwa_update");
    try {
      sessionStorage.setItem("yagodka_updating", "1");
    } catch {
      // ignore
    }
    if (reason) logPwaUpdate("force_reload", reason);
    try {
      window.location.replace(buildUpdateReloadUrl());
      return;
    } catch {
      // ignore
    }
    window.location.reload();
  }

  function forceUpdateReload(reason?: string) {
    navigateForUpdateReload(reason || "force");
  }

  async function requestPwaBuildId(reg: ServiceWorkerRegistration | null, timeoutMs = 1200): Promise<string> {
    if (!reg || !("serviceWorker" in navigator)) return "";
    const target = navigator.serviceWorker.controller || reg.active || reg.waiting || reg.installing || null;
    if (!target) return "";
    return await new Promise((resolve) => {
      let done = false;
      let timer: number | null = null;
      const finish = (id: string) => {
        if (done) return;
        done = true;
        if (timer !== null) {
          try {
            window.clearTimeout(timer);
          } catch {
            // ignore
          }
          timer = null;
        }
        window.removeEventListener("yagodka:pwa-build", onBuild);
        resolve(id);
      };
      const onBuild = (ev: Event) => {
        const detail = (ev as CustomEvent<any>).detail;
        const buildId = String(detail?.buildId ?? "").trim();
        if (!buildId) return;
        finish(buildId);
      };
      window.addEventListener("yagodka:pwa-build", onBuild);
      timer = window.setTimeout(() => finish(""), timeoutMs);
      try {
        target.postMessage({ type: "GET_BUILD_ID" });
      } catch {
        finish("");
      }
    });
  }

  async function waitForServiceWorkerReady(timeoutMs = 1200): Promise<ServiceWorkerRegistration | null> {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const ready = navigator.serviceWorker.ready;
      if (!ready) return null;
      return await new Promise((resolve) => {
        let done = false;
        let timer: number | null = null;
        const finish = (reg: ServiceWorkerRegistration | null) => {
          if (done) return;
          done = true;
          if (timer !== null) {
            try {
              window.clearTimeout(timer);
            } catch {
              // ignore
            }
            timer = null;
          }
          resolve(reg);
        };
        timer = window.setTimeout(() => finish(null), timeoutMs);
        ready
          .then((reg) => finish(reg))
          .catch(() => finish(null));
      });
    } catch {
      return null;
    }
  }

  async function fetchSwBuildId(timeoutMs = 1500): Promise<string> {
    if (typeof fetch !== "function") return "";
    const url = `./sw.js?ts=${Date.now()}`;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer: number | null = null;
    if (controller) {
      timer = window.setTimeout(() => controller.abort(), timeoutMs);
    }
    try {
      const res = await fetch(url, { cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      if (!res.ok) return "";
      const text = await res.text();
      const m = text.match(/\bBUILD_ID\s*=\s*["']([^"']+)["']/);
      return m ? m[1].trim() : "";
    } catch {
      return "";
    } finally {
      if (timer !== null) {
        try {
          window.clearTimeout(timer);
        } catch {
          // ignore
        }
      }
    }
  }

  async function resetPwaCachesAndServiceWorkers(reason: string): Promise<void> {
    logPwaUpdate("manual_pwa_reset", reason || "unknown");
    stashSessionTokenForReload(`pwa_reset:${reason || "unknown"}`);
    try {
      const regs = await withTimeout(navigator.serviceWorker.getRegistrations(), PWA_RESET_STEP_TIMEOUT_MS, [] as ServiceWorkerRegistration[]);
      await withTimeout(Promise.all(
        regs.map(async (r) => {
          try {
            await withTimeout(r.unregister(), 1500, false);
          } catch {
            // ignore
          }
        })
      ), PWA_RESET_STEP_TIMEOUT_MS, []);
    } catch {
      // ignore
    }
    try {
      const keys = typeof caches !== "undefined" ? await withTimeout(caches.keys(), PWA_RESET_STEP_TIMEOUT_MS, [] as string[]) : [];
      await withTimeout(Promise.all(
        keys
          .filter((k) => k.startsWith("yagodka-web-cache-") || k.startsWith("yagodka-web-cache-fallback-"))
          .map(async (k) => {
            try {
              await withTimeout(caches.delete(k), 1500, false);
            } catch {
              // ignore
            }
          })
      ), PWA_RESET_STEP_TIMEOUT_MS, []);
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem("yagodka_active_build_id_v1");
    } catch {
      // ignore
    }
    try {
      sessionStorage.setItem("yagodka_updating", "1");
      const u = new URL(window.location.href);
      u.searchParams.set("__pwa_reset", String(Date.now()));
      window.location.replace(u.toString());
      return;
    } catch {
      // ignore
    }
    forceUpdateReload("manual_pwa_reset");
  }

  async function applyPwaUpdateNow(opts?: { mode?: PwaUpdateMode; buildId?: string }) {
    const mode: PwaUpdateMode = opts?.mode === "manual" ? "manual" : "auto";
    const updateLatest = String(store.get().updateLatest ?? "").trim();
    const currentBuildId = currentClientBuildId();
    let buildId = String(opts?.buildId ?? pwaPendingBuildId ?? updateLatest ?? store.get().clientVersion ?? "").trim();
    let buildIdSource = opts?.buildId ? "opts" : pwaPendingBuildId ? "pending" : updateLatest ? "latest" : "client";
    if (updateLatest && buildIdSource !== "opts" && shouldReloadForBuild(currentBuildId, updateLatest) && !shouldReloadForBuild(currentBuildId, buildId)) {
      buildId = updateLatest;
      buildIdSource = "latest";
    }
    let hasNewBuild = shouldReloadForBuild(currentBuildId, buildId);
    const latestNeedsReload = updateLatest && shouldReloadForBuild(currentBuildId, updateLatest);
    if (!hasNewBuild && latestNeedsReload && mode === "manual") {
      buildId = updateLatest;
      buildIdSource = "latest";
      hasNewBuild = true;
    }
    if (mode === "manual") {
      setPwaUpdateRuntime("checking", {
        buildId,
        message: "Проверяем обновление веб-клиента",
        detail: "Проверяем Service Worker и свежую сборку перед установкой.",
        userDecision: "accepted",
        available: true,
        modal: "open",
      });
      try {
        await checkForPwaUpdate({ timeoutMs: PWA_MANUAL_CHECK_TIMEOUT_MS });
      } catch {
        // keep the manual prompt open; network/service-worker checks have their own fallback below
      }
    }
    try {
      flushBeforeReload();
    } catch {
      // ignore
    }
    setPwaUpdateRuntime("applying", {
      buildId,
      message: mode === "manual" ? "Применяем обновление веб-клиента" : "Готовим обновление веб-клиента",
      detail: "Активируем новую сборку. Окно нельзя закрыть случайной клавишей.",
      userDecision: mode === "manual" ? "accepted" : "pending",
      available: true,
      modal: "open",
    });
    let activated = false;
    try {
      activated = await activatePwaUpdate();
    } catch {
      // ignore
    }
    logPwaUpdate(mode === "manual" ? "manual_activate" : "auto_activate", `${buildId || "unknown"}#${activated ? "ok" : "no"}`);
    if (!activated) {
      setPwaUpdateRuntime("verifying", {
        buildId,
        message: "Проверяем загруженную сборку",
        detail: "Сравниваем версию Service Worker и файл с сайта.",
        available: true,
        modal: "open",
      });
      const hasController = typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller);
      const hasWaiting = hasPwaUpdate();
      let reg: ServiceWorkerRegistration | null = null;
      if (mode === "manual" && typeof navigator !== "undefined" && navigator.serviceWorker) {
        try {
          reg = (await navigator.serviceWorker.getRegistration()) ?? null;
        } catch {
          reg = null;
        }
      }
      const swBuildId = mode === "manual" ? await requestPwaBuildId(reg, 1200) : "";
      const netBuildId = mode === "manual" ? await fetchSwBuildId(PWA_MANUAL_CHECK_TIMEOUT_MS) : "";
      const confirmedBuildId = String(netBuildId || swBuildId || buildId || "").trim();
      const confirmedNeedsReload = confirmedBuildId ? shouldReloadForBuild(currentBuildId, confirmedBuildId) : false;
      const swConfirmsBuild = Boolean(swBuildId && confirmedBuildId && swBuildId === confirmedBuildId);
      const canReloadWithoutWaiting = hasNewBuild && !hasWaiting;
      const shouldForceLatestReload =
        mode === "manual" && !hasWaiting && !canReloadWithoutWaiting && hasController && buildIdSource === "latest" && updateLatest;
      if (shouldForceLatestReload) {
        logPwaUpdate("manual_force_latest", updateLatest);
        storeActiveBuildId(updateLatest);
        setPwaUpdateRuntime("verifying", {
          buildId: updateLatest,
          message: "Новая сборка подтверждена",
          detail: "Перезапускаем клиент с актуальной версией.",
          available: true,
        });
        forceUpdateReload("manual_latest_force");
        return;
      }
      if (mode === "manual" && !hasWaiting && confirmedNeedsReload && netBuildId && !swConfirmsBuild) {
        logPwaUpdate("manual_reset_stale_sw", `${swBuildId || "none"}->${netBuildId}`);
        setPwaUpdateRuntime("applying", {
          buildId: netBuildId,
          message: "Сбрасываем старый PWA кэш",
          detail: "Новая версия найдена, но старый Service Worker не отдаёт её. Очищаем кэш и перезапускаем.",
          available: true,
          modal: "open",
        });
        await resetPwaCachesAndServiceWorkers(`manual_stale_sw:${swBuildId || "none"}->${netBuildId}`);
        return;
      }
      if (mode === "manual" && !hasWaiting && confirmedNeedsReload && swConfirmsBuild) {
        const targetBuildId = confirmedBuildId || buildId;
        logPwaUpdate("manual_reload_confirmed_sw", targetBuildId);
        storeActiveBuildId(targetBuildId);
        setPwaUpdateRuntime("verifying", {
          buildId: targetBuildId,
          message: "Новая сборка готова",
          detail: "Перезапускаем веб-клиент и проверяем запуск.",
          available: true,
        });
        navigateForUpdateReload("manual_confirmed_sw");
        return;
      }
      if (mode === "manual" && !hasWaiting && hasNewBuild && !netBuildId && !swConfirmsBuild) {
        setPwaUpdateRuntime("error", {
          buildId,
          message: "Не удалось проверить загрузку обновления",
          detail: "Оставьте приложение открытым и повторите попытку через несколько секунд.",
          error: "unconfirmed_update",
          available: true,
          modal: "open",
        });
        logPwaUpdate("manual_unconfirmed_update", buildId || "unknown");
        return;
      }
      if (mode === "manual" && !hasWaiting && !canReloadWithoutWaiting) {
        const msg = hasController
          ? "Обновление ещё не загружено. Оставьте приложение открытым и повторите попытку через несколько секунд."
          : "PWA обновление ещё не готово: Service Worker запускается. Повторите обновление через несколько секунд.";
        setPwaUpdateRuntime("available", {
          buildId,
          message: "Обновление ещё готовится",
          detail: msg,
          available: Boolean(updateLatest || pwaPendingBuildId),
          modal: "open",
        });
        logPwaUpdate("manual_no_update", buildId || "unknown");
        return;
      }
      if (canReloadWithoutWaiting) {
        logPwaUpdate(mode === "manual" ? "manual_reload_active" : "auto_reload_active", buildId || "unknown");
        if (mode === "manual" && netBuildId && !swConfirmsBuild) {
          logPwaUpdate("manual_reload_active_reset", `${swBuildId || "none"}->${netBuildId}`);
          setPwaUpdateRuntime("applying", {
            buildId: netBuildId,
            message: "Очищаем старый PWA кэш",
            detail: "Обновление требует очистки старого кэша. После этого клиент перезапустится.",
            available: true,
            modal: "open",
          });
          await resetPwaCachesAndServiceWorkers(`manual_reload_active_reset:${swBuildId || "none"}->${netBuildId}`);
          return;
        }
        storeActiveBuildId(buildId);
        setPwaUpdateRuntime("verifying", {
          buildId,
          message: "Новая сборка готова",
          detail: "Перезапускаем веб-клиент и проверяем запуск.",
          available: true,
        });
        if (mode === "manual" && (buildIdSource === "latest" || buildIdSource === "opts")) {
          forceUpdateReload(buildIdSource === "latest" ? "manual_latest" : "manual_opts");
          return;
        }
        try {
          navigateForUpdateReload(mode === "manual" ? "manual_active" : "auto_active");
          return;
        } catch {
          // ignore
        }
        forceUpdateReload(mode === "manual" ? "manual_active_fallback" : "auto_active_fallback");
        return;
      }
      if (mode === "manual" && hasWaiting && confirmedNeedsReload && netBuildId) {
        logPwaUpdate("manual_reset_waiting_sw", `${swBuildId || "waiting"}->${netBuildId}`);
        setPwaUpdateRuntime("applying", {
          buildId: netBuildId,
          message: "Сбрасываем зависшее PWA обновление",
          detail: "Новая сборка подтверждена, но браузер не активировал Service Worker. Очищаем старый PWA кэш и перезапускаем.",
          available: true,
          modal: "open",
        });
        await resetPwaCachesAndServiceWorkers(`manual_waiting_sw:${swBuildId || "waiting"}->${netBuildId}`);
        return;
      }
      const msg =
        mode === "manual"
          ? "Не удалось применить обновление. Закройте другие вкладки и попробуйте ещё раз."
          : "Обновление ожидает применения. Повторим попытку автоматически.";
      setPwaUpdateRuntime(mode === "manual" ? "error" : "available", {
        buildId,
        message: mode === "manual" ? "Не удалось применить обновление" : "Обновление ожидает применения",
        detail: msg,
        error: mode === "manual" ? "activate_wait" : null,
        available: true,
        modal: "open",
      });
      logPwaUpdate(mode === "manual" ? "manual_wait" : "auto_wait", buildId || "unknown");
      if (mode === "auto") {
        scheduleAutoApplyPwaUpdate(PWA_AUTO_APPLY_RETRY_MS);
      }
      return;
    }
    storeActiveBuildId(buildId);
    // iOS/WebKit may occasionally produce a blank screen on `reload()` after a SW update.
    // Cache-busted location.replace() behaves more like a fresh navigation and is generally more reliable.
    logPwaUpdate(mode === "manual" ? "manual_reload" : "auto_reload", buildId || "unknown");
    setPwaUpdateRuntime("verifying", {
      buildId,
      message: "Обновление установлено",
      detail: "Перезапускаем веб-клиент с новой сборкой.",
      available: true,
    });
    navigateForUpdateReload(mode === "manual" ? "manual" : "auto");
  }

  function deferPwaUpdate() {
    if (pwaAutoApplyTimer !== null) {
      try {
        window.clearTimeout(pwaAutoApplyTimer);
      } catch {
        // ignore
      }
      pwaAutoApplyTimer = null;
    }
    const st = store.get();
    const buildId = String(st.updateLatest || (st as any).pwaUpdate?.buildId || pwaPendingBuildId || "").trim();
    logPwaUpdate("manual_defer", buildId || "unknown");
    store.set((prev) => {
      const id = String(prev.updateLatest || (prev as any).pwaUpdate?.buildId || buildId || "").trim();
      return {
        ...prev,
        status: PWA_DEFERRED_STATUS,
        pwaUpdateAvailable: Boolean(prev.pwaUpdateAvailable || id),
        pwaUpdate: mergePwaUpdateState((prev as any).pwaUpdate, "available", {
          buildId: id || null,
          message: "Обновление отложено",
          detail: "Обновление отложено до перезапуска. Можно обновить вручную позже.",
          userDecision: "later",
          error: null,
        }),
        ...(id && !prev.updateLatest ? { updateLatest: id } : {}),
        ...(prev.modal?.kind === "pwa_update" ? { modal: null } : {}),
      };
    });
  }

  async function forcePwaUpdate() {
    if (pwaForceInFlight) {
      setPwaUpdateRuntime("checking", {
        buildId: String(store.get().updateLatest ?? "").trim() || null,
        message: "Проверка обновления уже выполняется",
        detail: "Если статус не изменится в течение нескольких секунд, повторите проверку. Зависшая операция будет автоматически разблокирована.",
        userDecision: "accepted",
        available: true,
        modal: "open",
      });
      return;
    }
    if (!isServiceWorkerRuntimeAvailable()) {
      setPwaUpdateRuntime("error", {
        message: "PWA обновление недоступно",
        detail: "Этот браузер не поддерживает Service Worker для веб-клиента.",
        error: "sw_unavailable",
        available: false,
      });
      return;
    }
    pwaForceInFlight = true;
    let watchdogTimedOut = false;
    let watchdogTimer: number | null = null;
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      watchdogTimer = window.setTimeout(() => {
        if (!pwaForceInFlight) return;
        watchdogTimedOut = true;
        pwaForceInFlight = false;
        logPwaUpdate("manual_force_watchdog_timeout", String(store.get().updateLatest || "unknown"));
        setPwaUpdateRuntime("error", {
          buildId: String(store.get().updateLatest ?? "").trim() || null,
          message: "Проверка обновления зависла",
          detail: "Service Worker или кэш браузера не ответил вовремя. Повторите проверку: клиент разблокировал процесс и выполнит безопасную проверку заново.",
          error: "manual_force_watchdog_timeout",
          available: true,
          modal: "open",
        });
      }, PWA_FORCE_WATCHDOG_MS);
    }
    setPwaUpdateRuntime("checking", {
      buildId: String(store.get().updateLatest ?? "").trim() || null,
      message: "Проверяем обновление PWA",
      detail: "Запрошена ручная проверка новой сборки и Service Worker.",
      userDecision: "accepted",
      available: true,
      modal: "open",
    });
    try {
      let reg: ServiceWorkerRegistration | null = null;
      try {
        reg = (await withTimeout(navigator.serviceWorker.getRegistration(), 1500, null)) ?? null;
      } catch {
        reg = null;
      }
      if (!reg) {
        reg = await waitForServiceWorkerReady(1200);
      }
      if (!reg) {
        try {
          reg = await withTimeout(navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }), PWA_MANUAL_CHECK_TIMEOUT_MS, null);
        } catch {
          reg = null;
        }
        if (!reg) {
          setPwaUpdateRuntime("error", {
            message: "Service Worker не зарегистрирован",
            detail: "Перезапустите приложение и повторите обновление.",
            error: "sw_register_failed",
            available: true,
            modal: "open",
          });
          return;
        }
      }
      try {
        await checkForPwaUpdate({ timeoutMs: PWA_MANUAL_CHECK_TIMEOUT_MS });
      } catch {
        // ignore
      }
      const swBuildId = await requestPwaBuildId(reg);
      const netBuildId = await fetchSwBuildId();
      let buildId = swBuildId || netBuildId;
      const latest = String(store.get().updateLatest ?? "").trim();
      const currentBuildId = currentClientBuildId();
      const latestNeedsReload = latest ? shouldReloadForBuild(currentBuildId, latest) : false;
      const netNeedsReload = netBuildId ? shouldReloadForBuild(currentBuildId, netBuildId) : false;
      if ((latestNeedsReload || netNeedsReload) && netBuildId && (!swBuildId || shouldReloadForBuild(swBuildId, netBuildId))) {
        setPwaUpdateRuntime("applying", {
          buildId: netBuildId,
          message: "Сбрасываем старый PWA кэш",
          detail: "Найдена новая сборка, но Service Worker не обновляется. Очищаем кэш и перезапускаем.",
          available: true,
          modal: "open",
        });
        await resetPwaCachesAndServiceWorkers(`stuck:${swBuildId || "none"}->${netBuildId}`);
        return;
      }
      let buildNeedsReload = buildId ? shouldReloadForBuild(currentBuildId, buildId) : false;
      if (latestNeedsReload && !buildNeedsReload) {
        buildId = latest;
        buildNeedsReload = true;
      }
      await applyPwaUpdateNow({ mode: "manual", ...(buildId ? { buildId } : {}) });
      if (!buildNeedsReload && !latestNeedsReload) {
        logPwaUpdate("manual_force_reload", buildId || latest || "unknown");
        setPwaUpdateRuntime("verifying", {
          buildId: buildId || latest || null,
          message: "Перезапускаем клиент",
          detail: "Принудительная перезагрузка нужна для проверки текущей сборки.",
          available: true,
        });
        forceUpdateReload("manual_force");
      }
    } finally {
      if (watchdogTimer !== null) {
        try {
          window.clearTimeout(watchdogTimer);
        } catch {
          // ignore
        }
      }
      if (!watchdogTimedOut) pwaForceInFlight = false;
    }
  }

  async function reconcilePwaBootState(): Promise<void> {
    if (pwaBootReconcileStarted) return;
    pwaBootReconcileStarted = true;
    if (!isServiceWorkerRuntimeAvailable()) return;
    let reg: ServiceWorkerRegistration | null = null;
    try {
      reg = (await navigator.serviceWorker.getRegistration()) ?? null;
    } catch {
      reg = null;
    }
    if (!reg) {
      reg = await waitForServiceWorkerReady(1200);
    }
    const currentBuildId = currentClientBuildId();
    const pendingBuildId = readPendingPwaBuild(currentBuildId);
    const swBuildId = await requestPwaBuildId(reg, 1200);
    const netBuildId = await fetchSwBuildId();
    const liveBuildId = String(netBuildId || swBuildId || pendingBuildId || "").trim();
    if (!liveBuildId) return;
    const startupPendingOnly = Boolean(pendingBuildId && pendingBuildId === liveBuildId && !netBuildId && !swBuildId);
    const liveNeedsReload = shouldReloadForBuild(currentBuildId, liveBuildId);
    if (!liveNeedsReload) {
      adoptActiveBuild(liveBuildId);
      store.set((prev) =>
        prev.pwaUpdateAvailable
          ? { ...prev, pwaUpdateAvailable: false, pwaUpdate: createPwaUpdateState() }
          : { ...prev, pwaUpdate: createPwaUpdateState() }
      );
      clearPwaAutoApplyGuard();
      clearPendingPwaBuild(liveBuildId);
      return;
    }
    setPendingPwaBuild(liveBuildId, "Получено обновление веб-клиента. Можно обновить сейчас или позже.");
    if (!swBuildId || swBuildId !== liveBuildId) {
      logPwaUpdate("bootstrap_reconcile_stale", `${swBuildId || "none"}->${liveBuildId}`);
      if (startupPendingOnly) {
        logPwaUpdate("bootstrap_pending_prompt", liveBuildId);
        return;
      }
      scheduleAutoApplyPwaUpdate(PWA_AUTO_APPLY_RETRY_MS);
      return;
    }
    logPwaUpdate("bootstrap_reconcile_pending", liveBuildId);
    scheduleAutoApplyPwaUpdate(1200);
  }

  function startPwaBootReconcile(): Promise<void> {
    if (!pwaBootReconcilePromise) {
      pwaBootReconcilePromise = reconcilePwaBootState().catch((err) => {
        logPwaUpdate("bootstrap_reconcile_error", String(err || "unknown"));
      });
    }
    return pwaBootReconcilePromise;
  }

  async function whenClientReadyForConnection(): Promise<ClientUpdateConnectionReadiness> {
    await startPwaBootReconcile();
    return getClientUpdateConnectionReadiness("boot_reconciled");
  }

  function isSafeToAutoApplyUpdate(st: AppState): boolean {
    if (typeof document === "undefined") return false;
    if (getPwaStabilityHoldRemainingMs() > 0) return false;
    const hasActiveTransfer = hasActiveFileTransferEntries(st.fileTransfers || []);
    if (hasActiveTransfer) return false;
    if (hasPwaReloadBlockers()) return false;
    if (hasPendingFileActivityForUpdate()) return false;
    if (Object.values(st.historyLoading || {}).some(Boolean)) return false;
    if (hasPendingHistoryActivityForUpdate()) return false;
    if (hasPendingPreviewActivityForUpdate()) return false;
    if (st.modal) return false;
    const now = Date.now();
    const idleFor = Math.max(0, now - (getLastUserInputAt() || 0));
    // Не перезапускаем приложение, пока пользователь находится в поле ввода (особенно на iOS).
    // Исключение: пустой композер без активного редактирования/ответа.
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae.isContentEditable)) {
      const isComposer = ae.getAttribute("data-ios-assistant") === "composer";
      if (!isComposer) return false;
      if (st.editing || st.replyDraft || st.forwardDraft || st.chatSelection) return false;
      const value = ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement ? ae.value : String(ae.textContent || "");
      if (value.trim()) {
        // Desktop PWA: черновики сохраняем перед перезапуском, поэтому можно применить обновление после паузы.
        if (isIOS() || !isStandaloneDisplayMode()) return false;
        if (idleFor < 12_000) return false;
      }
    }
    // Не дёргаем PWA/веб обновление, когда вкладка неактивна: на мобилках это часто даёт "чёрный экран" при возврате.
    if (document.visibilityState !== "visible") return false;
    // Даем пользователю чуть "тишины", чтобы не перезагружать в момент активного ввода/кликов.
    if (idleFor < 3_000) return false;
    return true;
  }

  function shouldDisableAutoApplyUpdate(): boolean {
    return isIOS() || isStandaloneDisplayMode();
  }

  function scheduleAutoApplyPwaUpdate(delayMs = 800) {
    if (pwaAutoApplyTimer !== null) {
      try {
        window.clearTimeout(pwaAutoApplyTimer);
      } catch {
        // ignore
      }
      pwaAutoApplyTimer = null;
    }
    const buildId = pwaPendingBuildId || String(store.get().updateLatest || "").trim();
    logPwaUpdate("manual_prompt_only", `${buildId || "unknown"}:${Math.max(0, delayMs || 0)}`);
    clearPwaAutoApplyGuard();
    store.set((prev) => {
      if (!prev.pwaUpdateAvailable) return prev;
      const runtime = (prev as any).pwaUpdate;
      if ((prev as any).pwaUpdate?.userDecision === "later") {
        const id = String(prev.updateLatest || runtime?.buildId || buildId || "").trim();
        if (prev.status === PWA_DEFERRED_STATUS && prev.modal?.kind !== "pwa_update") return prev;
        return {
          ...prev,
          status: PWA_DEFERRED_STATUS,
          pwaUpdate: mergePwaUpdateState(runtime, "available", {
            buildId: id || null,
            message: "Обновление отложено",
            detail: "Обновление отложено до перезапуска. Можно обновить вручную позже.",
            userDecision: "later",
            error: null,
          }),
          ...(prev.modal?.kind === "pwa_update" ? { modal: null } : {}),
        };
      }
      const id = String(buildId || prev.updateLatest || "").trim();
      const shouldOpenPrompt = shouldOpenPwaUpdatePrompt(prev);
      const alreadyManualPrompt =
        prev.status === PWA_AUTO_APPLY_STATUS &&
        runtime?.stage === "available" &&
        runtime?.userDecision === "pending" &&
        String(runtime?.buildId || "").trim() === id &&
        (prev.modal?.kind === "pwa_update" || !shouldOpenPrompt);
      if (alreadyManualPrompt) return prev;
      return {
        ...prev,
        status: PWA_AUTO_APPLY_STATUS,
        pwaUpdate: mergePwaUpdateState(runtime, "available", {
          buildId: id || null,
          message: "Получено обновление веб-клиента",
          detail: PWA_MANUAL_PROMPT_DETAIL,
          userDecision: "pending",
          error: null,
        }),
        ...(shouldOpenPrompt ? { modal: { kind: "pwa_update" as const } } : {}),
      };
    });
  }

  function showManualPwaUpdatePromptForHold() {
    if (pwaAutoApplyTimer !== null) {
      try {
        window.clearTimeout(pwaAutoApplyTimer);
      } catch {
        // ignore
      }
      pwaAutoApplyTimer = null;
    }
    if (!store.get().pwaUpdateAvailable) return;
    store.set((prev) => ({
      ...prev,
      status: PWA_AUTO_APPLY_STATUS,
      pwaUpdate: mergePwaUpdateState((prev as any).pwaUpdate, "available", {
        buildId: String(prev.updateLatest || pwaPendingBuildId || "").trim() || null,
        message: "Получено обновление веб-клиента",
        detail: "Откройте обновление вручную после завершения активных действий.",
        userDecision: "pending",
        error: null,
      }),
      ...(shouldOpenPwaUpdatePrompt(prev) ? { modal: { kind: "pwa_update" as const } } : {}),
    }));
  }

  function maybeRestorePendingPwaUpdatePrompt(reason: string) {
    const st = store.get();
    if (!st.pwaUpdateAvailable) return;
    if (st.modal?.kind === "pwa_update") return;
    if (!shouldOpenPwaUpdatePrompt(st)) return;
    const runtime = (st as any).pwaUpdate;
    if (runtime?.userDecision === "later") return;
    const buildId = String(st.updateLatest || runtime?.buildId || pwaPendingBuildId || "").trim();
    if (!buildId || !shouldReloadForBuild(currentClientBuildId(), buildId)) return;
    logPwaUpdate("restore_prompt", `${reason}:${buildId}`);
    scheduleAutoApplyPwaUpdate(0);
  }

  function scheduleForegroundBuildCheck(delayMs: number, reason = "timer") {
    if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
    const delay = Math.max(0, Math.trunc(Number(delayMs) || 0));
    const dueAt = Date.now() + delay;
    if (foregroundBuildCheckTimer !== null && foregroundBuildCheckDueAt <= dueAt) return;
    if (foregroundBuildCheckTimer !== null) {
      try {
        window.clearTimeout(foregroundBuildCheckTimer);
      } catch {
        // ignore
      }
      foregroundBuildCheckTimer = null;
    }
    foregroundBuildCheckDueAt = dueAt;
    foregroundBuildCheckTimer = window.setTimeout(() => {
      foregroundBuildCheckTimer = null;
      foregroundBuildCheckDueAt = 0;
      void runForegroundBuildCheck(reason);
    }, delay);
  }

  async function runForegroundBuildCheck(reason = "timer"): Promise<void> {
    if (!isServiceWorkerRuntimeAvailable()) return;
    if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") {
      scheduleForegroundBuildCheck(PWA_FOREGROUND_CHECK_INTERVAL_MS, "hidden");
      return;
    }
    const idleFor = Math.max(0, Date.now() - (getLastUserInputAt() || 0));
    if (idleFor < PWA_FOREGROUND_IDLE_GRACE_MS) {
      scheduleForegroundBuildCheck(PWA_FOREGROUND_IDLE_GRACE_MS - idleFor + 250, "user_active");
      return;
    }
    const sinceLast = Date.now() - lastForegroundBuildCheckAt;
    if (lastForegroundBuildCheckAt > 0 && sinceLast < PWA_FOREGROUND_CHECK_INTERVAL_MS && reason !== "focus" && reason !== "pageshow") {
      scheduleForegroundBuildCheck(PWA_FOREGROUND_CHECK_INTERVAL_MS - sinceLast, "throttle");
      return;
    }
    if (foregroundBuildCheckInFlight) {
      scheduleForegroundBuildCheck(5_000, "in_flight");
      return;
    }
    foregroundBuildCheckInFlight = true;
    lastForegroundBuildCheckAt = Date.now();
    try {
      const currentBuildId = currentClientBuildId();
      const liveBuildId = await fetchSwBuildId(PWA_FOREGROUND_CHECK_TIMEOUT_MS);
      if (liveBuildId && shouldReloadForBuild(currentBuildId, liveBuildId)) {
        setPendingPwaBuild(liveBuildId, "Получено обновление веб-клиента. Можно обновить сейчас или отложить.");
        scheduleAutoApplyPwaUpdate(0);
        try {
          await checkForPwaUpdate({ timeoutMs: PWA_FOREGROUND_CHECK_TIMEOUT_MS });
        } catch {
          // Prompt already uses live sw.js; Service Worker update can retry later.
        }
        return;
      }
      if (liveBuildId) {
        const st = store.get();
        const knownBuildId = String(st.updateLatest || (st as any).pwaUpdate?.buildId || pwaPendingBuildId || "").trim();
        if (!knownBuildId || !shouldReloadForBuild(currentBuildId, knownBuildId)) {
          adoptActiveBuild(liveBuildId);
          clearCurrentPwaUpdatePrompt(liveBuildId);
        }
      }
    } finally {
      foregroundBuildCheckInFlight = false;
      scheduleForegroundBuildCheck(PWA_FOREGROUND_CHECK_INTERVAL_MS, "loop");
    }
  }

  function startForegroundBuildMonitor() {
    if (
      typeof document === "undefined" ||
      typeof document.addEventListener !== "function" ||
      typeof document.removeEventListener !== "function" ||
      typeof window === "undefined" ||
      typeof window.addEventListener !== "function" ||
      typeof window.removeEventListener !== "function"
    ) {
      return () => {};
    }
    scheduleForegroundBuildCheck(PWA_FOREGROUND_STARTUP_DELAY_MS, "startup");
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleForegroundBuildCheck(700, "visible");
    };
    const onFocus = () => scheduleForegroundBuildCheck(700, "focus");
    const onPageShow = () => scheduleForegroundBuildCheck(900, "pageshow");
    const onOnline = () => scheduleForegroundBuildCheck(1200, "online");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }

  const onPwaBuild = (ev: Event) => {
    const detail = (ev as CustomEvent<any>).detail;
    const buildId = String(detail?.buildId ?? "").trim();
    if (!buildId) return;
    const hasController = typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller);
    const hasWaiting = hasPwaUpdate();
    const needReload = shouldReloadForBuild(currentClientBuildId(), buildId);
    logPwaUpdate("build", `${buildId}${needReload ? "" : " ok"}`);
    if (needReload) {
      setPendingPwaBuild(buildId);
      scheduleAutoApplyPwaUpdate();
      return;
    }
    clearPwaAutoApplyGuard();
    if (hasController && !hasWaiting) {
      adoptActiveBuild(buildId);
      store.set((prev) =>
        prev.pwaUpdateAvailable
          ? { ...prev, pwaUpdateAvailable: false, pwaUpdate: createPwaUpdateState() }
          : { ...prev, pwaUpdate: createPwaUpdateState() }
      );
      return;
    }
    adoptActiveBuild(buildId);
  };

  const onPwaSwError = (ev: Event) => {
    const detail = (ev as CustomEvent<any>).detail;
    const err = String(detail?.error ?? "").trim();
    if (!err) return;
    const msg = `Service Worker: ${err}`;
    store.set((prev) => ({
      ...prev,
      pwaPushStatus: msg,
      status: msg,
      pwaUpdate: mergePwaUpdateState((prev as any).pwaUpdate, "error", {
        message: "Ошибка Service Worker",
        detail: msg,
        error: err,
      }),
    }));
  };

  const onPwaUpdate = () => {
    logPwaUpdate("sw_update");
    void verifyPwaUpdateEvent();
  };

  async function verifyPwaUpdateEvent(): Promise<void> {
    if (pwaUpdateEventVerifyInFlight) return;
    pwaUpdateEventVerifyInFlight = true;
    try {
      const currentBuildId = currentClientBuildId();
      const knownBuildId = String(pwaPendingBuildId || readPendingPwaBuild(currentBuildId) || store.get().updateLatest || "").trim();
      if (knownBuildId && shouldReloadForBuild(currentBuildId, knownBuildId)) {
        setPendingPwaBuild(knownBuildId, "Получено обновление веб-клиента. Нажмите «Обновить», когда будет удобно.");
        scheduleAutoApplyPwaUpdate();
        return;
      }
      const liveBuildId = await fetchSwBuildId(PWA_MANUAL_CHECK_TIMEOUT_MS);
      if (!liveBuildId) {
        logPwaUpdate("sw_update_unverified", currentBuildId || "unknown");
        return;
      }
      if (shouldReloadForBuild(currentBuildId, liveBuildId)) {
        setPendingPwaBuild(liveBuildId, "Получено обновление веб-клиента. Нажмите «Обновить», когда будет удобно.");
        scheduleAutoApplyPwaUpdate();
        return;
      }
      logPwaUpdate("sw_update_current", liveBuildId);
      adoptActiveBuild(liveBuildId);
      clearCurrentPwaUpdatePrompt(liveBuildId);
    } finally {
      pwaUpdateEventVerifyInFlight = false;
    }
  }

  const onPwaStabilityHold = () => {
    const remaining = getPwaStabilityHoldRemainingMs();
    if (remaining <= 0) return;
    if (!store.get().pwaUpdateAvailable) return;
    showManualPwaUpdatePromptForHold();
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    window.addEventListener("yagodka:pwa-build", onPwaBuild);
    window.addEventListener("yagodka:pwa-sw-error", onPwaSwError);
    window.addEventListener("yagodka:pwa-update", onPwaUpdate);
    window.addEventListener("yagodka:pwa-stability-hold", onPwaStabilityHold);
    const disposeForegroundBuildMonitor = startForegroundBuildMonitor();
    const subscribe = (store as any).subscribe;
    storeUnsubscribe =
      typeof subscribe === "function"
        ? subscribe.call(store, () => maybeRestorePendingPwaUpdatePrompt("store"))
        : null;
    const prevDispose = storeUnsubscribe;
    storeUnsubscribe = () => {
      disposeForegroundBuildMonitor();
      if (prevDispose) prevDispose();
    };
    void startPwaBootReconcile();
  }

  function dispose() {
    if (!listenersInstalled) return;
    listenersInstalled = false;
    try {
      window.removeEventListener("yagodka:pwa-build", onPwaBuild);
      window.removeEventListener("yagodka:pwa-sw-error", onPwaSwError);
      window.removeEventListener("yagodka:pwa-update", onPwaUpdate);
      window.removeEventListener("yagodka:pwa-stability-hold", onPwaStabilityHold);
    } catch {
      // ignore
    }
    if (storeUnsubscribe) {
      try {
        storeUnsubscribe();
      } catch {
        // ignore
      }
      storeUnsubscribe = null;
    }
    if (pwaAutoApplyTimer !== null) {
      try {
        window.clearTimeout(pwaAutoApplyTimer);
      } catch {
        // ignore
      }
      pwaAutoApplyTimer = null;
    }
    if (foregroundBuildCheckTimer !== null) {
      try {
        window.clearTimeout(foregroundBuildCheckTimer);
      } catch {
        // ignore
      }
      foregroundBuildCheckTimer = null;
      foregroundBuildCheckDueAt = 0;
    }
  }

  return {
    installEventListeners,
    dispose,
    applyPwaUpdateNow,
    deferPwaUpdate,
    forceUpdateReload,
    forcePwaUpdate,
    scheduleAutoApplyPwaUpdate,
    whenClientReadyForConnection,
  };
}
