import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const HAS_SPACE_RE = /\s/;
const PWA_HASH_SALT = "pwa-cachebust-icons-v1";
const CACHE_BUST_PARAM = "v";
const ICON_URL_RE = /(^|\/)icons\/[^?#]+\.(png|svg)(?:[?#].*)?$/i;
const MANIFEST_URL_RE = /(?:^|\/)manifest\.webmanifest(?:[?#].*)?$/i;

function isAbsoluteSchemeUrl(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function parseUrlLike(value) {
  const raw = String(value ?? "");
  if (!raw) return null;
  if (raw.startsWith("data:")) return null;
  if (isAbsoluteSchemeUrl(raw) && !raw.startsWith("http:") && !raw.startsWith("https:")) return null;
  try {
    return new URL(raw, "https://yagodka.local/");
  } catch {
    return null;
  }
}

function formatUrlLike(original, url) {
  const raw = String(original ?? "");
  const pathOnly = url.pathname.replace(/^\//, "");
  const suffix = `${url.search || ""}${url.hash || ""}`;

  if (raw.startsWith("./")) return `./${pathOnly}${suffix}`;
  if (raw.startsWith("/")) return `${url.pathname}${suffix}`;
  return `${pathOnly}${suffix}`;
}

function stripCacheBust(value) {
  const url = parseUrlLike(value);
  if (!url) return String(value ?? "");
  url.searchParams.delete(CACHE_BUST_PARAM);
  return formatUrlLike(value, url);
}

function withCacheBust(value, buildId) {
  const url = parseUrlLike(value);
  if (!url) return String(value ?? "");
  url.searchParams.set(CACHE_BUST_PARAM, String(buildId ?? ""));
  return formatUrlLike(value, url);
}

function patchIndexHtmlCacheBust(html, patchHref) {
  const raw = String(html ?? "");
  const re =
    /(<link\b[^>]*?\brel=(?:"|')(manifest|icon|apple-touch-icon|mask-icon)(?:"|')[^>]*?\bhref=(?:"|'))([^"']+)((?:"|')[^>]*>)/gi;
  return raw.replace(re, (m, pre, rel, href, post) => {
    const cleanRel = String(rel || "").toLowerCase();
    const shouldPatch =
      cleanRel === "manifest" ? MANIFEST_URL_RE.test(href) : cleanRel === "icon" || cleanRel === "apple-touch-icon" || cleanRel === "mask-icon" ? ICON_URL_RE.test(href) : false;
    if (!shouldPatch) return m;
    return `${pre}${patchHref(href)}${post}`;
  });
}

function patchIndexHtmlBuildVersion(html, buildId) {
  const safeBuildId = String(buildId ?? "").trim() || "dev";
  return String(html ?? "")
    .replace(/(<meta name="yagodka-build-id" content=")[^"]*(" \/>)/, `$1${safeBuildId}$2`)
    .replace(
      /(<div class="boot-version" id="boot-version" data-build-version=")[^"]*(">)[\s\S]*?(<\/div>)/,
      `$1${safeBuildId}$2Web ${safeBuildId}$3`
    );
}

function ensureEarlyBootScript(html) {
  const raw = String(html ?? "");
  const withoutBoot = raw.replace(
    /\s*<script\b(?=[^>]*\bsrc=(?:"|')(?:\.\/|\/)?boot\.js(?:"|'))[^>]*>\s*<\/script>/gi,
    ""
  );
  const bootScript = '    <script defer src="./boot.js"></script>';
  if (/<title>[\s\S]*?<\/title>/i.test(withoutBoot)) {
    return withoutBoot.replace(/(<title>[\s\S]*?<\/title>)/i, `$1\n${bootScript}`);
  }
  return withoutBoot.replace(/(<head\b[^>]*>)/i, `$1\n${bootScript}`);
}

function patchManifestCacheBust(manifest, patchHref) {
  const out = { ...(manifest && typeof manifest === "object" ? manifest : {}) };

  if (Array.isArray(out.icons)) {
    out.icons = out.icons.map((it) => {
      const icon = it && typeof it === "object" ? { ...it } : it;
      if (icon && typeof icon === "object" && typeof icon.src === "string" && ICON_URL_RE.test(icon.src)) {
        icon.src = patchHref(icon.src);
      }
      return icon;
    });
  }

  if (Array.isArray(out.shortcuts)) {
    out.shortcuts = out.shortcuts.map((it) => {
      const shortcut = it && typeof it === "object" ? { ...it } : it;
      if (shortcut && typeof shortcut === "object" && Array.isArray(shortcut.icons)) {
        shortcut.icons = shortcut.icons.map((ic) => {
          const icon = ic && typeof ic === "object" ? { ...ic } : ic;
          if (icon && typeof icon === "object" && typeof icon.src === "string" && ICON_URL_RE.test(icon.src)) {
            icon.src = patchHref(icon.src);
          }
          return icon;
        });
      }
      return shortcut;
    });
  }

  return out;
}

async function removeSpaceNamedFilesRec(dir) {
  let items = [];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of items) {
    const abs = path.join(dir, it.name);
    if (HAS_SPACE_RE.test(it.name)) {
      if (it.isFile()) {
        try {
          await fs.unlink(abs);
        } catch {}
      }
      continue;
    }
    if (it.isDirectory()) {
      await removeSpaceNamedFilesRec(abs);
      continue;
    }
    if (!it.isFile()) continue;
    // Build outputs should never contain spaces; files like "index 2.html" are usually conflict copies.
    if (it.name.includes(" ")) {
      try {
        await fs.unlink(abs);
      } catch {}
    }
  }
}

async function listFilesRec(dir, baseDir) {
  const out = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const it of items) {
    const abs = path.join(dir, it.name);
    if (HAS_SPACE_RE.test(it.name)) continue;
    if (it.isDirectory()) {
      out.push(...(await listFilesRec(abs, baseDir)));
      continue;
    }
    if (!it.isFile()) continue;
    out.push(path.relative(baseDir, abs));
  }
  return out;
}

async function readJson(p) {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function readText(p) {
  return await fs.readFile(p, "utf8");
}

async function collectFilesFromDir(relDir) {
  const absDir = path.join(distDir, relDir);
  try {
    const stat = await fs.stat(absDir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  return await listFilesRec(absDir, distDir);
}

async function fileExists(rel) {
  try {
    const stat = await fs.stat(path.join(distDir, rel));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function main() {
  const pkg = await readJson(path.join(rootDir, "package.json"));
  const version = String(pkg?.version ?? "0.0.0").trim() || "0.0.0";

  // Clean up conflict copies / junk files in dist (can appear on synced filesystems).
  await removeSpaceNamedFilesRec(distDir);

  // Normalize previously built dist (build_pwa.mjs is sometimes re-run without a fresh Vite build).
  // We strip our own cache-bust query param before hashing to keep BUILD_ID stable for identical builds.
  try {
    const indexPath = path.join(distDir, "index.html");
    const existing = await readText(indexPath);
    const normalized = ensureEarlyBootScript(patchIndexHtmlBuildVersion(patchIndexHtmlCacheBust(existing, stripCacheBust), "dev"));
    if (normalized !== existing) await fs.writeFile(indexPath, normalized, "utf8");
  } catch {}
  try {
    const manifestPath = path.join(distDir, "manifest.webmanifest");
    const existing = await readJson(manifestPath);
    const normalized = patchManifestCacheBust(existing, stripCacheBust);
    const next = JSON.stringify(normalized, null, 2) + "\n";
    await fs.writeFile(manifestPath, next, "utf8");
  } catch {}

  const entryFiles = new Set(["index.html", "boot.js", "manifest.webmanifest"]);
  const precacheSet = new Set(entryFiles);

  const indexHtml = await readText(path.join(distDir, "index.html"));
  const assetRe = /\.?\/assets\/[^"')\s]+/g;
  for (const match of indexHtml.matchAll(assetRe)) {
    const rel = match[0].replace(/^\.?\//, "");
    if (rel) precacheSet.add(rel);
  }

  for (const relDir of ["icons", "skins"]) {
    const files = await collectFilesFromDir(relDir);
    for (const rel of files) precacheSet.add(rel);
  }

  const precacheFiles = [];
  for (const rel of precacheSet) {
    if (!rel || rel === "sw.js") continue;
    if (rel.endsWith(".map")) continue;
    if (rel.startsWith(".vite/")) continue;
    if (await fileExists(rel)) precacheFiles.push(rel);
  }

  precacheFiles.sort();

  if (!precacheFiles.includes("index.html")) {
    throw new Error("[pwa] dist/index.html not found");
  }

  const hasher = crypto.createHash("sha256");
  hasher.update(PWA_HASH_SALT);
  hasher.update("\0");
  for (const rel of precacheFiles) {
    const abs = path.join(distDir, rel);
    const data = await fs.readFile(abs);
    hasher.update(rel);
    hasher.update("\0");
    hasher.update(crypto.createHash("sha256").update(data).digest());
    hasher.update("\0");
  }
  const buildHash = hasher.digest("hex").slice(0, 12);
  const buildId = `${version}-${buildHash}`;

  // Cache-bust PWA icons/manifest to make macOS/iOS refresh homescreen / app icons more reliably.
  try {
    const indexPath = path.join(distDir, "index.html");
    const existing = await readText(indexPath);
    const next = ensureEarlyBootScript(
      patchIndexHtmlBuildVersion(
        patchIndexHtmlCacheBust(existing, (href) =>
          MANIFEST_URL_RE.test(href) ? withCacheBust(href, buildId) : ICON_URL_RE.test(href) ? withCacheBust(href, buildId) : href
        ),
        buildId
      )
    );
    if (next !== existing) await fs.writeFile(indexPath, next, "utf8");
  } catch {}
  try {
    const manifestPath = path.join(distDir, "manifest.webmanifest");
    const existing = await readJson(manifestPath);
    const next = patchManifestCacheBust(existing, (href) => (ICON_URL_RE.test(href) ? withCacheBust(href, buildId) : href));
    await fs.writeFile(manifestPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch {}

  const precacheUrls = precacheFiles.map((p) => `./${p}`);

  const sw = `/* eslint-disable */
/* Generated by client-web/scripts/build_pwa.mjs. Do not edit by hand. */

const BUILD_ID = ${JSON.stringify(buildId)};
const CACHE_PREFIX = "yagodka-web-cache-";
const CACHE = CACHE_PREFIX + BUILD_ID;
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};
const RUNTIME_CACHE = CACHE_PREFIX + "runtime";
const RUNTIME_LIMIT = 220;
const RUNTIME_MAX_BYTES = 8 * 1024 * 1024;
const NETWORK_TIMEOUT_MS = 8000;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const PRECACHE_FETCH_TIMEOUT_MS = 9000;
const RUNTIME_EXT_RE = /\\.(js|css|jpe?g|png|gif|webp|avif|svg|ico|woff2?|ttf|otf|wasm|webmanifest)(?:\\?.*)?$/i;
const RUNTIME_PATH_RE = /^\\/(assets|icons|skins)\\//i;
const RUNTIME_SPECIAL = new Set(["/manifest.webmanifest", "/sw.js"]);
const SHARE_PATH_RE = /\\/share\\/?$/i;
const SHARE_FALLBACK_ID = "__broadcast__";
const shareQueue = new Map();
const STREAM_PATH_RE = /(?:^|\\/)__yagodka_stream__\\/files\\/([^/?#]+)$/i;
const MEDIA_PROXY_PATH_RE = /(?:^|\\/)__yagodka_media__\\/files\\/([^/?#]+)$/i;
const STREAM_TTL_MS = 2 * 60 * 1000;
const MEDIA_SOURCE_TTL_MS = 15 * 60 * 1000;
const streams = new Map();
const mediaSources = new Map();
const PREFS_CACHE = CACHE_PREFIX + "prefs";
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
      const id = uid + ":" + convKey + ":" + localId;
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
        return proto + "//" + loc.hostname + ":8787/ws";
      }
      if (loc.host) return proto + "//" + loc.host + "/ws";
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

function isNavigationRequest(req) {
  return req.mode === "navigate" || req.destination === "document";
}

function isStaticAssetUrl(url) {
  const path = url.pathname || "/";
  if (RUNTIME_SPECIAL.has(path)) return true;
  if (RUNTIME_PATH_RE.test(path)) return true;
  return RUNTIME_EXT_RE.test(path);
}

function isCacheableResponse(res) {
  if (!res || !res.ok) return false;
  const cc = String(res.headers.get("cache-control") || "").toLowerCase();
  if (cc.includes("no-store")) return false;
  if (cc.includes("private")) return false;
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len > RUNTIME_MAX_BYTES) return false;
  return true;
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
  return raw.replace(/[\\r\\n"]/g, "").slice(0, 180);
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
  if (name) headers.set("Content-Disposition", \`\${inline ? "inline" : "attachment"}; filename="\${name}"\`);
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
    for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.get("Content-Type")) headers.set("Content-Type", source.mime || "application/octet-stream");
    if (!headers.get("Accept-Ranges") && upstream.status !== 416) headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Disposition", \`inline; filename="\${safeHeaderFilename(source.name || source.fileId || "media")}"\`);
    headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified");
    return new Response(req.method === "HEAD" ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
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
      if (cache) {
        // Keep app shell version-consistent: ensure index.html is cached first.
        // Never fail the whole SW install on cache errors: some clients may have broken/quota-limited CacheStorage.
        await cacheUrl(cache, "./index.html");
        const urls = PRECACHE_URLS.filter((u) => u !== "./index.html");
        // Best-effort cache with per-request timeout: never let SW install hang the PWA.
        await Promise.all(urls.map((u) => cacheUrl(cache, u)));
      }
      // Telegram-like: activate the new SW immediately, but *do not* force reload here.
      // The app decides when it's safe to restart (idle / no transfers / no focused input).
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE && k !== PREFS_CACHE)
            .map((k) => caches.delete(k))
        );
      } catch {}
      await self.clients.claim();
      // Proactively notify clients of the active BUILD_ID (helps older app versions).
      try {
        const payload = { type: "BUILD_ID", buildId: BUILD_ID };
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of clients) {
          try {
            c.postMessage(payload);
          } catch {}
        }
      } catch {}
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== "object") return;
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
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
  if (data.type === "GET_BUILD_ID") {
    const payload = { type: "BUILD_ID", buildId: BUILD_ID };
    try {
      if (event && event.source && typeof event.source.postMessage === "function") {
        event.source.postMessage(payload);
        return;
      }
      if (event && event.ports && event.ports[0] && typeof event.ports[0].postMessage === "function") {
        event.ports[0].postMessage(payload);
        return;
      }
    } catch {}
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => clients.forEach((c) => c.postMessage(payload)))
      .catch(() => {});
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
    if (source && typeof source.id === "string") {
      flushShareQueue(source);
    }
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

  // App shell: prefer network so old installed clients can escape a stale cached index.
  // If network is unavailable, fall back to the version-consistent cached shell.
  if (isNavigationRequest(req)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetchWithTimeout(req, NAVIGATION_NETWORK_TIMEOUT_MS);
          if (fresh && fresh.ok) return fresh;
        } catch {}
        try {
          const cache = await caches.open(CACHE);
          const cachedIndex = await cache.match("./index.html");
          if (cachedIndex) return cachedIndex;
        } catch {}
        try {
          return await fetchWithTimeout(req, NAVIGATION_NETWORK_TIMEOUT_MS);
        } catch {}
        return new Response("offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      })()
    );
    return;
  }

  if (!isStaticAssetUrl(url)) return;

  event.respondWith(
    (async () => {
      try {
        const precache = await caches.open(CACHE);
        const cachedPre = await precache.match(req);
        if (cachedPre) return cachedPre;
      } catch {}
      let cache = null;
      try {
        cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
      } catch {
        cache = null;
      }
      const res = await fetchWithTimeout(req, NETWORK_TIMEOUT_MS);
      if (cache && isCacheableResponse(res)) {
        try {
          cache.put(req, res.clone());
          trimRuntimeCache(cache);
        } catch {}
      }
      return res;
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
          return q ? "./?" + q : "./";
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
`;

  await fs.writeFile(path.join(distDir, "sw.js"), sw, "utf8");
  // eslint-disable-next-line no-console
  console.log(`[pwa] sw.js generated (build=${buildId}, precache=${precacheUrls.length})`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(String(e?.stack || e));
  process.exit(2);
});
