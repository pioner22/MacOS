import { APP_VERSION } from "../../config/app";
import { loadActiveBuildId, storeActiveBuildId } from "../../helpers/pwa/buildIdStore";
import { writePendingPwaBuild } from "../../helpers/pwa/pendingUpdate";
import { splitBuildId } from "../../helpers/version/buildId";

export interface RequiredUpdateGateResult {
  blocked: boolean;
  liveBuildId: string;
  reason: "current" | "no_live_build" | "fetch_failed" | "update_required" | "reload_failed";
}

interface UpdateGateGuard {
  buildId: string;
  tries: number;
  ts: number;
}

const UPDATE_GATE_GUARD_KEY = "yagodka_required_update_gate_v1";
const UPDATE_GATE_BYPASS_KEY = "yagodka_required_update_gate_bypass_v1";
const UPDATE_GATE_RELOADING_KEY = "yagodka_required_update_gate_reloading_v1";
const UPDATE_GATE_MAX_DIRECT_RELOADS = 2;
const UPDATE_GATE_MAX_CACHE_RESET_RELOADS = 1;
const UPDATE_GATE_MAX_TOTAL_RELOADS = UPDATE_GATE_MAX_DIRECT_RELOADS + UPDATE_GATE_MAX_CACHE_RESET_RELOADS;
const UPDATE_GATE_GUARD_TTL_MS = 10 * 60 * 1000;
const UPDATE_GATE_BYPASS_TTL_MS = 10 * 60 * 1000;
const UPDATE_GATE_FETCH_TIMEOUT_MS = 2500;
const UPDATE_GATE_CONTINUE_DELAY_MS = 900;
const UPDATE_GATE_SW_TIMEOUT_MS = 3500;
const UPDATE_GATE_MIN_STEP_MS = 420;
const UPDATE_GATE_STEPS = [
  { id: "version", label: "Проверяем версию" },
  { id: "activate", label: "Готовим обновление" },
  { id: "cache", label: "Очищаем кэш" },
  { id: "reload", label: "Перезапускаем" },
  { id: "ready", label: "Запускаем приложение" },
] as const;

type UpdateGateStepId = (typeof UPDATE_GATE_STEPS)[number]["id"];
type UpdateGateMode = "running" | "success" | "warning" | "failed";

interface UpdateGateAction {
  label: string;
  kind?: "primary" | "secondary";
  run: () => void;
}

interface UpdateGateStatus {
  title: string;
  detail: string;
  activeStep: UpdateGateStepId;
  progress: number;
  mode?: UpdateGateMode;
  errorStep?: UpdateGateStepId;
  actions?: UpdateGateAction[];
}

export function parseBuildIdFromServiceWorker(text: unknown): string {
  const raw = String(text ?? "");
  const match = raw.match(/\bBUILD_ID\s*=\s*["']([^"']+)["']/);
  return String(match?.[1] ?? "").trim();
}

export function isRequiredUpdateNeeded(currentBuildId: unknown, liveBuildId: unknown): boolean {
  const current = splitBuildId(currentBuildId);
  const live = splitBuildId(liveBuildId);
  if (!current.version || !live.version) return false;
  if (current.version !== live.version) return true;
  if (current.build && live.build && current.build !== live.build) return true;
  return false;
}

function storage(kind: "session" | "local"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readGuard(): UpdateGateGuard | null {
  const raw = (() => {
    try {
      return storage("session")?.getItem(UPDATE_GATE_GUARD_KEY) || storage("local")?.getItem(UPDATE_GATE_GUARD_KEY) || "";
    } catch {
      return "";
    }
  })();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const buildId = String((parsed as any).buildId || "").trim();
    const tries = Number((parsed as any).tries || 0);
    const ts = Number((parsed as any).ts || 0);
    if (!buildId || !Number.isFinite(tries) || !Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > UPDATE_GATE_GUARD_TTL_MS) return null;
    return { buildId, tries: Math.max(0, Math.trunc(tries)), ts: Math.trunc(ts) };
  } catch {
    return null;
  }
}

function writeGuard(guard: UpdateGateGuard | null): void {
  const raw = guard ? JSON.stringify(guard) : "";
  for (const target of [storage("session"), storage("local")]) {
    try {
      if (!target) continue;
      if (raw) target.setItem(UPDATE_GATE_GUARD_KEY, raw);
      else target.removeItem(UPDATE_GATE_GUARD_KEY);
    } catch {
      // ignore
    }
  }
}

function markAttempt(buildId: string): UpdateGateGuard {
  const now = Date.now();
  const prev = readGuard();
  const guard =
    prev && prev.buildId === buildId
      ? { buildId, tries: Math.min(prev.tries + 1, 9), ts: now }
      : { buildId, tries: 1, ts: now };
  writeGuard(guard);
  return guard;
}

