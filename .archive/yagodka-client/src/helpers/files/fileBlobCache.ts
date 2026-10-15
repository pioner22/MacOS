import { guessMimeTypeByName } from "./mimeGuess";
import { isImageLikeFile as sharedIsImageLikeFile } from "./mediaKind";

const CACHE_VERSION = 1;
const CACHE_NAME = `yagodka_file_blob_cache_v${CACHE_VERSION}`;
const INDEX_VERSION = 3;
const MAX_ENTRIES = 3200;

const cleanedLegacyIndexUsers = new Set<string>();

function debugPush(kind: string, data?: any): void {
  try {
    const api = (globalThis as any)?.__yagodka_debug_monitor;
    if (api && typeof api.push === "function") api.push(kind, data);
  } catch {
    // ignore
  }
}

function debugPushError(kind: string, err: unknown, extra?: any): void {
  try {
    const api = (globalThis as any)?.__yagodka_debug_monitor;
    if (api && typeof api.pushError === "function") api.pushError(kind, err, extra);
  } catch {
    // ignore
  }
}

function isQuotaExceededError(err: unknown): boolean {
  try {
    const name = err && typeof err === "object" ? String((err as any).name || "") : "";
    if (name === "QuotaExceededError") return true;
    const msg = err instanceof Error ? String(err.message || "") : String(err || "");
    return /quota/i.test(msg);
  } catch {
    return false;
  }
}

export interface FileCachePolicy {
  maxBytes?: number;
  ttlMs?: number;
}

export interface FileCacheStats {
  totalBytes: number;
  count: number;
  oldestTs: number;
  newestTs: number;
  removed: number;
}

interface CacheIndexEntry {
  fileId: string;
  ts: number;
  size: number;
  mime: string | null;
  name: string | null;
}

function origin(): string {
  try {
    const o = typeof location !== "undefined" ? String(location.origin || "") : "";
    return o || "http://localhost";
  } catch {
    return "http://localhost";
  }
}

function normalizeId(raw: string): string | null {
  const id = String(raw || "").trim();
  return id ? id : null;
}

function requestUrl(userId: string, fileId: string): string {
  const uid = encodeURIComponent(userId);
  const fid = encodeURIComponent(fileId);
  return `${origin()}/__yagodka_cache__/files/${uid}/${fid}`;
}

function indexKey(userId: string): string | null {
  const uid = normalizeId(userId);
  if (!uid) return null;
  return `yagodka_file_blob_index_v${INDEX_VERSION}:${uid}`;
}

function removeLegacyIndexKeys(userId: string, st: Storage): void {
  const uid = normalizeId(userId);
  if (!uid) return;
  if (cleanedLegacyIndexUsers.has(uid)) return;
  cleanedLegacyIndexUsers.add(uid);
  try {
    st.removeItem(`yagodka_file_blob_index_v1:${uid}`);
    st.removeItem(`yagodka_file_blob_index_v2:${uid}`);
  } catch {
    // ignore
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function loadIndex(userId: string, storage?: Storage | null): CacheIndexEntry[] {
  const key = indexKey(userId);
  const st = storage ?? defaultStorage();
  if (!st) return [];
  try {
    removeLegacyIndexKeys(userId, st);
    const raw = key ? st.getItem(key) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    if (parsed.v !== INDEX_VERSION) {
      if (key) st.removeItem(key);
      return [];
    }
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const out: CacheIndexEntry[] = [];
    for (const it of entries) {
      if (!it || typeof it !== "object") continue;
      const fileId = normalizeId((it as any).fileId);
      if (!fileId) continue;
      const ts = Number((it as any).ts ?? 0);
      const size = Number((it as any).size ?? 0);
      const mimeRaw = (it as any).mime;
      const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : null;
      const nameRaw = (it as any).name;
      const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
      out.push({
        fileId,
        ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
        size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0,
        mime,
        name,
      });
      if (out.length >= MAX_ENTRIES * 2) break;
    }
    return out;
  } catch {
    return [];
  }
}

function saveIndex(userId: string, entries: CacheIndexEntry[], storage?: Storage | null): void {
  const key = indexKey(userId);
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const payload = JSON.stringify({ v: INDEX_VERSION, entries: entries.slice(0, MAX_ENTRIES) });
    if (key) st.setItem(key, payload);
    removeLegacyIndexKeys(userId, st);
  } catch {
    // ignore
  }
}

function removeIndex(userId: string, storage?: Storage | null): void {
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const key = indexKey(userId);
    if (key) st.removeItem(key);
    removeLegacyIndexKeys(userId, st);
  } catch {
    // ignore
  }
}

