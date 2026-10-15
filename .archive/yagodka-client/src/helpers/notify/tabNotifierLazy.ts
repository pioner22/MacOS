type TabNotifierModule = typeof import("./tabNotifier");
type RealTabNotifier = import("./tabNotifier").TabNotifier;

export type TabNotifierLike = Pick<
  RealTabNotifier,
  "install" | "getSnapshot" | "shouldShowToast" | "shouldPlaySound" | "shouldShowSystemNotification"
>;

let singleton: TabNotifierLike | null = null;
let loadedNotifier: RealTabNotifier | null = null;
let loadPromise: Promise<RealTabNotifier | null> | null = null;
let installRequested = false;
let resolveInstanceId: (() => string) | null = null;
const fallbackNotified = new Map<string, number>();

function docHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState !== "visible";
  } catch {
    return false;
  }
}

function docFocused(): boolean {
  try {
    if (typeof document === "undefined" || typeof document.hasFocus !== "function") return false;
    return Boolean(document.hasFocus());
  } catch {
    return false;
  }
}

function notificationPermissionGranted(): boolean {
  try {
    return typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

function shouldAndMarkFallback(kind: string, notifKey: string, ttlMs = 120_000): boolean {
  const key = `${kind}:${String(notifKey || "").trim()}`;
  if (!key || key.endsWith(":")) return false;
  const now = Date.now();
  const prev = fallbackNotified.get(key) || 0;
  if (prev && now - prev < ttlMs) return false;
  fallbackNotified.set(key, now);
  if (fallbackNotified.size > 80) {
    const entries = Array.from(fallbackNotified.entries()).sort((a, b) => a[1] - b[1]);
    for (const [oldKey] of entries.slice(0, Math.max(0, entries.length - 80))) fallbackNotified.delete(oldKey);
  }
  return true;
}

function fallbackSnapshot(): ReturnType<TabNotifierLike["getSnapshot"]> {
  return {
    anyVisible: !docHidden(),
    anyFocused: docFocused(),
    leader: false,
  };
}

function primeNotifier(): void {
  void ensureNotifier().catch(() => {});
}

async function ensureNotifier(): Promise<RealTabNotifier | null> {
  if (loadedNotifier) return loadedNotifier;
  if (loadPromise) return loadPromise;
  const getInstanceId = resolveInstanceId;
  if (!getInstanceId) return null;
  loadPromise = import("./tabNotifier")
    .then((mod: TabNotifierModule) => {
      const notifier = mod.getTabNotifier(getInstanceId);
      loadedNotifier = notifier;
      if (installRequested) notifier.install();
      return notifier;
    })
    .catch(() => null)
    .finally(() => {
      if (!loadedNotifier) loadPromise = null;
    });
  return loadPromise;
}

export function getTabNotifier(getInstanceId: () => string): TabNotifierLike {
  if (singleton) return singleton;
  resolveInstanceId = getInstanceId;
  singleton = {
    install() {
      installRequested = true;
      if (loadedNotifier) {
        loadedNotifier.install();
        return;
      }
      primeNotifier();
    },
    getSnapshot() {
      if (loadedNotifier) return loadedNotifier.getSnapshot();
      primeNotifier();
      return fallbackSnapshot();
    },
    shouldShowToast(notifKey, ttlMs) {
      if (loadedNotifier) return loadedNotifier.shouldShowToast(notifKey, ttlMs);
      primeNotifier();
      return Boolean(String(notifKey || "").trim()) && !docHidden() && docFocused();
    },
    shouldPlaySound(notifKey, ttlMs) {
      if (loadedNotifier) return loadedNotifier.shouldPlaySound(notifKey, ttlMs);
      primeNotifier();
      return Boolean(String(notifKey || "").trim()) && docFocused();
    },
    shouldShowSystemNotification(notifKey, ttlMs) {
      if (loadedNotifier) return loadedNotifier.shouldShowSystemNotification(notifKey, ttlMs);
      primeNotifier();
      if (!notificationPermissionGranted()) return false;
      if (docFocused()) return false;
      return shouldAndMarkFallback("system", notifKey, ttlMs);
    },
  };
  return singleton;
}