function clearGuard(): void {
  writeGuard(null);
  try {
    storage("session")?.removeItem(UPDATE_GATE_RELOADING_KEY);
    storage("session")?.removeItem("yagodka_updating");
  } catch {
    // ignore
  }
}

function readBypass(liveBuildId: string): boolean {
  const raw = (() => {
    try {
      return storage("session")?.getItem(UPDATE_GATE_BYPASS_KEY) || "";
    } catch {
      return "";
    }
  })();
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const buildId = String((parsed as any).buildId || "").trim();
    const ts = Number((parsed as any).ts || 0);
    if (!buildId || buildId !== liveBuildId || !Number.isFinite(ts) || ts <= 0) return false;
    return Date.now() - ts <= UPDATE_GATE_BYPASS_TTL_MS;
  } catch {
    return false;
  }
}

function writeBypass(liveBuildId: string): void {
  try {
    storage("session")?.setItem(UPDATE_GATE_BYPASS_KEY, JSON.stringify({ buildId: liveBuildId, ts: Date.now() }));
  } catch {
    // ignore
  }
}

function clearBypass(): void {
  try {
    storage("session")?.removeItem(UPDATE_GATE_BYPASS_KEY);
  } catch {
    // ignore
  }
}

function cleanupUpdateQueryParams(): void {
  try {
    const url = new URL(window.location.href);
    const before = url.toString();
    url.searchParams.delete("__yg_update");
    url.searchParams.delete("__pwa_reset");
    url.searchParams.delete("__yg_continue");
    if (url.toString() === before) return;
    window.history?.replaceState?.(window.history.state, document.title, url.toString());
  } catch {
    // ignore
  }
}

function activeBuildIdForGate(): string {
  try {
    return loadActiveBuildId(APP_VERSION);
  } catch {
    // ignore
  }
  return APP_VERSION;
}

function stepStatus(stepId: UpdateGateStepId, activeStep: UpdateGateStepId, errorStep?: UpdateGateStepId): string {
  if (errorStep && stepId === errorStep) return "error";
  const stepIndex = UPDATE_GATE_STEPS.findIndex((step) => step.id === stepId);
  const activeIndex = UPDATE_GATE_STEPS.findIndex((step) => step.id === activeStep);
  if (stepIndex < activeIndex) return "done";
  if (stepIndex === activeIndex) return "active";
  return "pending";
}

function setGateStatus(root: HTMLElement, status: UpdateGateStatus): void {
  try {
    try {
      document.documentElement.classList.add("required-update-active");
      document.body?.classList?.add("required-update-active");
    } catch {
      // ignore
    }
    root.replaceChildren();
    const shell = document.createElement("main");
    shell.className = `required-update-gate required-update-gate--${status.mode || "running"}`;
    shell.setAttribute("role", "status");
    shell.setAttribute("aria-live", "polite");

    const spinner = document.createElement("div");
    spinner.className = "required-update-gate__spinner";
    spinner.setAttribute("aria-hidden", "true");

    const h = document.createElement("h1");
    h.className = "required-update-gate__title";
    h.textContent = status.title;

    const p = document.createElement("p");
    p.className = "required-update-gate__text";
    p.textContent = status.detail;

    const taskbar = document.createElement("div");
    taskbar.className = "required-update-gate__taskbar";
    taskbar.setAttribute("aria-hidden", "true");
    const track = document.createElement("div");
    track.className = "required-update-gate__track";
    const fill = document.createElement("div");
    fill.className = "required-update-gate__fill";
    const fillWidth = `${Math.max(4, Math.min(100, Math.round(status.progress)))}%`;
    try {
      fill.style.width = fillWidth;
    } catch {
      fill.setAttribute("style", `width: ${fillWidth}`);
    }
    track.append(fill);
    taskbar.append(track);

    const steps = document.createElement("ol");
    steps.className = "required-update-gate__steps";
    for (const step of UPDATE_GATE_STEPS) {
      const item = document.createElement("li");
      const state = stepStatus(step.id, status.activeStep, status.errorStep);
      item.className = `required-update-gate__step required-update-gate__step--${state}`;
      item.textContent = step.label;
      steps.append(item);
    }

    shell.append(spinner, h, p, taskbar, steps);
    if (status.actions?.length) {
      const actions = document.createElement("div");
      actions.className = "required-update-gate__actions";
      for (const action of status.actions) {
        const button = document.createElement("button");
        const kind = action.kind || "secondary";
        button.className = `btn ${kind === "primary" ? "primary" : ""} required-update-gate__btn required-update-gate__btn--${kind}`;
        button.type = "button";
        button.textContent = action.label;
        button.addEventListener("click", action.run);
        actions.append(button);
      }
      shell.append(actions);
    }
    root.append(shell);
  } catch {
    try {
      root.textContent = `${status.title}. ${status.detail}`;
    } catch {
      // ignore
    }
  }
}

