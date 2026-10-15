import { liftFileHttpTokenToBearer } from "./fileHttpAuth";

export type ResumableHttpDownloadSleep = (ms: number) => Promise<void>;

export type ResumableHttpDownloadFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ResumableHttpDownloadRefreshUrl = (ctx: {
  status: number;
  url: string;
  offset: number;
  etag: string | null;
}) => Promise<string>;

export interface ResumableHttpDownloadOptions {
  url: string;
  offset?: number;
  etag?: string | null;
  expectedSize?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxUrlRefresh?: number;
  fetchFn?: ResumableHttpDownloadFetch;
  sleep?: ResumableHttpDownloadSleep;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  refreshUrl?: ResumableHttpDownloadRefreshUrl;
  onReset?: (reason: string) => void;
  onProgress?: (ctx: { received: number; total: number | null }) => void;
  onChunk?: (chunk: Uint8Array) => void | Promise<void>;
}

export interface ResumableHttpDownloadResult {
  url: string;
  received: number;
  total: number | null;
  etag: string | null;
  mime: string | null;
}

function markNonRetryable(err: unknown): Error {
  const e = err instanceof Error ? err : new Error(String(err || "error"));
  try {
    (e as any).__yagodkaNonRetryable = true;
  } catch {
    // ignore
  }
  return e;
}

function isNonRetryable(err: unknown): boolean {
  try {
    return Boolean(err && typeof err === "object" && (err as any).__yagodkaNonRetryable);
  } catch {
    return false;
  }
}

function parseRetryAfterMs(value: string | null): number {
  if (!value) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const s = Number(raw);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.min(60, Math.max(0, Math.trunc(s))) * 1000;
}

function defaultSleep(ms: number): Promise<void> {
  const t = Number(ms || 0) || 0;
  if (t <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, t);
  });
}

function normalizeEtag(raw: string | null): string | null {
  const val = typeof raw === "string" ? raw.trim() : "";
  return val ? val : null;
}

function parseContentRange(value: string | null): { start: number; end: number; size: number | null } | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // bytes start-end/size
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(raw);
  if (!m) {
    // bytes */size
    const m2 = /^bytes\s+\*\/(\d+)$/i.exec(raw);
    if (!m2) return null;
    const size = Number(m2[1] || "");
    return Number.isFinite(size) && size >= 0 ? { start: 0, end: -1, size: Math.trunc(size) } : null;
  }
  const start = Number(m[1] || "");
  const end = Number(m[2] || "");
  const sizeRaw = m[3] || "";
  const size = sizeRaw === "*" ? null : Number(sizeRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start) return null;
  if (size !== null && (!Number.isFinite(size) || size < 0)) return null;
  return { start: Math.trunc(start), end: Math.trunc(end), size: size !== null ? Math.trunc(size) : null };
}

