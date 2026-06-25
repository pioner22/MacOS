export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

const DISMISSED_AT_KEY = "pwa_install_dismissed_at_v1";

export function isBeforeInstallPromptEvent(e: unknown): e is BeforeInstallPromptEvent {
  const anyE = e as any;
  return Boolean(anyE) && typeof anyE.prompt === "function" && anyE.userChoice && typeof anyE.userChoice.then === "function";
}

export function getPwaInstallDismissedAt(storage: Storage | null): number | null {
  try {
    const raw = storage?.getItem(DISMISSED_AT_KEY);
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function markPwaInstallDismissed(storage: Storage | null, now: number): void {
  try {
    storage?.setItem(DISMISSED_AT_KEY, String(Math.max(0, Number(now) || 0)));
  } catch {
    // ignore
  }
}

export function clearPwaInstallDismissed(storage: Storage | null): void {
  try {
    storage?.removeItem(DISMISSED_AT_KEY);
  } catch {
    // ignore
  }
}

export function shouldOfferPwaInstall(opts: { storage: Storage | null; now: number; isStandalone: boolean; cooldownMs?: number }): boolean {
  if (opts.isStandalone) return false;
  const cooldownMs = Number(opts.cooldownMs) > 0 ? Number(opts.cooldownMs) : 7 * 24 * 60 * 60 * 1000;
  const dismissedAt = getPwaInstallDismissedAt(opts.storage);
  if (!dismissedAt) return true;
  return opts.now - dismissedAt >= cooldownMs;
}