function clearGateRoot(root: HTMLElement): void {
  try {
    try {
      document.documentElement.classList.remove("required-update-active");
      document.body?.classList?.remove("required-update-active");
    } catch {
      // ignore
    }
    root.replaceChildren();
  } catch {
    // ignore
  }
}

function reloadCleanWithParam(paramName: string): boolean {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("__yg_update");
    url.searchParams.delete("__pwa_reset");
    url.searchParams.delete("__yg_continue");
    url.searchParams.set(paramName, String(Date.now()));
    window.location.replace(url.toString());
    return true;
  } catch {
    // ignore
  }
  try {
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

function continueWithCurrentBundle(liveBuildId: string): void {
  writeBypass(liveBuildId);
  clearGuard();
  reloadCleanWithParam("__yg_continue");
}

function retryRequiredUpdate(root: HTMLElement): void {
  writeGuard(null);
  clearBypass();
  try {
    storage("session")?.removeItem(UPDATE_GATE_RELOADING_KEY);
    storage("session")?.removeItem("yagodka_updating");
  } catch {
    // ignore
  }
  void runRequiredUpdateGate(root);
}

function setGateFallback(root: HTMLElement, liveBuildId: string): void {
  setGateStatus(root, {
    title: "Обновление не завершилось",
    detail: "Автоматическое обновление остановлено. Можно открыть приложение сейчас или попробовать обновить ещё раз.",
    activeStep: "ready",
    errorStep: "reload",
    progress: 100,
    mode: "failed",
    actions: [
      {
        label: "Открыть приложение",
        kind: "primary",
        run: () => continueWithCurrentBundle(liveBuildId),
      },
      {
        label: "Повторить обновление",
        kind: "secondary",
        run: () => retryRequiredUpdate(root),
      },
    ],
  });
}

function setGateReloadFallback(root: HTMLElement): void {
  setGateStatus(root, {
    title: "Не удалось обновить приложение",
    detail: "Обновление не завершилось. Откройте текущую версию или повторите обновление из окна приложения.",
    activeStep: "reload",
    errorStep: "reload",
    progress: 88,
    mode: "failed",
    actions: [
      {
        label: "Повторить обновление",
        kind: "primary",
        run: () => retryRequiredUpdate(root),
      },
    ],
  });
}

function setGateChecking(root: HTMLElement): void {
  setGateStatus(root, {
    title: "Проверяем обновление",
    detail: "Сверяем версию приложения перед запуском.",
    activeStep: "version",
    progress: 12,
  });
}

function setGatePreparing(root: HTMLElement): void {
  setGateStatus(root, {
    title: "Обновляем приложение",
    detail: "Найдена новая версия. Подготавливаем запуск без старого кэша.",
    activeStep: "activate",
    progress: 38,
  });
}

function setGateClearing(root: HTMLElement): void {
  setGateStatus(root, {
    title: "Обновляем приложение",
    detail: "Очищаем старый кэш приложения перед запуском новой версии.",
    activeStep: "cache",
    progress: 62,
    mode: "warning",
  });
}

function setGateReloading(root: HTMLElement): void {
  setGateStatus(root, {
    title: "Перезапускаем приложение",
    detail: "Завершаем обновление и открываем новую версию.",
    activeStep: "reload",
    progress: 82,
  });
}

function setGateLaunchingCurrent(root: HTMLElement, liveBuildId: string, currentBuildId: string): void {
  const live = splitBuildId(liveBuildId);
  const current = splitBuildId(currentBuildId);
  const liveLabel = live.version ? `Web ${live.version}` : "новая версия";
  const currentLabel = current.version ? `Web ${current.version}` : "текущая версия";
  setGateStatus(root, {
    title: "Запускаем приложение",
    detail: `Доступна ${liveLabel}. Открываем ${currentLabel} без ожидания перезагрузки, обновление продолжится в фоне.`,
    activeStep: "ready",
    progress: 100,
    mode: "success",
  });
}

function setGateLaunchReady(root: HTMLElement): void {
  setGateStatus(root, {
    title: "Запускаем приложение",
    detail: "Версия проверена. Открываем приложение.",
    activeStep: "ready",
    progress: 100,
    mode: "success",
  });
}

function setGateBypassed(root: HTMLElement): void {
  setGateStatus(root, {
    title: "Запускаем приложение",
    detail: "Автоматическое обновление не завершилось, открываем текущую версию без повторного цикла.",
    activeStep: "ready",
    progress: 100,
    mode: "success",
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      const fast = Boolean((window as any).__YAGODKA_TEST_FAST_UPDATE_GATE__);
      window.setTimeout(resolve, fast ? 0 : Math.max(0, ms));
    } catch {
      resolve();
    }
  });
}

