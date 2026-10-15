import type { LastReadMarker } from "../../stores/types";

const STORAGE_PREFIX = "yagodka_last_read_v1:";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function loadLastReadMarkers(userId: string): Record<string, LastReadMarker> {
  const uid = String(userId || "").trim();
  if (!uid) return {};
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, LastReadMarker> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number") {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) continue;
        if (num > 1_000_000_000_000) {
          out[key] = { ts: num };
        } else {
          out[key] = { id: num };
        }
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const rawId = (value as any).id;
      const rawTs = (value as any).ts;
      const id = Number(rawId);
      const ts = Number(rawTs);
      const entry: LastReadMarker = {};
      if (Number.isFinite(id) && id > 0) entry.id = id;
      if (Number.isFinite(ts) && ts > 0) entry.ts = ts;
      if (!entry.id && !entry.ts) continue;
      out[key] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveLastReadMarkers(userId: string, map: Record<string, LastReadMarker>): void {
  const uid = String(userId || "").trim();
  if (!uid) return;
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(map || {}));
  } catch {
    // best-effort
  }
}
