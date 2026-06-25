import { DEFAULT_AUTO_DOWNLOAD_PREFS, loadAutoDownloadPrefs, type AutoDownloadPrefs } from "../../../helpers/files/autoDownloadPrefs";
import { cleanupFileCache, getFileCacheStats } from "../../../helpers/files/fileBlobCache";
import { loadFileCachePrefs, saveFileCachePrefs } from "../../../helpers/files/fileCachePrefs";
import { isMediaLikeFile as sharedIsMediaLikeFile, resolveMediaKind } from "../../../helpers/files/mediaKind";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

type AutoDownloadKind = "image" | "video" | "audio" | "file";
type FileCachePrefs = { maxBytes: number; autoCleanMs: number; lastCleanAt: number };

export interface AutoDownloadCachePolicyFeatureDeps {
  store: Store<AppState>;
  previewAutoMaxBytes: number;
}

export interface AutoDownloadCachePolicyFeature {
  setAutoDownloadPrefsCache: (userId: string, prefs: AutoDownloadPrefs) => void;
  syncAutoDownloadPrefsFromStorageKey: (key: string | null | undefined) => void;
  resolveAutoDownloadKind: (name: string, mime: string | null | undefined, hint?: string | null) => AutoDownloadKind;
  canAutoDownloadFullFile: (userId: string | null, kind: AutoDownloadKind, size: number) => boolean;
  enforceFileCachePolicy: (userId: string, opts?: { force?: boolean }) => Promise<void>;
  shouldCachePreview: (name: string, mime: string | null | undefined, size: number) => boolean;
  shouldCacheFile: (name: string, mime: string | null | undefined, size: number) => boolean;
  isMediaLikeFile: (name: string, mime: string | null | undefined) => boolean;
}

