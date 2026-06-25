const PWA_STABILITY_HOLD_KEY = "yagodka_pwa_stability_hold_v1";
const DEFAULT_HOLD_MS = 30_000;

export type PwaStabilityHold = {
  kind: string;
  ts: number;
  until: number;
};

function getStorage(kind: "session" | "local"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function parseHold(raw: string | null): PwaStabilityHold | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const kind = typeof (parsed as any).kind === "string" ? String((parsed as any).kind).trim() : "";
    const ts = Number.isFinite((parsed as any).ts) ? Math.max(0, Math.trunc((parsed as any).ts)) : 0;
    const until = Number.isFinite((parsed as any).until) ? Math.max(0, Math.trunc((parsed as any).until)) : 0;
    if (!kind || !until) return null;
    return { kind, ts, until };
  } catch {
    return null;
  }
}

function writeHold(hold: PwaStabilityHold | null): void {
  const session = getStorage("session");
  const local = getStorage("local");
  try {
    if (!hold) {
      session?.removeItem(PWA_STABILITY_HOLD_KEY);
      local?.removeItem(PWA_STABILITY_HOLD_KEY);
      return;
    }
    const payload = JSON.stringify(hold);
    session?.setItem(PWA_STABILITY_HOLD_KEY, payload);
    local?.setItem(PWA_STABILITY_HOLD_KEY, payload);
  } catch {
    // ignore
  }
}

export function readPwaStabilityHold(): PwaStabilityHold | null {
  const session = parseHold(getStorage("session")?.getItem(PWA_STABILITY_HOLD_KEY) ?? null);
  const local = parseHold(getStorage("local")?.getItem(PWA_STABILITY_HOLD_KEY) ?? null);
  if (session && local) return session.until >= local.until ? session : local;
  return session || local;
}

export function clearPwaStabilityHold(): void {
  writeHold(null);
}

export function resolvePwaStabilityHoldMs(kind: string): number {
  const normalized = String(kind || "").trim().toLowerCase();
  if (normalized === "history_request_timeout") return 45_000;
  if (normalized === "file_download_failed" || normalized === "file_download_open_failed") return 35_000;
  if (normalized === "media_preview_failed") return 20_000;
  return DEFAULT_HOLD_MS;
}

export function markPwaStabilityHold(kind: string, ttlMs?: number): PwaStabilityHold | null {
  const incidentKind = String(kind || "").trim();
  if (!incidentKind) return null;
  const now = Date.now();
  const hold: PwaStabilityHold = {
    kind: incidentKind,
    ts: now,
    until: now + Math.max(1_000, Number(ttlMs) || resolvePwaStabilityHoldMs(incidentKind)),
  };
  writeHold(hold);
  try {
    window.dispatchEvent(new CustomEvent("yagodka:pwa-stability-hold", { detail: hold }));
  } catch {
    // ignore
  }
  return hold;
}

export function getPwaStabilityHoldRemainingMs(now = Date.now()): number {
  const hold = readPwaStabilityHold();
  if (!hold) return 0;
  const remaining = hold.until - now;
  if (remaining <= 0) {
    clearPwaStabilityHold();
    return 0;
  }
  return remaining;
}

export function isPwaStabilityHoldActive(now = Date.now()): boolean {
  return getPwaStabilityHoldRemainingMs(now) > 0;
}
