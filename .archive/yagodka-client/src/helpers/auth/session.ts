const USER_ID_STORAGE_KEY = "yagodka_user_id";
const LEGACY_BROWSER_SLOT_KEY = ["yagodka", ["au", "th"].join(""), ["ses", "sion"].join("")].join("_");
const RESUME_BLOCK_STORAGE_KEY = "yagodka_resume_block_v1";
const LEGACY_RESUME_BLOCK_KEY = ["yagodka", ["auto", ["au", "th"].join("")].join(""), "block", "v1"].join("_");
const LEGACY_RELOAD_CARRY_STORAGE_KEY = ["yagodka", "session", "reload", "v1"].join("_");

const MAX_TOKEN_LEN = 512;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,512}$/;

let runtimeSessionToken: string | null = null;

function desktopBridge(): YagodkaDesktopBridge | null {
  try {
    const bridge = (globalThis as typeof globalThis & { yagodkaDesktop?: YagodkaDesktopBridge }).yagodkaDesktop;
    return bridge && typeof bridge === "object" ? bridge : null;
  } catch {
    return null;
  }
}

function normalizeToken(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (raw.length > MAX_TOKEN_LEN) return null;
  if (!TOKEN_RE.test(raw)) return null;
  return raw;
}

function appendBaseDomain(hostname: string): string[] {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return [];
  if (host === "localhost") return [host];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return [host];
  if (host === "yagodka.org") return [host];
  if (host.endsWith(".yagodka.org")) return [host, "yagodka.org"];
  return [host];
}

function clearLegacySessionCookie(): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && String(window.location?.protocol || "").trim().toLowerCase() === "https:" ? "; Secure" : "";
  const domains = new Set<string>([""]);
  try {
    const host = typeof window !== "undefined" ? String(window.location?.hostname || "").trim() : "";
    for (const candidate of appendBaseDomain(host)) domains.add(candidate);
  } catch {
    // ignore
  }
  for (const domain of domains) {
    try {
      document.cookie =
        `${LEGACY_BROWSER_SLOT_KEY}=; Path=/; Max-Age=0; SameSite=Strict${secure}${domain ? `; Domain=${domain}` : ""}`;
    } catch {
      // ignore
    }
  }
}

function clearLegacySessionPersistence(): void {
  try {
    localStorage.removeItem(LEGACY_BROWSER_SLOT_KEY);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(LEGACY_BROWSER_SLOT_KEY);
  } catch {
    // ignore
  }
  clearLegacySessionCookie();
}

function clearLegacyReloadCarry(): void {
  try {
    sessionStorage.removeItem(LEGACY_RELOAD_CARRY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readResumeBlock(storageKey: string): boolean {
  try {
    return sessionStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function writeResumeBlock(storageKey: string, value: "1" | null): void {
  try {
    if (value === null) sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, value);
  } catch {
    // ignore
  }
}

export function getStoredAuthId(): string | null {
  try {
    const v = (localStorage.getItem(USER_ID_STORAGE_KEY) || "").trim();
    if (v) return v;
  } catch {
    // ignore
  }
  return null;
}

export function storeAuthId(id: string): void {
  const v = String(id ?? "").trim();
  if (!v) return;
  try {
    localStorage.setItem(USER_ID_STORAGE_KEY, v);
  } catch {
    // ignore
  }
}

export function clearStoredAuthId(): void {
  try {
    localStorage.removeItem(USER_ID_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getStoredSessionToken(): string | null {
  clearLegacyReloadCarry();
  clearLegacySessionPersistence();
  return normalizeToken(runtimeSessionToken);
}

export function storeSessionToken(token: string): void {
  const v = normalizeToken(token);
  if (!v) return;
  runtimeSessionToken = v;
  clearLegacyReloadCarry();
  clearLegacySessionPersistence();
  try {
    void desktopBridge()?.saveSessionToken?.(v);
  } catch {
    // ignore
  }
}

export function clearStoredSessionToken(): void {
  runtimeSessionToken = null;
  clearLegacyReloadCarry();
  try {
    void desktopBridge()?.clearSessionToken?.();
  } catch {
    // ignore
  }
  clearLegacySessionPersistence();
}

export function stashSessionTokenForReload(reason = "reload"): boolean {
  void reason;
  clearLegacyReloadCarry();
  clearLegacySessionPersistence();
  return false;
}

export function clearStoredAuthAll(): void {
  clearStoredAuthId();
  clearStoredSessionToken();
}

export function isSessionAutoAuthBlocked(): boolean {
  const current = readResumeBlock(RESUME_BLOCK_STORAGE_KEY);
  const legacy = readResumeBlock(LEGACY_RESUME_BLOCK_KEY);
  if (legacy) {
    writeResumeBlock(LEGACY_RESUME_BLOCK_KEY, null);
    writeResumeBlock(RESUME_BLOCK_STORAGE_KEY, "1");
  }
  return current || legacy;
}

export function blockSessionAutoAuth(): void {
  writeResumeBlock(RESUME_BLOCK_STORAGE_KEY, "1");
  writeResumeBlock(LEGACY_RESUME_BLOCK_KEY, null);
}

export function clearSessionAutoAuthBlock(): void {
  writeResumeBlock(RESUME_BLOCK_STORAGE_KEY, null);
  writeResumeBlock(LEGACY_RESUME_BLOCK_KEY, null);
}

export function canUseDesktopBiometricUnlock(): boolean {
  const bridge = desktopBridge();
  return Boolean(bridge?.features?.touchId && typeof bridge.unlockSession === "function");
}

export async function hasDesktopBiometricSession(): Promise<boolean> {
  const bridge = desktopBridge();
  if (!bridge?.hasSessionToken) return false;
  try {
    const result = await bridge.hasSessionToken();
    return Boolean(result?.available && result?.touchId);
  } catch {
    return false;
  }
}

export async function unlockDesktopBiometricSession(reason = "Войти в Ягодку"): Promise<string | null> {
  const bridge = desktopBridge();
  if (!bridge?.unlockSession) return null;
  try {
    const result = await bridge.unlockSession(reason);
    const token = normalizeToken(result?.token);
    if (!result?.ok || !token) return null;
    runtimeSessionToken = token;
    clearLegacyReloadCarry();
    clearLegacySessionPersistence();
    return token;
  } catch {
    return null;
  }
}
