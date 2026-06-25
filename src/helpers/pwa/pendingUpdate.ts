import { shouldReloadForBuild } from "./shouldReloadForBuild";

const PENDING_PWA_BUILD_KEY = "yagodka_pending_pwa_build_v1";
const PENDING_PWA_BUILD_TTL_MS = 30 * 60 * 1000;

interface PendingPwaBuild {
  buildId: string;
  ts: number;
}

function storage(kind: "session" | "local"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function parsePending(raw: string | null): PendingPwaBuild | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const buildId = String((parsed as any).buildId || "").trim();
    const ts = Number((parsed as any).ts || 0);
    if (!buildId || !Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > PENDING_PWA_BUILD_TTL_MS) return null;
    return { buildId, ts: Math.trunc(ts) };
  } catch {
    return null;
  }
}

function readFrom(target: Storage | null): PendingPwaBuild | null {
  try {
    return parsePending(target?.getItem(PENDING_PWA_BUILD_KEY) || null);
  } catch {
    return null;
  }
}

export function readPendingPwaBuild(currentBuildId?: string): string {
  const session = readFrom(storage("session"));
  const local = readFrom(storage("local"));
  const pending = session && local ? (session.ts >= local.ts ? session : local) : session || local;
  const buildId = String(pending?.buildId || "").trim();
  if (!buildId) return "";
  if (currentBuildId && !shouldReloadForBuild(currentBuildId, buildId)) {
    clearPendingPwaBuild(buildId);
    return "";
  }
  return buildId;
}

export function writePendingPwaBuild(buildId: string): void {
  const id = String(buildId || "").trim();
  if (!id) return;
  const payload = JSON.stringify({ buildId: id, ts: Date.now() });
  for (const target of [storage("session"), storage("local")]) {
    try {
      target?.setItem(PENDING_PWA_BUILD_KEY, payload);
    } catch {
      // ignore
    }
  }
}

export function clearPendingPwaBuild(buildId?: string): void {
  const expected = String(buildId || "").trim();
  for (const target of [storage("session"), storage("local")]) {
    try {
      if (!target) continue;
      if (expected) {
        const pending = parsePending(target.getItem(PENDING_PWA_BUILD_KEY));
        if (pending?.buildId && pending.buildId !== expected) continue;
      }
      target.removeItem(PENDING_PWA_BUILD_KEY);
    } catch {
      // ignore
    }
  }
}
