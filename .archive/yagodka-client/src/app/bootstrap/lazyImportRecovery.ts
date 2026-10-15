import { isPwaStabilityHoldActive } from "../../helpers/pwa/stabilityHold";
import {
  clearPwaReloadBlockersForTest,
  getPwaReloadBlockerKeys,
  hasPwaReloadBlockers,
  registerPwaReloadBlocker,
} from "../../helpers/pwa/reloadSafety";

const LAZY_IMPORT_RECOVER_KEY = "yagodka_lazy_import_recover_v1";
const LAZY_IMPORT_RECOVER_AT_KEY = "yagodka_lazy_import_recover_at_v1";
const LAZY_IMPORT_RECOVER_TTL_MS = 60_000;

export {
  clearPwaReloadBlockersForTest as __clearPwaReloadBlockersForTest,
  registerPwaReloadBlocker as __registerPwaReloadBlockerForTest,
};

function lazyImportErrorText(err: unknown): string {
  const name = typeof (err as any)?.name === "string" ? String((err as any).name).trim() : "";
  const message = typeof (err as any)?.message === "string" ? String((err as any).message).trim() : "";
  return [name, message].filter(Boolean).join(": ");
}

export function isLikelyStaleLazyImportError(err: unknown): boolean {
  const text = lazyImportErrorText(err).toLowerCase();
  if (!text) return false;
  return (
    text.includes("chunkloaderror") ||
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("error loading dynamically imported module") ||
    text.includes("importing a module script failed") ||
    text.includes("dynamically imported module")
  );
}

function sessionGet(key: string): string {
  try {
    return String(sessionStorage.getItem(key) || "");
  } catch {
    return "";
  }
}

function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function clearLazyImportRecoverFlag(): void {
  sessionRemove(LAZY_IMPORT_RECOVER_KEY);
  sessionRemove(LAZY_IMPORT_RECOVER_AT_KEY);
}

function hasRecentLazyImportRecovery(): boolean {
  if (sessionGet(LAZY_IMPORT_RECOVER_KEY) !== "1") return false;
  const updating = sessionGet("yagodka_updating") === "1" || sessionGet("yagodka_force_recover") === "1";
  if (updating) return true;
  const ts = Number(sessionGet(LAZY_IMPORT_RECOVER_AT_KEY) || "0");
  return Number.isFinite(ts) && ts > 0 && Date.now() - ts < LAZY_IMPORT_RECOVER_TTL_MS;
}

try {
  if (typeof window !== "undefined") {
    window.addEventListener("yagodka:booted", clearLazyImportRecoverFlag);
  }
} catch {
  // ignore
}

export function recoverFromLazyImportError(err: unknown, scope = "lazy_import"): boolean {
  if (typeof window === "undefined" || !isLikelyStaleLazyImportError(err)) return false;

  const detail = lazyImportErrorText(err) || "unknown_lazy_import_error";
  try {
    window.dispatchEvent(new CustomEvent("yagodka:pwa-sw-error", { detail: { error: `lazy_import:${scope}:${detail}` } }));
  } catch {
    // ignore
  }

  if (isPwaStabilityHoldActive()) return false;
  if (hasPwaReloadBlockers()) {
    try {
      window.dispatchEvent(
        new CustomEvent("yagodka:pwa-sw-error", {
          detail: { error: `lazy_import_deferred:${scope}:${getPwaReloadBlockerKeys().join(",") || "reload_blocked"}` },
        })
      );
    } catch {
      // ignore
    }
    return false;
  }

  if (hasRecentLazyImportRecovery()) return false;

  sessionSet(LAZY_IMPORT_RECOVER_KEY, "1");
  sessionSet(LAZY_IMPORT_RECOVER_AT_KEY, String(Date.now()));
  sessionSet("yagodka_updating", "1");
  sessionSet("yagodka_force_recover", "1");

  try {
    window.location.replace(window.location.href);
    return true;
  } catch {
    // ignore
  }

  try {
    window.location.reload();
    return true;
  } catch {
    // ignore
  }
  return false;
}