function touchIndex(entries: CacheIndexEntry[], next: CacheIndexEntry): CacheIndexEntry[] {
  const now = Date.now();
  const prev = entries.find((e) => e.fileId === next.fileId) || null;
  const entry: CacheIndexEntry = {
    fileId: next.fileId,
    ts: now,
    size: Number(next.size || 0) > 0 ? Math.round(next.size) : prev?.size || 0,
    mime: next.mime || prev?.mime || null,
    name: next.name || prev?.name || null,
  };
  const out = [entry, ...entries.filter((e) => e.fileId !== entry.fileId)];
  return out.slice(0, MAX_ENTRIES);
}

async function cacheAvailable(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    if (!caches || typeof caches.open !== "function") return false;
    await caches.open(CACHE_NAME);
    return true;
  } catch {
    return false;
  }
}

export async function putCachedFileBlob(
  userId: string,
  fileId: string,
  blob: Blob,
  meta?: {
    mime?: string | null;
    size?: number;
    name?: string | null;
    w?: number | null;
    h?: number | null;
    mediaW?: number | null;
    mediaH?: number | null;
  }
): Promise<void> {
  const uid = normalizeId(userId);
  const fid = normalizeId(fileId);
  if (!uid || !fid) return;
  if (!(await cacheAvailable())) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const url = requestUrl(uid, fid);
    const mime = typeof meta?.mime === "string" && meta.mime.trim() ? meta.mime.trim() : (blob.type || null);
    const metaSizeRaw = Number(meta?.size ?? NaN);
    const size = Number.isFinite(metaSizeRaw) && metaSizeRaw > 0 ? Math.round(metaSizeRaw) : Math.round(Number(blob.size || 0) || 0);
    const name = typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : null;
    const headers: Record<string, string> = {};
    if (mime) headers["Content-Type"] = mime;
    if (size > 0) headers["Content-Length"] = String(Math.round(size));
    const w = Number(meta?.w ?? 0);
    const h = Number(meta?.h ?? 0);
    const mediaW = Number(meta?.mediaW ?? 0);
    const mediaH = Number(meta?.mediaH ?? 0);
    if (Number.isFinite(w) && w > 0) headers["X-Yagodka-W"] = String(Math.trunc(w));
    if (Number.isFinite(h) && h > 0) headers["X-Yagodka-H"] = String(Math.trunc(h));
    if (Number.isFinite(mediaW) && mediaW > 0) headers["X-Yagodka-Media-W"] = String(Math.trunc(mediaW));
    if (Number.isFinite(mediaH) && mediaH > 0) headers["X-Yagodka-Media-H"] = String(Math.trunc(mediaH));
    const payload = new Response(blob, { headers });
    const bytesNeeded = Math.max(0, Math.round(size) || blob.size || 0);
    let stored = false;
    try {
      await cache.put(url, payload);
      stored = true;
    } catch (err) {
      debugPushError(isQuotaExceededError(err) ? "cache.put.quota" : "cache.put.error", err, { fileId: fid, bytes: bytesNeeded });
      // Best-effort: CacheStorage quota may be exceeded or temporarily broken.
      // Drop a few oldest cached files for this user and retry once.
      try {
        await pruneFileCacheForPut(uid, fid, bytesNeeded);
        await cache.put(url, payload);
        stored = true;
        debugPush("cache.put.recovered", { fileId: fid });
      } catch (err2) {
        debugPushError(
          isQuotaExceededError(err2) ? "cache.put.retry.quota" : "cache.put.retry.error",
          err2,
          { fileId: fid, bytes: bytesNeeded }
        );
      }
    }
    if (!stored) return;

    const idx = touchIndex(loadIndex(uid), {
      fileId: fid,
      ts: Date.now(),
      size,
      mime,
      name,
    });
    saveIndex(uid, idx);
  } catch {
    // ignore
  }
}

