import { getCapacitorPlatform, isCapacitorNativeRuntime } from "../runtime/nativeRuntime";
import { getCurrentAndroidAppVersionInfo } from "../runtime/androidAppVersion";
import { APP_VERSION } from "../../config/app";
import { loadStoredBuildIdForCurrentVersion } from "../pwa/buildIdStore";

const DEVICE_ID_KEY = "yagodka_device_id";
const INSTANCE_ID_KEY = "yagodka_instance_id_v1";

function randomId(): string {
  try {
    const uuid = (globalThis.crypto as any)?.randomUUID?.();
    if (typeof uuid === "string" && uuid) return uuid;
  } catch {
    // ignore
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const RUN_ID = randomId();

export function getRunId(): string {
  return RUN_ID;
}

export function getOrCreateInstanceId(): string {
  try {
    const existing = String(sessionStorage.getItem(INSTANCE_ID_KEY) || "").trim();
    if (existing) return existing;
    const id = randomId();
    sessionStorage.setItem(INSTANCE_ID_KEY, id);
    return id;
  } catch {
    // Best-effort fallback (non-persistent).
    return `tab-${RUN_ID}`;
  }
}

export function getOrCreateDeviceId(): string {
  try {
    const existing = String(localStorage.getItem(DEVICE_ID_KEY) || "").trim();
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // Best-effort fallback (non-persistent).
    return `tmp-${RUN_ID}`;
  }
}

function detectDisplayMode(): string {
  if (isCapacitorNativeRuntime()) return "native";
  try {
    if ((navigator as any)?.standalone) return "standalone";
  } catch {
    // ignore
  }
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      if (window.matchMedia("(display-mode: standalone)").matches) return "standalone";
      if (window.matchMedia("(display-mode: minimal-ui)").matches) return "minimal-ui";
      if (window.matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
    }
  } catch {
    // ignore
  }
  return "browser";
}

function detectOs(): string {
  const ua = (() => {
    try {
      return String(navigator.userAgent || "");
    } catch {
      return "";
    }
  })().toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function buildClientInfoTags(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    device_id: getOrCreateDeviceId(),
    run_id: getRunId(),
    instance_id: getOrCreateInstanceId(),
    display_mode: detectDisplayMode(),
    os: detectOs(),
  };
  const nativePlatform = getCapacitorPlatform();
  if (nativePlatform) {
    out.native_platform = nativePlatform;
    out.client_surface = nativePlatform === "android" ? "android" : "native";
    if (nativePlatform === "android") {
      const appVersion = getCurrentAndroidAppVersionInfo();
      if (appVersion.versionName) out.app_version_name = appVersion.versionName;
      if (appVersion.versionCode !== null) out.app_version_code = appVersion.versionCode;
    }
  }
  try {
    const bid = String(loadStoredBuildIdForCurrentVersion(APP_VERSION) || "").trim();
    if (bid) out.build_id = bid.slice(0, 80);
  } catch {
    // ignore
  }
  try {
    out.ua = String(navigator.userAgent || "");
  } catch {
    // ignore
  }
  try {
    out.lang = String(navigator.language || "");
  } catch {
    // ignore
  }
  try {
    out.tz = String(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  } catch {
    // ignore
  }
  try {
    out.push_supported = Boolean(
      typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    );
  } catch {
    out.push_supported = false;
  }
  try {
    out.push_permission = (Notification?.permission ?? "default") as "default" | "granted" | "denied";
  } catch {
    out.push_permission = "default";
  }
  return out;
}
