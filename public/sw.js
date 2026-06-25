/* Fallback service worker (production builds overwrite this file during `npm run build`). */
const CACHE_PREFIX = "yagodka-web-cache-fallback-";
const CACHE = `${CACHE_PREFIX}v1`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-v1`;
const RUNTIME_LIMIT = 140;
const NETWORK_TIMEOUT_MS = 8000;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const PRECACHE_FETCH_TIMEOUT_MS = 9000;
const RUNTIME_EXT_RE = /\.(js|css|jpe?g|png|gif|webp|avif|svg|ico|woff2?|ttf|otf|wasm|webmanifest)(?:\?.*)?$/i;
const RUNTIME_PATH_RE = /^\/(assets|icons|skins)\//i;
const RUNTIME_SPECIAL = new Set(["/manifest.webmanifest", "/sw.js"]);
const SHARE_PATH_RE = /\/share\/?$/i;
const SHARE_FALLBACK_ID = "__broadcast__";
const shareQueue = new Map();
const STREAM_PATH_RE = /(?:^|\/)__yagodka_stream__\/files\/([^/?#]+)$/i;
const MEDIA_PROXY_PATH_RE = /(?:^|\/)__yagodka_media__\/files\/([^/?#]+)$/i;
const STREAM_TTL_MS = 2 * 60 * 1000;
const MEDIA_SOURCE_TTL_MS = 15 * 60 * 1000;
const streams = new Map();
const mediaSources = new Map();
const PREFS_CACHE = `${CACHE_PREFIX}prefs-v1`;
const PREFS_URL = "./__prefs__/notify.json";
let notifyPrefs = null;
const OUTBOX_DB = "yagodka-pwa-outbox-v1";
const OUTBOX_STORE = "outbox";
const OUTBOX_SYNC_TAG = "yagodka-outbox-sync";
const OUTBOX_SEND_LIMIT = 8;
const OUTBOX_RETRY_MIN_MS = 900;
const OUTBOX_SCHEDULE_GRACE_MS = 1200;
let outboxDbPromise = null;

async function fetchWithTimeout(input, timeoutMs) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  if (controller) {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, Math.max(0, timeoutMs || NETWORK_TIMEOUT_MS));
  }
  try {
    return await fetch(input, controller ? { signal: controller.signal } : undefined);
  } finally {
    if (timer !== null) {
      try {
        clearTimeout(timer);
      } catch {}
    }
  }
}

async function cacheUrl(cache, url) {
  try {
    const res = await fetchWithTimeout(url, PRECACHE_FETCH_TIMEOUT_MS);
    if (res && res.ok) await cache.put(url, res.clone());
  } catch {}
}

function openOutboxDb() {
  if (outboxDbPromise) return outboxDbPromise;
  outboxDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(OUTBOX_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return outboxDbPromise;
}

function waitTx(tx) {
  return new Promise((resolve) => {
    if (!tx) return resolve();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

async function getAllOutboxItems() {
  const db = await openOutboxDb();
  if (!db) return [];
  return await new Promise((resolve) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function getOutboxItemsForUser(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  const items = await getAllOutboxItems();
  return items.filter((it) => String(it?.userId || "") === uid);
}

async function replaceOutboxForUser(userId, items) {
  const uid = String(userId || "").trim();
  if (!uid) return;
  const db = await openOutboxDb();
  if (!db) return;
  const existing = await getAllOutboxItems();
  const tx = db.transaction(OUTBOX_STORE, "readwrite");
  const store = tx.objectStore(OUTBOX_STORE);
  for (const it of existing) {
    if (String(it?.userId || "") !== uid) continue;
    store.delete(it.id);
  }
  for (const it of items || []) {
    if (!it || !it.id) continue;
    store.put(it);
  }
  await waitTx(tx);
}

async function updateOutboxItems(items) {
  if (!items || !items.length) return;
  const db = await openOutboxDb();
  if (!db) return;
  const tx = db.transaction(OUTBOX_STORE, "readwrite");
  const store = tx.objectStore(OUTBOX_STORE);
  for (const it of items) {
    if (!it || !it.id) continue;
    store.put(it);
  }
  await waitTx(tx);
}

async function clearOutboxForUser(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return;
  await replaceOutboxForUser(uid, []);
}

function normalizeOutboxSync(userId, outbox) {
  const uid = String(userId || "").trim();
  if (!uid || !outbox || typeof outbox !== "object") return [];
  const items = [];
  for (const [convKey, list] of Object.entries(outbox || {})) {
    const arr = Array.isArray(list) ? list : [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const localId = String(entry.localId || "").trim();
      const text = typeof entry.text === "string" ? entry.text : "";
      const ts = Number(entry.ts || 0);
      const to = typeof entry.to === "string" && entry.to.trim() ? entry.to.trim() : undefined;
      const room = typeof entry.room === "string" && entry.room.trim() ? entry.room.trim() : undefined;
      if (!localId || !text || (!to && !room)) continue;
      const status = entry.status === "sent" ? "sent" : "queued";
      const id = `${uid}:${convKey}:${localId}`;
      items.push({
        id,
        userId: uid,
        convKey,
        localId,
        text,
        ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
        to,
        room,
        status,
        attempts: Number.isFinite(entry.attempts) ? Math.max(0, Math.trunc(entry.attempts)) : 0,
        lastAttemptAt: Number.isFinite(entry.lastAttemptAt) ? Math.max(0, Math.trunc(entry.lastAttemptAt)) : 0,
        whenOnline: Boolean(entry.whenOnline),
        silent: Boolean(entry.silent),
        scheduleAt: Number.isFinite(entry.scheduleAt) ? Math.max(0, Math.trunc(entry.scheduleAt)) : 0,
        updatedAt: Date.now(),
      });
    }
  }
  return items;
}

function outboxItemsToMap(items, userId) {
  const uid = String(userId || "").trim();
  const out = {};
  for (const it of items || []) {
    if (String(it?.userId || "") !== uid) continue;
    const key = String(it?.convKey || "").trim();
    if (!key) continue;
    const list = Array.isArray(out[key]) ? out[key] : [];
    list.push({
      localId: it.localId,
      ts: it.ts,
      text: it.text,
      to: it.to,
      room: it.room,
      status: it.status === "sent" ? "sent" : "queued",
      attempts: it.attempts,
      lastAttemptAt: it.lastAttemptAt,
      whenOnline: it.whenOnline,
      silent: it.silent,
      scheduleAt: it.scheduleAt,
    });
    out[key] = list;
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => a.ts - b.ts);
  }
  return out;
}

function getGatewayUrl() {
  try {
    const loc = self.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    if (loc.hostname) {
      if (loc.port && loc.port !== "80" && loc.port !== "443") {
        return `${proto}//${loc.hostname}:8787/ws`;
      }
      if (loc.host) return `${proto}//${loc.host}/ws`;
    }
  } catch {}
  return "ws://127.0.0.1:8787/ws";
}