function normalizeMime(value: string | null | undefined): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const base = raw.split(";", 1)[0]?.trim().toLowerCase() || "";
  return base ? base : null;
}

function isGenericMime(mime: string | null): boolean {
  const mt = normalizeMime(mime);
  if (!mt) return true;
  return mt === "application/octet-stream" || mt === "binary/octet-stream";
}

async function sniffSafeMimeByMagic(blob: Blob): Promise<string | null> {
  try {
    const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    if (!head.length) return null;
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
    if (
      head.length >= 8 &&
      head[0] === 0x89 &&
      head[1] === 0x50 &&
      head[2] === 0x4e &&
      head[3] === 0x47 &&
      head[4] === 0x0d &&
      head[5] === 0x0a &&
      head[6] === 0x1a &&
      head[7] === 0x0a
    ) {
      return "image/png";
    }
    if (head.length >= 6) {
      const s6 = String.fromCharCode(head[0], head[1], head[2], head[3], head[4], head[5]);
      if (s6 === "GIF87a" || s6 === "GIF89a") return "image/gif";
    }
    if (head.length >= 12) {
      const s4 = String.fromCharCode(head[0], head[1], head[2], head[3]);
      const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
      if (s4 === "RIFF" && brand === "WEBP") return "image/webp";
      const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
      if (box === "ftyp") {
        if (["heic", "heix", "hevc", "hevx", "heim"].includes(brand)) return "image/heic";
        if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif";
        if (["avif", "avis"].includes(brand)) return "image/avif";
        if (brand === "qt  ") return "video/quicktime";
        if (["M4A ", "M4B ", "M4P "].includes(brand)) return "audio/mp4";
        return "video/mp4";
      }
    }
    if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) return "image/bmp";
    if (head.length >= 4 && head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0x00) return "image/x-icon";
    if (head.length >= 5) {
      const s5 = String.fromCharCode(head[0], head[1], head[2], head[3], head[4]);
      if (s5 === "%PDF-") return "application/pdf";
    }
    return null;
  } catch {
    return null;
  }
}

