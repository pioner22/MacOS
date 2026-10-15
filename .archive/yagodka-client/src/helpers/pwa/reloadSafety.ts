type PwaReloadBlockerProbe = () => boolean;

const reloadBlockers = new Map<string, PwaReloadBlockerProbe>();

function normalizeReloadBlockerKey(key: string): string {
  return String(key || "").trim().toLowerCase();
}

export function registerPwaReloadBlocker(key: string, isActive: PwaReloadBlockerProbe): () => void {
  const normalized = normalizeReloadBlockerKey(key);
  if (!normalized || typeof isActive !== "function") return () => {};
  reloadBlockers.set(normalized, isActive);
  return () => {
    if (reloadBlockers.get(normalized) === isActive) reloadBlockers.delete(normalized);
  };
}

export function getPwaReloadBlockerKeys(): string[] {
  const active: string[] = [];
  for (const [key, probe] of reloadBlockers.entries()) {
    try {
      if (probe()) active.push(key);
    } catch {
      // Broken probes should not trap the app in a stale reload block.
    }
  }
  return active;
}

export function hasPwaReloadBlockers(): boolean {
  return getPwaReloadBlockerKeys().length > 0;
}

export function clearPwaReloadBlockersForTest(): void {
  reloadBlockers.clear();
}