async function hasActiveClients() {
  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    return Boolean(clients && clients.length);
  } catch {
    return false;
  }
}

async function sendOutboxViaGateway(items) {
  if (!items || !items.length) return [];
  return [];
}

async function flushOutboxQueue() {
  if (await hasActiveClients()) return;
  const items = await getAllOutboxItems();
  if (!items.length) return;
  const now = Date.now();
  const byUser = new Map();
  for (const it of items) {
    if (!it || it.status === "sent") continue;
    if (it.whenOnline) continue;
    const scheduleAt = Number(it.scheduleAt || 0);
    if (scheduleAt && scheduleAt > now + OUTBOX_SCHEDULE_GRACE_MS) continue;
    const lastAttemptAt = Number(it.lastAttemptAt || 0);
    if (lastAttemptAt && now - lastAttemptAt < OUTBOX_RETRY_MIN_MS) continue;
    const uid = String(it.userId || "").trim();
    if (!uid) continue;
    const list = byUser.get(uid) || [];
    list.push(it);
    byUser.set(uid, list);
  }
  if (!byUser.size) return;
  for (const [uid, list] of byUser.entries()) {
    const batch = list.sort((a, b) => a.ts - b.ts).slice(0, OUTBOX_SEND_LIMIT);
    if (!batch.length) continue;
    const sentIds = await sendOutboxViaGateway(batch);
    if (!sentIds.length) continue;
    const sentSet = new Set(sentIds);
    const updated = [];
    for (const it of batch) {
      if (!sentSet.has(it.id)) continue;
      updated.push({
        ...it,
        status: "sent",
        attempts: (it.attempts || 0) + 1,
        lastAttemptAt: now,
        updatedAt: now,
      });
    }
    await updateOutboxItems(updated);
  }
}