export async function getCachedFileBlob(
  userId: string,
  fileId: string
): Promise<{ blob: Blob; mime: string | null; size: number; w?: number | null; h?: number | null; mediaW?: number | null; mediaH?: number | null } | null> {
  const uid = normalizeId(userId);
  const fid = normalizeId(fileId);
  if (!uid || !fid) return null;
  if (!(await cacheAvailable())) return null;
  try {
    const idxRows = loadIndex(uid);
    const idxEntry = idxRows.find((e) => e.fileId === fid) || null;
    const idxMime = normalizeMime(idxEntry?.mime ?? null);
    const idxName = idxEntry?.name ? String(idxEntry.name) : null;

    const cache = await caches.open(CACHE_NAME);
    const url = requestUrl(uid, fid);
    const res = await cache.match(url);
    if (!res) {
      // CacheStorage can evict entries without us seeing it; keep index consistent.
      if (idxEntry) {
        try {
          saveIndex(
            uid,
            idxRows.filter((e) => e.fileId !== fid)
          );
          debugPush("cache.index.stale_removed", { fileId: fid });
        } catch {
          // ignore
        }
      }
      return null;
    }
    const rawBlob = await res.blob();
    const mimeHeader = normalizeMime(res.headers.get("Content-Type"));
    const blobMime = normalizeMime(rawBlob.type);
    let mime = mimeHeader || blobMime || idxMime || null;
    if (isGenericMime(mime) && idxName) {
      const guessed = normalizeMime(guessMimeTypeByName(idxName));
      if (guessed && !isGenericMime(guessed)) mime = guessed;
    }
    if (isGenericMime(mime)) {
      const magic = await sniffSafeMimeByMagic(rawBlob);
      if (magic) mime = magic;
    }
    const finalMime = mime && !isGenericMime(mime) ? mime : null;
    const blob = finalMime && blobMime !== finalMime ? rawBlob.slice(0, rawBlob.size, finalMime) : rawBlob;
    const sizeHeader = res.headers.get("Content-Length");
    const sizeFromHeader = sizeHeader ? Number(sizeHeader) : NaN;
    const size = Number.isFinite(sizeFromHeader) && sizeFromHeader > 0 ? Math.round(sizeFromHeader) : blob.size || 0;
    const wHeader = res.headers.get("X-Yagodka-W");
    const hHeader = res.headers.get("X-Yagodka-H");
    const mediaWHeader = res.headers.get("X-Yagodka-Media-W");
    const mediaHHeader = res.headers.get("X-Yagodka-Media-H");
    const wRaw = wHeader ? Number(wHeader) : NaN;
    const hRaw = hHeader ? Number(hHeader) : NaN;
    const mediaWRaw = mediaWHeader ? Number(mediaWHeader) : NaN;
    const mediaHRaw = mediaHHeader ? Number(mediaHHeader) : NaN;
    const w = Number.isFinite(wRaw) && wRaw > 0 ? Math.trunc(wRaw) : null;
    const h = Number.isFinite(hRaw) && hRaw > 0 ? Math.trunc(hRaw) : null;
    const mediaW = Number.isFinite(mediaWRaw) && mediaWRaw > 0 ? Math.trunc(mediaWRaw) : null;
    const mediaH = Number.isFinite(mediaHRaw) && mediaHRaw > 0 ? Math.trunc(mediaHRaw) : null;

    const idx = touchIndex(idxRows, { fileId: fid, ts: Date.now(), size: Math.round(size) || 0, mime: finalMime, name: idxName });
    saveIndex(uid, idx);

    return { blob, mime: finalMime, size, w, h, mediaW, mediaH };
  } catch {
    return null;
  }
}

export async function removeCachedFileBlob(userId: string, fileId: string): Promise<boolean> {
  const uid = normalizeId(userId);
  const fid = normalizeId(fileId);
  if (!uid || !fid) return false;

  let removed = false;
  try {
    const rows = loadIndex(uid);
    if (rows.some((entry) => entry.fileId === fid)) {
      saveIndex(
        uid,
        rows.filter((entry) => entry.fileId !== fid)
      );
      removed = true;
    }
  } catch {
    // ignore
  }

  if (!(await cacheAvailable())) return removed;
  try {
    const cache = await caches.open(CACHE_NAME);
    const deleted = await cache.delete(requestUrl(uid, fid));
    return Boolean(removed || deleted);
  } catch {
    return removed;
  }
}

async function pruneFileCacheForPut(userId: string, keepFileId: string, bytesNeeded: number): Promise<void> {
  const uid = normalizeId(userId);
  const keep = normalizeId(keepFileId);
  if (!uid || !keep) return;
  if (!(await cacheAvailable())) return;
  const entries = loadIndex(uid);
  if (!entries.length) return;

  const cache = await caches.open(CACHE_NAME);
  const sorted = [...entries].sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  const target = Math.max(0, Math.round(bytesNeeded || 0)) || 0;
  const maxRemove = target > 0 ? 256 : 64;
  let freed = 0;
  let removed = 0;
  const kept: CacheIndexEntry[] = [];
  for (const e of sorted) {
    const fid = normalizeId(e.fileId);
    if (!fid) continue;
    if (fid === keep) {
      kept.push(e);
      continue;
    }
    const canRemove = removed < maxRemove && (target <= 0 || freed < target);
    if (!canRemove) {
      kept.push(e);
      continue;
    }
    try {
      await cache.delete(requestUrl(uid, fid));
    } catch {
      // ignore
    }
    removed += 1;
    freed += Number(e.size || 0) || 0;
  }
  saveIndex(uid, kept.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)));
}

