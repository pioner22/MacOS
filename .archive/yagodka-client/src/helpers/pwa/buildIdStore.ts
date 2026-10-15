import { splitBuildId } from "../version/buildId";

const ACTIVE_BUILD_ID_KEY = "yagodka_active_build_id_v1";

export function loadStoredBuildIdForCurrentVersion(currentVersion: string): string | null {
  const current = splitBuildId(currentVersion);
  if (!current.version) return null;
  try {
    const raw = String(localStorage.getItem(ACTIVE_BUILD_ID_KEY) || "").trim();
    if (!raw) return null;
    const stored = splitBuildId(raw);
    if (!stored.version || stored.version !== current.version) {
      localStorage.removeItem(ACTIVE_BUILD_ID_KEY);
      return null;
    }
    if (current.build && stored.build !== current.build) {
      localStorage.removeItem(ACTIVE_BUILD_ID_KEY);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function loadActiveBuildId(currentVersion: string): string {
  return loadStoredBuildIdForCurrentVersion(currentVersion) || currentVersion;
}

export function storeActiveBuildId(buildId: string): void {
  const raw = String(buildId || "").trim();
  if (!raw) return;
  const parsed = splitBuildId(raw);
  if (!parsed.version) return;
  try {
    localStorage.setItem(ACTIVE_BUILD_ID_KEY, raw);
  } catch {
    // ignore
  }
}
