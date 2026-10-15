import { isCapacitorNativeRuntime } from "../runtime/nativeRuntime";

export function isServiceWorkerRuntimeAvailable(): boolean {
  try {
    if (!("serviceWorker" in navigator)) return false;
    if ((globalThis as any).yagodkaDesktop) return false;
    if (isCapacitorNativeRuntime()) return false;
    const protocol = String(globalThis.location?.protocol ?? "");
    if (!protocol) return true;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export async function unregisterServiceWorkersForUnsupportedRuntime(): Promise<void> {
  if (isServiceWorkerRuntimeAvailable()) return;
  try {
    if (!("serviceWorker" in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)));
  } catch {
    // ignore
  }
  try {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((key) => caches.delete(key).catch(() => false)));
  } catch {
    // ignore
  }
}