export function isImageLikeFile(name: string, mime?: string | null): boolean {
  return sharedIsImageLikeFile(name, mime);
}

function sumIndexSize(entries: CacheIndexEntry[]): number {
  return entries.reduce((acc, e) => acc + (Number(e.size || 0) || 0), 0);
}

function statsFromIndex(entries: CacheIndexEntry[], removed: number): FileCacheStats {
  let oldestTs = 0;
  let newestTs = 0;
  for (const e of entries) {
    const ts = Number(e.ts || 0) || 0;
    if (!oldestTs || (ts && ts < oldestTs)) oldestTs = ts;
    if (!newestTs || ts > newestTs) newestTs = ts;
  }
  return {
    totalBytes: sumIndexSize(entries),
    count: entries.length,
    oldestTs,
    newestTs,
    removed,
  };
}

export function getFileCacheStats(userId: string): FileCacheStats {
  const uid = normalizeId(userId);
  if (!uid) return { totalBytes: 0, count: 0, oldestTs: 0, newestTs: 0, removed: 0 };
  const entries = loadIndex(uid);
  return statsFromIndex(entries, 0);
}

export function listFileCacheEntries(
  userId: string,
  opts: { limit?: number } = {}
): Array<{ fileId: string; ts: number; size: number; mime: string | null; name: string | null }> {
  const uid = normalizeId(userId);
  if (!uid) return [];
  const limitRaw = Number(opts.limit ?? 0) || 0;
  const limit = limitRaw > 0 ? Math.max(1, Math.min(MAX_ENTRIES, Math.trunc(limitRaw))) : MAX_ENTRIES;
  const entries = loadIndex(uid)
    .map((e) => ({
      fileId: e.fileId,
      ts: Number(e.ts || 0) || 0,
      size: Number(e.size || 0) || 0,
      mime: e.mime ?? null,
      name: e.name ?? null,
    }))
    .sort((a, b) => b.ts - a.ts);
  return entries.slice(0, limit);
}

export async function clearFileCache(userId: string): Promise<void> {
  const uid = normalizeId(userId);
  if (!uid) return;
  if (!(await cacheAvailable())) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const needle = `/__yagodka_cache__/files/${encodeURIComponent(uid)}/`;
    for (const req of keys) {
      if (String(req.url || "").includes(needle)) {
        try {
          await cache.delete(req);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  removeIndex(uid);
}

export async function cleanupFileCache(userId: string, policy: FileCachePolicy = {}): Promise<FileCacheStats> {
  const uid = normalizeId(userId);
  if (!uid) return { totalBytes: 0, count: 0, oldestTs: 0, newestTs: 0, removed: 0 };
  const entries = loadIndex(uid);
  if (!entries.length) return statsFromIndex([], 0);

  const maxBytes = Number(policy.maxBytes ?? 0) || 0;
  const ttlMs = Number(policy.ttlMs ?? 0) || 0;
  const now = Date.now();
  let kept = entries.slice();
  if (ttlMs > 0) {
    const minTs = now - ttlMs;
    kept = kept.filter((e) => Number(e.ts || 0) >= minTs);
  }

  if (maxBytes > 0) {
    kept.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    const next: CacheIndexEntry[] = [];
    let total = 0;
    for (const e of kept) {
      const size = Number(e.size || 0) || 0;
      if (total + size <= maxBytes) {
        next.push(e);
        total += size;
      }
    }
    kept = next;
  }

  const keptIds = new Set(kept.map((e) => e.fileId));
  const removed = entries.filter((e) => !keptIds.has(e.fileId));

  if (removed.length && (await cacheAvailable())) {
    try {
      const cache = await caches.open(CACHE_NAME);
      for (const e of removed) {
        try {
          await cache.delete(requestUrl(uid, e.fileId));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  saveIndex(uid, kept);
  return statsFromIndex(kept, removed.length);
}
