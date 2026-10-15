import { setPushOptOut } from "../../../helpers/pwa/pushPrefs";
import { isServiceWorkerRuntimeAvailable } from "../../../helpers/pwa/serviceWorkerRuntime";
import { isIOS } from "../../../helpers/ui/iosInputAssistant";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface PwaPushFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
}

export interface PwaPushFeature {
  installAutoSync: () => void;
  enablePush: () => Promise<void>;
  disablePush: () => Promise<void>;
  syncExistingPushSubscription: () => Promise<void>;
  onLogout: () => void;
}

function readPushPermission(): "default" | "granted" | "denied" {
  try {
    return (Notification?.permission ?? "default") as "default" | "granted" | "denied";
  } catch {
    return "default";
  }
}

async function requestPushPermission(): Promise<"default" | "granted" | "denied"> {
  try {
    if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
      return "default";
    }
    const request = Notification.requestPermission.bind(Notification);
    if (request.length >= 1) {
      return await new Promise((resolve) => {
        try {
          request((perm) => resolve(perm as "default" | "granted" | "denied"));
        } catch {
          resolve(readPushPermission());
        }
      });
    }
    const result = request();
    if (typeof result === "string") return result as "default" | "granted" | "denied";
    if (result && typeof (result as Promise<string>).then === "function") {
      return (await result) as "default" | "granted" | "denied";
    }
  } catch {
    // ignore
  }
  return readPushPermission();
}

function pushDeniedHelpText(): string {
  try {
    if (isIOS()) {
      return "Разрешение запрещено. Откройте: Настройки → Уведомления → Yagodka → Разрешить.";
    }
    const ua = String(navigator.userAgent || "");
    if (/Mac/i.test(ua)) {
      return "Разрешение запрещено. macOS: Настройки → Уведомления → браузер → Разрешить. В Safari: Настройки → Веб‑сайты → Уведомления → yagodka.org (и включите запрос уведомлений).";
    }
    if (/Android/i.test(ua)) {
      return "Разрешение запрещено. Откройте: Настройки телефона → Приложения → Yagodka → Уведомления.";
    }
  } catch {
    // ignore
  }
  return "Разрешение запрещено в настройках браузера/устройства.";
}

function describePushSubscribeError(err: unknown): string {
  const name = typeof (err as any)?.name === "string" ? String((err as any).name) : "";
  const message = typeof (err as any)?.message === "string" ? String((err as any).message).trim() : "";
  if (name === "NotAllowedError") return "доступ запрещен в браузере";
  if (name === "NotSupportedError") return "Push не поддерживается";
  if (name === "AbortError") return "операция отменена";
  if (name === "InvalidStateError") return "Service Worker не готов";
  if (name === "InvalidAccessError") return "некорректный ключ приложения";
  if (name === "QuotaExceededError") return "превышен лимит подписок";
  if (name === "NetworkError") return "ошибка сети";
  if (message) return message.slice(0, 120);
  return "неизвестная ошибка";
}

function vapidKeyToUint8Array(key: string): Uint8Array<ArrayBuffer> {
  const raw = String(key || "").trim();
  if (!raw) return new Uint8Array(new ArrayBuffer(0));
  const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = base64 + (pad ? "=".repeat(4 - pad) : "");
  const bin = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerRuntimeAvailable()) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function swStateLabel(reg: ServiceWorkerRegistration): string {
  if (reg.active) return "активен";
  if (reg.waiting) return "ожидает активации";
  if (reg.installing) return "устанавливается";
  return "не активен";
}