async function loadNotifyPrefs() {
  if (notifyPrefs) return notifyPrefs;
  try {
    const cache = await caches.open(PREFS_CACHE);
    const res = await cache.match(PREFS_URL);
    if (res) {
      const obj = await res.json();
      if (obj && typeof obj === "object") {
        notifyPrefs = { silent: Boolean(obj.silent) };
        return notifyPrefs;
      }
    }
  } catch {}
  notifyPrefs = { silent: false };
  return notifyPrefs;
}

async function saveNotifyPrefs(prefs) {
  notifyPrefs = { silent: Boolean(prefs && prefs.silent) };
  try {
    const cache = await caches.open(PREFS_CACHE);
    await cache.put(PREFS_URL, new Response(JSON.stringify(notifyPrefs), { headers: { "content-type": "application/json" } }));
  } catch {}
}

function isStaticAssetUrl(url) {
  const path = url.pathname || "/";
  if (RUNTIME_SPECIAL.has(path)) return true;
  if (RUNTIME_PATH_RE.test(path)) return true;
  return RUNTIME_EXT_RE.test(path);
}

async function trimRuntimeCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= RUNTIME_LIMIT) return;
    const overflow = keys.length - RUNTIME_LIMIT;
    for (let i = 0; i < overflow; i += 1) {
      const req = keys[i];
      await cache.delete(req);
    }
  } catch {}
}

function normalizeSharePayload(formData) {
  const files = [];
  try {
    for (const f of formData.getAll("files") || []) {
      if (f && typeof f === "object" && typeof f.arrayBuffer === "function") files.push(f);
    }
  } catch {}
  const title = String(formData.get("title") || "").trim();
  const text = String(formData.get("text") || "").trim();
  const url = String(formData.get("url") || "").trim();
  return { files, title, text, url };
}

function enqueueShare(clientId, payload) {
  const key = clientId || SHARE_FALLBACK_ID;
  const arr = shareQueue.get(key) || [];
  arr.push(payload);
  shareQueue.set(key, arr.slice(-8));
}

async function postShareToClient(client, payloads) {
  if (!client || !payloads || !payloads.length) return;
  for (const payload of payloads) {
    try {
      client.postMessage({ type: "PWA_SHARE", payload });
    } catch {}
  }
}

async function flushShareQueue(client) {
  if (!client) return;
  const own = shareQueue.get(client.id) || [];
  const fallback = shareQueue.get(SHARE_FALLBACK_ID) || [];
  if (!own.length && !fallback.length) return;
  shareQueue.delete(client.id);
  shareQueue.delete(SHARE_FALLBACK_ID);
  await postShareToClient(client, [...own, ...fallback]);
}

async function handleShareFetch(event) {
  try {
    const formData = await event.request.formData();
    const payload = normalizeSharePayload(formData);
    const clientId = event.resultingClientId || "";
    enqueueShare(clientId, payload);
    if (clientId) {
      const client = await self.clients.get(clientId);
      if (client) await flushShareQueue(client);
    } else {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (clients && clients.length) {
        for (const c of clients) {
          await flushShareQueue(c);
        }
      }
    }
  } catch {}
  return Response.redirect("./", 303);
}