async function showGateStep(root: HTMLElement, render: (root: HTMLElement) => void, minMs = UPDATE_GATE_MIN_STEP_MS): Promise<void> {
  render(root);
  await delay(minMs);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = window.setTimeout(() => resolve(fallback), Math.max(0, ms));
      }),
    ]);
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

async function fetchLiveBuildId(timeoutMs = UPDATE_GATE_FETCH_TIMEOUT_MS): Promise<string> {
  if (typeof fetch !== "function") return "";
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer: number | null = null;
  if (controller) timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`./sw.js?update_gate=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response || !response.ok) return "";
    return parseBuildIdFromServiceWorker(await response.text());
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

function waitForControllerChange(timeoutMs = UPDATE_GATE_SW_TIMEOUT_MS): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    let timer: number | null = null;
    const finish = (changed: boolean) => {
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
      try {
        navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      } catch {
        // ignore
      }
      resolve(changed);
    };
    const onChange = () => finish(true);
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    timer = window.setTimeout(() => finish(false), timeoutMs);
  });
}

async function applyServiceWorkerUpdate(): Promise<void> {
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return;
  let reg: ServiceWorkerRegistration | null = null;
  try {
    reg = (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    reg = null;
  }
  try {
    reg = reg || (await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }));
  } catch {
    return;
  }
  try {
    await reg.update();
  } catch {
    // ignore
  }
  try {
    reg.waiting?.postMessage?.({ type: "SKIP_WAITING" });
  } catch {
    // ignore
  }
  await waitForControllerChange();
}

async function resetServiceWorkerCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
    }
  } catch {
    // ignore
  }
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("yagodka-web-cache-") || key.startsWith("yagodka-web-cache-fallback-"))
        .map((key) => caches.delete(key).catch(() => false))
    );
  } catch {
    // ignore
  }
}

function markReloading(liveBuildId: string): void {
  try {
    storage("session")?.setItem(UPDATE_GATE_RELOADING_KEY, liveBuildId);
    storage("session")?.setItem("yagodka_updating", "1");
  } catch {
    // ignore
  }
}

function reloadForRequiredUpdate(liveBuildId: string): boolean {
  try {
    storeActiveBuildId(liveBuildId);
  } catch {
    // ignore
  }
  markReloading(liveBuildId);
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("__yg_update", String(Date.now()));
    window.location.replace(url.toString());
    return true;
  } catch {
    // ignore
  }
  try {
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export async function runRequiredUpdateGate(root: HTMLElement): Promise<RequiredUpdateGateResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { blocked: false, liveBuildId: "", reason: "no_live_build" };
  }

  setGateChecking(root);
  const liveBuildIdPromise = withTimeout(fetchLiveBuildId(), UPDATE_GATE_FETCH_TIMEOUT_MS + 500, "");
  await delay(UPDATE_GATE_MIN_STEP_MS);
  const liveBuildId = await liveBuildIdPromise;
  if (!liveBuildId) {
    clearGateRoot(root);
    return { blocked: false, liveBuildId: "", reason: typeof fetch === "function" ? "fetch_failed" : "no_live_build" };
  }

  const currentBuildId = activeBuildIdForGate();
  if (!isRequiredUpdateNeeded(currentBuildId, liveBuildId)) {
    try {
      storeActiveBuildId(liveBuildId);
    } catch {
      // ignore
    }
    clearGuard();
    clearBypass();
    cleanupUpdateQueryParams();
    await showGateStep(root, setGateLaunchReady, UPDATE_GATE_MIN_STEP_MS);
    clearGateRoot(root);
    return { blocked: false, liveBuildId, reason: "current" };
  }

  if (readBypass(liveBuildId)) {
    await showGateStep(root, setGateBypassed, UPDATE_GATE_MIN_STEP_MS);
    cleanupUpdateQueryParams();
    clearGateRoot(root);
    return { blocked: false, liveBuildId, reason: "reload_failed" };
  }

  // Do not apply or reload from the pre-mount gate. Mobile PWA/WebKit can hang when
  // a service-worker install/reload cycle happens before the app and its update UI are mounted.
  // Persist the live build and let the main runtime show a user-controlled update prompt.
  writePendingPwaBuild(liveBuildId);
  setGateLaunchingCurrent(root, liveBuildId, currentBuildId);
  await delay(UPDATE_GATE_CONTINUE_DELAY_MS);
  clearGuard();
  cleanupUpdateQueryParams();
  clearGateRoot(root);
  return { blocked: false, liveBuildId, reason: "update_required" };
}