export async function resumableHttpDownload(opts: ResumableHttpDownloadOptions): Promise<ResumableHttpDownloadResult> {
  const fetchFn: ResumableHttpDownloadFetch | null =
    opts.fetchFn ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!fetchFn) throw new Error("fetch_unavailable");

  const sleep: ResumableHttpDownloadSleep = opts.sleep ?? defaultSleep;
  const maxRetriesRaw = Number(opts.maxRetries ?? 0) || 0;
  const maxRetries = maxRetriesRaw > 0 ? Math.max(1, Math.trunc(maxRetriesRaw)) : 6;
  const maxDelayMs = Math.max(0, Math.trunc(Number(opts.maxDelayMs ?? 0) || 0)) || 8000;
  const baseDelayMs = Math.max(0, Math.trunc(Number(opts.baseDelayMs ?? 0) || 0)) || 400;
  const maxUrlRefreshRaw = Number(opts.maxUrlRefresh ?? 0) || 0;
  const maxUrlRefresh = maxUrlRefreshRaw > 0 ? Math.max(0, Math.trunc(maxUrlRefreshRaw)) : 2;

  const initialUrl = String(opts.url || "").trim();
  if (!initialUrl) throw new Error("missing_url");
  let url = initialUrl;
  let effectiveUrl = initialUrl;
  let offset = Math.max(0, Math.trunc(Number(opts.offset ?? 0) || 0));
  let etag = normalizeEtag(opts.etag ?? null);
  let total = Number(opts.expectedSize ?? 0) || 0;
  if (!Number.isFinite(total) || total <= 0) total = 0;
  let totalOrNull: number | null = total > 0 ? Math.trunc(total) : null;
  let mime: string | null = null;

  let retryAttempt = 0;
  let refreshes = 0;

  const reset = (reason: string) => {
    if (offset <= 0) return;
    offset = 0;
    etag = null;
    retryAttempt = 0;
    if (typeof opts.onReset === "function") opts.onReset(reason);
  };

  const waitBackoff = async (retryAfterHeader: string | null) => {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, retryAttempt));
    const jitter = Math.round(backoff * (0.15 + Math.random() * 0.15));
    retryAttempt += 1;
    await sleep(Math.max(retryAfterMs, backoff + jitter));
  };

  while (true) {
    if (opts.signal?.aborted) throw new Error("aborted");

    const auth = liftFileHttpTokenToBearer(url);
    effectiveUrl = String(auth.url || url).trim() || url;
    const headers: Record<string, string> = { ...(opts.headers || {}), ...(auth.headers || {}) };
    if (offset > 0) headers["Range"] = `bytes=${offset}-`;
    if (offset > 0 && etag) headers["If-Range"] = etag;

    let res: Response;
    try {
      res = await fetchFn(effectiveUrl, { method: "GET", headers, cache: "no-store", signal: opts.signal });
    } catch (err) {
      if (opts.signal?.aborted) throw new Error("aborted");
      if (retryAttempt >= maxRetries) throw err;
      await waitBackoff(null);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      if (!opts.refreshUrl || refreshes >= maxUrlRefresh) throw new Error(`http_${res.status}`);
      refreshes += 1;
      url = String(await opts.refreshUrl({ status: res.status, url: effectiveUrl, offset, etag })) || "";
      url = url.trim();
      if (!url) throw new Error("missing_url");
      retryAttempt = 0;
      continue;
    }

    if (res.status === 429 || res.status === 503) {
      if (retryAttempt >= maxRetries) throw new Error(`http_${res.status}`);
      await waitBackoff(res.headers.get("Retry-After"));
      continue;
    }

    if (res.status === 416) {
      const cr = parseContentRange(res.headers.get("Content-Range"));
      const known = cr?.size ?? totalOrNull;
      if (typeof known === "number" && Number.isFinite(known) && known >= 0 && offset >= known) {
        return { url: effectiveUrl, received: Math.trunc(known), total: Math.trunc(known), etag, mime };
      }
      reset("range_not_satisfiable");
      if (offset <= 0) throw new Error("range_not_satisfiable");
      continue;
    }

    if (!res.ok) {
      if (res.status >= 500 && res.status < 600 && retryAttempt < maxRetries) {
        await waitBackoff(null);
        continue;
      }
      throw new Error(`http_${res.status}`);
    }

    const nextEtag = normalizeEtag(res.headers.get("ETag"));
    if (nextEtag) etag = nextEtag;
    const nextMime = String(res.headers.get("Content-Type") || "").trim();
    if (nextMime) mime = nextMime;

    if (offset > 0 && res.status === 200) {
      reset("range_ignored");
    }

    if (res.status === 206) {
      const cr = parseContentRange(res.headers.get("Content-Range"));
      if (cr && cr.size !== null && cr.size >= 0) totalOrNull = Math.trunc(cr.size);
      if (cr && offset > 0 && cr.start !== offset) {
        reset("range_mismatch");
      }
    } else if (res.status === 200) {
      const len = Number(res.headers.get("Content-Length") || "");
      if (Number.isFinite(len) && len > 0) totalOrNull = Math.trunc(len);
    }

    const reader = res.body?.getReader?.();
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length) {
        if (typeof opts.onChunk === "function") {
          try {
            await opts.onChunk(buf);
          } catch (err) {
            throw markNonRetryable(err);
          }
        }
        offset += buf.length;
      }
      if (typeof opts.onProgress === "function") opts.onProgress({ received: offset, total: totalOrNull });
    } else {
      try {
        while (true) {
          if (opts.signal?.aborted) throw new Error("aborted");
          const r = await reader.read();
          if (r.done) break;
          const chunk = r.value;
          if (!(chunk instanceof Uint8Array) || chunk.length === 0) continue;
          if (typeof opts.onChunk === "function") {
            try {
              await opts.onChunk(chunk);
            } catch (err) {
              throw markNonRetryable(err);
            }
          }
          offset += chunk.length;
          if (typeof opts.onProgress === "function") opts.onProgress({ received: offset, total: totalOrNull });
        }
      } catch (err) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        if (opts.signal?.aborted) throw new Error("aborted");
        if (isNonRetryable(err)) throw err;
        if (retryAttempt >= maxRetries) throw err;
        await waitBackoff(null);
        continue;
      }
    }

    if (totalOrNull !== null && totalOrNull > 0 && offset < totalOrNull) {
      if (retryAttempt >= maxRetries) throw new Error("incomplete_body");
      await waitBackoff(null);
      continue;
    }

    return { url: effectiveUrl, received: offset, total: totalOrNull, etag, mime };
  }
}