function safeHeaderFilename(name) {
  const raw = String(name || "").trim();
  if (!raw) return "file";
  return raw.replace(/[\r\n"]/g, "").slice(0, 180);
}

function cleanupStreams() {
  const now = Date.now();
  for (const [sid, info] of streams.entries()) {
    const age = now - Number(info?.createdAt || 0);
    if (age > STREAM_TTL_MS) streams.delete(sid);
  }
}

function cleanupMediaSources() {
  const now = Date.now();
  for (const [sid, info] of mediaSources.entries()) {
    const age = now - Number(info?.createdAt || 0);
    if (age > MEDIA_SOURCE_TTL_MS) mediaSources.delete(sid);
  }
}

function safeMediaHeaders(raw) {
  const headers = {};
  if (!raw || typeof raw !== "object") return headers;
  for (const [key, value] of Object.entries(raw)) {
    const name = String(key || "").trim();
    const lower = name.toLowerCase();
    if (lower !== "authorization") continue;
    const text = String(value || "").trim();
    if (text) headers[name] = text;
  }
  return headers;
}

function registerMediaSource(data) {
  const sourceId = String(data?.sourceId || "").trim();
  const rawUrl = String(data?.url || "").trim();
  if (!sourceId || !rawUrl) return false;
  let resolved = "";
  try {
    const parsed = new URL(rawUrl, self.location.href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    resolved = parsed.toString();
  } catch {
    return false;
  }
  cleanupMediaSources();
  mediaSources.set(sourceId, {
    sourceId,
    fileId: String(data?.fileId || "media").trim() || "media",
    url: resolved,
    headers: safeMediaHeaders(data?.headers),
    name: String(data?.name || "").trim(),
    size: Number(data?.size || 0) || 0,
    mime: String(data?.mime || "").trim(),
    createdAt: Date.now(),
  });
  return true;
}

async function notifyStreamReady(streamId, fileId) {
  const payload = { type: "PWA_STREAM_READY", streamId, fileId };
  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) {
      try {
        c.postMessage(payload);
      } catch {}
    }
  } catch {}
}

async function handleStreamFetch(event) {
  const req = event.request;
  const url = new URL(req.url);
  const match = STREAM_PATH_RE.exec(url.pathname);
  if (!match) return new Response("bad_request", { status: 400 });
  const fileId = decodeURIComponent(match[1] || "");
  const streamId = String(url.searchParams.get("sid") || "").trim();
  if (!streamId) return new Response("missing_sid", { status: 400 });
  if (req.headers.get("range")) return new Response("range_not_supported", { status: 416 });
  cleanupStreams();
  const name = safeHeaderFilename(url.searchParams.get("name") || "file");
  const mime = String(url.searchParams.get("mime") || "").trim();
  const inline = String(url.searchParams.get("inline") || "").trim() === "1";
  const sizeRaw = url.searchParams.get("size");
  const size = Number(sizeRaw || 0);
  const headers = new Headers();
  headers.set("Content-Type", mime || "application/octet-stream");
  headers.set("Cache-Control", "no-store");
  if (Number.isFinite(size) && size > 0) headers.set("Content-Length", String(Math.round(size)));
  if (name) headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${name}"`);
  const stream = new ReadableStream({
    start(controller) {
      streams.set(streamId, { controller, fileId, createdAt: Date.now() });
      notifyStreamReady(streamId, fileId);
    },
    cancel() {
      streams.delete(streamId);
    },
  });
  return new Response(stream, { status: 200, headers });
}

async function handleMediaProxyFetch(event) {
  const req = event.request;
  const url = new URL(req.url);
  const match = MEDIA_PROXY_PATH_RE.exec(url.pathname);
  if (!match) return new Response("bad_request", { status: 400 });
  const sourceId = String(url.searchParams.get("sid") || "").trim();
  if (!sourceId) return new Response("missing_sid", { status: 400 });
  cleanupMediaSources();
  const source = mediaSources.get(sourceId);
  if (!source) return new Response("media_source_expired", { status: 404, headers: { "Cache-Control": "no-store" } });

  const upstreamHeaders = new Headers();
  for (const [key, value] of Object.entries(source.headers || {})) {
    if (value) upstreamHeaders.set(key, value);
  }
  for (const name of ["Range", "If-Range", "If-None-Match", "If-Modified-Since", "Accept"]) {
    const value = req.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }

  try {
    const upstream = await fetch(source.url, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamHeaders,
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
    });
    source.createdAt = Date.now();
    const headers = new Headers();
    for (const name of [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges",
      "ETag",
      "Last-Modified",
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.get("Content-Type")) headers.set("Content-Type", source.mime || "application/octet-stream");
    if (!headers.get("Accept-Ranges") && upstream.status !== 416) headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Disposition", `inline; filename="${safeHeaderFilename(source.name || source.fileId || "media")}"`);
    headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified");
    return new Response(req.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return new Response("media_proxy_failed", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      let cache = null;
      try {
        cache = await caches.open(CACHE);
      } catch {
        cache = null;
      }
      if (!cache) return;
      await cacheUrl(cache, "./index.html");
      await Promise.all(
        [
          "./",
          "./manifest.webmanifest",
          "./icons/icon.svg",
          "./icons/icon-app-192.png",
          "./icons/icon-app-512.png",
          "./icons/icon-192.png",
          "./icons/icon-512.png",
          "./skins/skins.json",
          "./skins/telegram-exact.css",
        ].map((url) => cacheUrl(cache, url))
      );
    })()
  );
  // Do NOT skipWaiting() automatically: apply updates only on user confirmation.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE && k !== RUNTIME_CACHE && k !== PREFS_CACHE)
            .map((k) => caches.delete(k))
        );
      } catch {}
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== "object") return;
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "PWA_MEDIA_SOURCE_REGISTER") {
    registerMediaSource(data);
    return;
  }
  if (data.type === "PWA_OUTBOX_SYNC") {
    event.waitUntil(
      (async () => {
        const uid = String(data.userId || "").trim();
        if (!uid) return;
        const items = normalizeOutboxSync(uid, data.outbox || {});
        await replaceOutboxForUser(uid, items);
        const hasPending = items.some((it) => it.status !== "sent");
        if (hasPending) {
          try {
            if (self.registration && "sync" in self.registration) {
              await self.registration.sync.register(OUTBOX_SYNC_TAG);
            } else {
              await flushOutboxQueue();
            }
          } catch {}
        }
      })()
    );
    return;
  }
  if (data.type === "PWA_OUTBOX_REQUEST") {
    const port = event.ports && event.ports[0];
    if (!port) return;
    event.waitUntil(
      (async () => {
        const uid = String(data.userId || "").trim();
        if (!uid) {
          port.postMessage({ outbox: {} });
          return;
        }
        const items = await getOutboxItemsForUser(uid);
        port.postMessage({ outbox: outboxItemsToMap(items, uid) });
      })()
    );
    return;
  }
  if (data.type === "PWA_OUTBOX_CLEAR") {
    const uid = String(data.userId || "").trim();
    if (!uid) return;
    event.waitUntil(clearOutboxForUser(uid));
    return;
  }
  if (data.type === "PWA_NOTIFY_PREFS") {
    event.waitUntil(saveNotifyPrefs(data.prefs));
  }
  if (data.type === "PWA_STREAM_CHUNK") {
    const streamId = String(data.streamId || "").trim();
    if (!streamId) return;
    const info = streams.get(streamId);
    if (!info || !info.controller) return;
    const chunk = data.chunk;
    let buf = null;
    if (chunk instanceof ArrayBuffer) {
      buf = new Uint8Array(chunk);
    } else if (chunk && chunk.buffer) {
      const byteOffset = Number(chunk.byteOffset || 0) || 0;
      const byteLength = Number(chunk.byteLength || 0) || Number(chunk.length || 0) || 0;
      if (byteLength) buf = new Uint8Array(chunk.buffer, byteOffset, byteLength);
    }
    if (buf && buf.byteLength) {
      try {
        info.controller.enqueue(buf);
      } catch {}
    }
    return;
  }
  if (data.type === "PWA_STREAM_END") {
    const streamId = String(data.streamId || "").trim();
    if (!streamId) return;
    const info = streams.get(streamId);
    if (info && info.controller) {
      try {
        info.controller.close();
      } catch {}
    }
    streams.delete(streamId);
    return;
  }
  if (data.type === "PWA_STREAM_ERROR") {
    const streamId = String(data.streamId || "").trim();
    if (!streamId) return;
    const info = streams.get(streamId);
    if (info && info.controller) {
      try {
        info.controller.error(data.error || "stream_error");
      } catch {}
    }
    streams.delete(streamId);
    return;
  }
  if (data.type === "PWA_SHARE_READY") {
    const source = event && event.source;
    if (source && typeof source.id === "string") flushShareQueue(source);
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (SHARE_PATH_RE.test(url.pathname)) {
    if (req.method === "POST") {
      event.respondWith(handleShareFetch(event));
    }
    return;
  }

  if (STREAM_PATH_RE.test(url.pathname)) {
    if (req.method === "GET") {
      event.respondWith(handleStreamFetch(event));
    }
    return;
  }

  if (MEDIA_PROXY_PATH_RE.test(url.pathname)) {
    if (req.method === "GET" || req.method === "HEAD") {
      event.respondWith(handleMediaProxyFetch(event));
    }
    return;
  }

  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      try {
        // App shell: for navigations, prefer cached index.html to avoid mixing versions.
        if (req.mode === "navigate" || req.destination === "document") {
          try {
            const fresh = await fetchWithTimeout(req, NAVIGATION_NETWORK_TIMEOUT_MS);
            if (fresh && fresh.ok) return fresh;
          } catch {}
          const cachedIndex = await caches.match("./index.html");
          if (cachedIndex) return cachedIndex;
        }
        if (!isStaticAssetUrl(url)) return fetchWithTimeout(req, NETWORK_TIMEOUT_MS);
        const runtime = await caches.open(RUNTIME_CACHE);
        const cachedRuntime = await runtime.match(req);
        if (cachedRuntime) return cachedRuntime;
        const res = await fetchWithTimeout(req, NETWORK_TIMEOUT_MS);
        if (res && res.ok) {
          runtime.put(req, res.clone()).catch(() => {});
          trimRuntimeCache(runtime);
        }
        return res;
      } catch {
        if (cached) return cached;
        throw new Error("offline");
      }
    })()
  );
});