export function createAutoDownloadCachePolicyFeature(
  deps: AutoDownloadCachePolicyFeatureDeps
): AutoDownloadCachePolicyFeature {
  const { store, previewAutoMaxBytes } = deps;

  const enforceByUser = new Map<string, { inFlight: boolean; queued: boolean; queuedForce: boolean }>();

  let autoDownloadPrefsUserId = "";
  let autoDownloadPrefsCache: AutoDownloadPrefs = { ...DEFAULT_AUTO_DOWNLOAD_PREFS };

  const getFileCachePrefsForUser = (userId: string | null): FileCachePrefs | null => {
    const uid = String(userId || "").trim();
    if (!uid) return null;
    try {
      return loadFileCachePrefs(uid);
    } catch {
      return null;
    }
  };

  const setAutoDownloadPrefsCache = (userId: string, prefs: AutoDownloadPrefs) => {
    const uid = String(userId || "").trim();
    if (!uid) return;
    autoDownloadPrefsUserId = uid;
    autoDownloadPrefsCache = prefs;
  };

  const syncAutoDownloadPrefsFromStorageKey = (key: string | null | undefined) => {
    const k = typeof key === "string" ? key : "";
    if (!k.startsWith("yagodka_auto_download_prefs_v")) return;
    const st = store.get();
    const uid = st.selfId ? String(st.selfId).trim() : "";
    if (!uid) return;
    if (!k.endsWith(`:${uid}`)) return;
    try {
      autoDownloadPrefsUserId = uid;
      autoDownloadPrefsCache = loadAutoDownloadPrefs(uid);
    } catch {
      // ignore
    }
  };

  const getAutoDownloadPrefsForUser = (userId: string | null): AutoDownloadPrefs => {
    const uid = String(userId || "").trim();
    if (!uid) return DEFAULT_AUTO_DOWNLOAD_PREFS;
    if (uid !== autoDownloadPrefsUserId) {
      autoDownloadPrefsUserId = uid;
      try {
        autoDownloadPrefsCache = loadAutoDownloadPrefs(uid);
      } catch {
        autoDownloadPrefsCache = { ...DEFAULT_AUTO_DOWNLOAD_PREFS };
      }
    }
    return autoDownloadPrefsCache;
  };

  const isMediaLikeFile = (name: string, mime: string | null | undefined): boolean => {
    return sharedIsMediaLikeFile(name, mime, null);
  };

  const resolveAutoDownloadKind = (
    name: string,
    mime: string | null | undefined,
    hint?: string | null
  ): AutoDownloadKind => {
    const kind = resolveMediaKind(name, mime, hint);
    return kind === "image" || kind === "video" || kind === "audio" ? kind : "file";
  };

  const autoDownloadCapBytes = (userId: string | null, kind: AutoDownloadKind): number => {
    const prefs = getAutoDownloadPrefsForUser(userId);
    const raw = kind === "image" ? prefs.photoMaxBytes : kind === "video" ? prefs.videoMaxBytes : prefs.fileMaxBytes;
    const max = Math.max(0, Number(raw ?? 0) || 0);
    if (!max) return 0;
    return Math.min(previewAutoMaxBytes, max);
  };

  const canAutoDownloadFullFile = (userId: string | null, kind: AutoDownloadKind, size: number): boolean => {
    const bytes = Number(size ?? 0) || 0;
    if (bytes <= 0) return false;
    const cap = autoDownloadCapBytes(userId, kind);
    if (cap <= 0) return false;
    return bytes <= cap;
  };

  const enforceFileCachePolicy = async (userId: string, opts: { force?: boolean } = {}): Promise<void> => {
    const uid = String(userId || "").trim();
    if (!uid) return;
    const prefs = getFileCachePrefsForUser(uid);
    if (!prefs) return;

    const state = (() => {
      const existing = enforceByUser.get(uid);
      if (existing) return existing;
      const next = { inFlight: false, queued: false, queuedForce: false };
      enforceByUser.set(uid, next);
      return next;
    })();

    if (state.inFlight) {
      state.queued = true;
      if (opts.force) state.queuedForce = true;
      return;
    }

    state.inFlight = true;
    try {
      const now = Date.now();
      const due = prefs.autoCleanMs > 0 && now - prefs.lastCleanAt >= prefs.autoCleanMs;
      const maxBytes = Number(prefs.maxBytes ?? 0) || 0;
      const overLimit = maxBytes > 0 ? getFileCacheStats(uid).totalBytes > maxBytes : false;
      if (!opts.force && !due && !overLimit) return;
      if (!due && !overLimit) return;

      await cleanupFileCache(uid, { maxBytes: prefs.maxBytes, ttlMs: prefs.autoCleanMs });
      if (due) {
        prefs.lastCleanAt = now;
        saveFileCachePrefs(uid, prefs);
      }
    } finally {
      state.inFlight = false;
      const rerun = state.queued;
      const rerunForce = state.queuedForce;
      state.queued = false;
      state.queuedForce = false;
      if (rerun) {
        void enforceFileCachePolicy(uid, rerunForce ? { force: true } : {});
      }
    }
  };

  const shouldCachePreview = (name: string, mime: string | null | undefined, size: number): boolean => {
    const st = store.get();
    const prefs = getFileCachePrefsForUser(st.selfId || null);
    if (!prefs || prefs.maxBytes <= 0) return false;
    const bytes = Number(size ?? 0) || 0;
    if (bytes <= 0) return false;
    if (!isMediaLikeFile(name, mime)) return false;
    const mb = 1024 * 1024;
    const kind = resolveAutoDownloadKind(name, mime, null);
    const hardCap = kind === "video" ? 6 * mb : 24 * mb;
    const cap = Math.min(hardCap, prefs.maxBytes > 0 ? prefs.maxBytes : hardCap);
    return bytes <= cap;
  };

  const shouldCacheFile = (name: string, mime: string | null | undefined, size: number): boolean => {
    const st = store.get();
    const prefs = getFileCachePrefsForUser(st.selfId || null);
    if (!prefs || prefs.maxBytes <= 0) return false;
    const bytes = Number(size ?? 0) || 0;
    if (bytes <= 0) return false;
    if (bytes > prefs.maxBytes) return false;
    return Boolean(name || mime);
  };

  return {
    setAutoDownloadPrefsCache,
    syncAutoDownloadPrefsFromStorageKey,
    resolveAutoDownloadKind,
    canAutoDownloadFullFile,
    enforceFileCachePolicy,
    shouldCachePreview,
    shouldCacheFile,
    isMediaLikeFile,
  };
}
