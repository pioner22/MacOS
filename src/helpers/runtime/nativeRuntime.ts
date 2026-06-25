export interface YagodkaNativeRuntimeConfig {
  gatewayUrl?: unknown;
  publicBaseUrl?: unknown;
  meetBaseUrl?: unknown;
}

export interface YagodkaNativeBridge {
  config?: YagodkaNativeRuntimeConfig;
}

interface CapacitorRuntime {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
}

function getCapacitorRuntime(): CapacitorRuntime | null {
  const cap = (globalThis as typeof globalThis & { Capacitor?: CapacitorRuntime }).Capacitor;
  return cap && typeof cap === "object" ? cap : null;
}

export function getCapacitorPlatform(): string {
  const cap = getCapacitorRuntime();
  try {
    const platform = cap?.getPlatform?.();
    return typeof platform === "string" ? platform.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

export function isCapacitorNativeRuntime(): boolean {
  const cap = getCapacitorRuntime();
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === "function") return Boolean(cap.isNativePlatform());
  } catch {
    // Fall through to platform/protocol checks.
  }
  const platform = getCapacitorPlatform();
  if (platform === "android" || platform === "ios") return true;
  try {
    return String(globalThis.location?.protocol || "") === "capacitor:";
  } catch {
    return false;
  }
}

export function getNativeRuntimeConfig(): YagodkaNativeRuntimeConfig {
  const bridge = (globalThis as typeof globalThis & { yagodkaNative?: YagodkaNativeBridge }).yagodkaNative;
  return bridge?.config && typeof bridge.config === "object" ? bridge.config : {};
}