self.addEventListener("sync", (event) => {
  if (event && event.tag === OUTBOX_SYNC_TAG) {
    event.waitUntil(flushOutboxQueue());
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = null;
      try {
        payload = event?.data?.json?.();
      } catch {
        payload = null;
      }
      if (!payload) {
        try {
          const text = event?.data?.text?.();
          payload = text ? { title: "Новое сообщение", body: String(text) } : null;
        } catch {
          payload = null;
        }
      }
      if (!payload || typeof payload !== "object") return;
      const silentPush = Boolean(payload.silent || payload?.data?.silent || payload?.data?.event === "sync");
      if (silentPush) {
        await flushOutboxQueue();
        return;
      }
      const title = String(payload.title || "Новое сообщение");
      const body = String(payload.body || "");
      const tag = payload.tag ? String(payload.tag) : undefined;
      const data = payload.data ?? null;
      const options = {
        body,
        tag,
        data,
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
      };
      try {
        const prefs = await loadNotifyPrefs();
        if (prefs && prefs.silent) options.silent = true;
      } catch {}
      try {
        await self.registration.showNotification(title, options);
      } catch {}
      await flushOutboxQueue();
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event?.notification?.data ?? null;
  event.notification?.close?.();
  event.waitUntil(
    (async () => {
      const room = data && typeof data === "object" && (data.room || data.room === 0) ? String(data.room || "").trim() : "";
      const from = data && typeof data === "object" && (data.from || data.from === 0) ? String(data.from || "").trim() : "";
      const openUrl = (() => {
        if (!room && !from) return "./";
        try {
          const qs = new URLSearchParams();
          if (room) qs.set("push_room", room);
          if (from) qs.set("push_from", from);
          const q = qs.toString();
          return q ? `./?${q}` : "./";
        } catch {
          return "./";
        }
      })();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (clients && clients.length) {
        for (const c of clients) {
          try {
            c.postMessage({ type: "PWA_NOTIFICATION_CLICK", payload: data });
          } catch {}
        }
        try {
          await clients[0].focus();
          return;
        } catch {}
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(openUrl);
      }
    })()
  );
});