export function createPwaPushFeature(deps: PwaPushFeatureDeps): PwaPushFeature {
  const { store, send } = deps;
  const pushSentByUser = new Map<string, string>();
  let pushAutoAttemptUser: string | null = null;
  let pushAutoAttemptAt = 0;
  let pushSyncInFlight = false;

  async function getPushRegistrationWithTimeout(mode: "auto" | "manual", timeoutMs: number): Promise<ServiceWorkerRegistration | null> {
    if (!isServiceWorkerRuntimeAvailable()) return null;
    const prefix = mode === "auto" ? "Авто‑подписка: " : "";
    const ready = new Promise<ServiceWorkerRegistration | null>((resolve) => {
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs);
      navigator.serviceWorker.ready
        .then((reg) => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          resolve(reg);
        })
        .catch(() => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          resolve(null);
        });
    });
    const reg = await ready;
    if (reg) return reg;
    let fallback: ServiceWorkerRegistration | null = null;
    try {
      fallback = (await navigator.serviceWorker.getRegistration()) ?? null;
    } catch {
      fallback = null;
    }
    if (!fallback) {
      store.set({ pwaPushStatus: `${prefix}Service Worker не зарегистрирован, пробуем зарегистрировать…` });
      try {
        const reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
        return reg;
      } catch (err) {
        store.set({
          pwaPushStatus: `${prefix}Service Worker не зарегистрирован: ${describePushSubscribeError(err)}`,
        });
        return null;
      }
    }
    const state = swStateLabel(fallback);
    const controller = navigator.serviceWorker.controller;
    const suffix = controller ? "" : " (нет controller, перезапустите PWA)";
    store.set({ pwaPushStatus: `${prefix}Service Worker ${state}${suffix}` });
    return fallback;
  }

  function subscriptionFingerprint(sub: PushSubscription): string {
    try {
      const json = sub.toJSON() as any;
      const endpoint = String(json?.endpoint || "");
      const p256dh = String(json?.keys?.p256dh || "");
      const auth = String(json?.keys?.auth || "");
      return `${endpoint}|${p256dh}|${auth}`;
    } catch {
      return String(sub.endpoint || "");
    }
  }

  async function sendPushSubscription(sub: PushSubscription): Promise<boolean> {
    const st = store.get();
    if (!st.authed || st.conn !== "connected" || !st.selfId) return false;
    const json = sub.toJSON() as any;
    const endpoint = String(json?.endpoint || "").trim();
    if (!endpoint) return false;
    const fp = subscriptionFingerprint(sub);
    if (pushSentByUser.get(st.selfId) === fp) {
      store.set({ pwaPushSubscribed: true, pwaPushStatus: "Push уже включен" });
      return true;
    }
    send({
      type: "pwa_push_subscribe",
      subscription: json,
      ua: navigator.userAgent,
      client: "web",
    });
    pushSentByUser.set(st.selfId, fp);
    store.set({ pwaPushSubscribed: true, pwaPushStatus: "Подписка отправлена" });
    return true;
  }

  async function ensurePushSubscription(mode: "auto" | "manual"): Promise<boolean> {
    if (pushSyncInFlight) return false;
    pushSyncInFlight = true;
    try {
      const st = store.get();
      if (!st.authed || st.conn !== "connected" || !st.selfId) return false;
      if (!st.pwaPushSupported) {
        store.set({ pwaPushStatus: "Push не поддерживается" });
        return false;
      }
      if (!st.pwaPushPublicKey) {
        store.set({ pwaPushStatus: "Push отключен на сервере" });
        return false;
      }
      if (mode === "auto" && st.pwaPushOptOut) {
        store.set({ pwaPushSubscribed: false, pwaPushStatus: "Push отключен пользователем" });
        return false;
      }
      if (mode === "auto" && st.pwaPushSubscribed) {
        store.set({ pwaPushStatus: "Push уже включен" });
        return true;
      }
      let perm = readPushPermission();
      if (perm !== "granted" && mode === "manual") {
        store.set({ pwaPushStatus: "Запрашиваем разрешение…" });
        try {
          perm = await requestPushPermission();
        } catch {
          perm = readPushPermission();
        }
      }
      store.set({ pwaPushPermission: perm });
      if (perm !== "granted") {
        store.set({
          pwaPushSubscribed: false,
          pwaPushStatus: perm === "denied" ? pushDeniedHelpText() : "Разрешение не получено",
        });
        return false;
      }
      store.set({
        pwaPushStatus: mode === "auto" ? "Авто‑подписка: проверяем Service Worker…" : "Проверяем Service Worker…",
      });
      const reg = await getPushRegistrationWithTimeout(mode, 4000);
      if (!reg) {
        return false;
      }
      let sub: PushSubscription | null = null;
      try {
        sub = await reg.pushManager.getSubscription();
      } catch (err) {
        store.set({
          pwaPushSubscribed: false,
          pwaPushStatus: `Не удалось проверить подписку: ${describePushSubscribeError(err)}`,
        });
        return false;
      }
      if (!sub) {
        store.set({
          pwaPushStatus: mode === "auto" ? "Авто‑подписка: создаём подписку…" : "Создаём подписку…",
        });
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyToUint8Array(st.pwaPushPublicKey),
          });
        } catch (err) {
          store.set({
            pwaPushSubscribed: false,
            pwaPushStatus: `Не удалось создать подписку: ${describePushSubscribeError(err)}`,
          });
          return false;
        }
      }
      const fp = subscriptionFingerprint(sub);
      if (pushSentByUser.get(st.selfId) === fp) {
        store.set({ pwaPushSubscribed: true, pwaPushStatus: "Push уже включен" });
        return true;
      }
      store.set({ pwaPushSubscribed: true });
      await sendPushSubscription(sub);
      return true;
    } finally {
      pushSyncInFlight = false;
    }
  }

  async function syncExistingPushSubscription(): Promise<void> {
    await ensurePushSubscription("auto");
  }

  async function enablePush(): Promise<void> {
    setPushOptOut(false);
    store.set({ pwaPushOptOut: false });
    await ensurePushSubscription("manual");
  }

  async function disablePush(): Promise<void> {
    const st = store.get();
    setPushOptOut(true);
    store.set({ pwaPushOptOut: true });
    const reg = await getPushRegistration();
    if (!reg) {
      store.set({ pwaPushStatus: "Service Worker не готов" });
      return;
    }
    let endpoint = "";
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        endpoint = String(sub.endpoint || "").trim();
        await sub.unsubscribe();
      }
    } catch {
      // ignore
    }
    if (st.authed && st.conn === "connected" && endpoint) {
      send({ type: "pwa_push_unsubscribe", endpoint });
    }
    if (st.selfId) pushSentByUser.delete(st.selfId);
    store.set({ pwaPushSubscribed: false, pwaPushStatus: "Push отключен пользователем" });
  }

  function installAutoSync() {
    store.subscribe(() => {
      const st = store.get();
      if (!st.authed || st.conn !== "connected" || !st.selfId) {
        pushAutoAttemptUser = null;
        pushAutoAttemptAt = 0;
        return;
      }
      if (!st.pwaPushSupported || !st.pwaPushPublicKey) return;
      if (st.pwaPushOptOut) return;
      if (st.pwaPushSubscribed) return;
      if (readPushPermission() !== "granted") return;
      const now = Date.now();
      if (pushAutoAttemptUser === st.selfId && now - pushAutoAttemptAt < 15000) return;
      pushAutoAttemptUser = st.selfId;
      pushAutoAttemptAt = now;
      void syncExistingPushSubscription();
    });
  }

  function onLogout() {
    pushAutoAttemptUser = null;
    pushAutoAttemptAt = 0;
    store.set({ pwaPushSubscribed: false, pwaPushStatus: null });
  }

  return { installAutoSync, enablePush, disablePush, syncExistingPushSubscription, onLogout };
}
