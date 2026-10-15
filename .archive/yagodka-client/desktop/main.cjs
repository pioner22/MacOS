const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain, nativeImage, safeStorage, screen, session, shell, systemPreferences } = require("electron");
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

const APP_ID = "org.yagodka.desktop";
const DEFAULT_GATEWAY_URL = "wss://yagodka.org/ws";
const DEFAULT_PUBLIC_BASE_URL = "https://yagodka.org/";
const DEFAULT_MEET_BASE_URL = "https://meet.yagodka.org";
const DEFAULT_UPDATE_FEED_URL = "https://yagodka.org/desktop-updates/mac/";
const DEV_URL = process.env.YAGODKA_DESKTOP_DEV_URL || "http://127.0.0.1:5173";
const ICON_PATH = path.join(__dirname, "..", "public", "icons", "icon-512.png");
const SECURE_SESSION_FILENAME = "secure-session.json";
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{16,512}$/;
const DESKTOP_UPDATE_STATUS_CHANNEL = "yagodka:desktop-update-status";

app.setAppUserModelId(APP_ID);

function normalizeUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || ""));
  } catch {
    return null;
  }
}

function isTruthyEnv(rawValue) {
  return ["1", "true", "yes", "on"].includes(String(rawValue || "").trim().toLowerCase());
}

function parseOptionalBoolEnv(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(value)) return false;
  return null;
}

function isHttpUrl(target) {
  return Boolean(target && ["http:", "https:"].includes(target.protocol));
}

function isWsUrl(target) {
  return Boolean(target && ["ws:", "wss:"].includes(target.protocol));
}

function normalizeHttpBaseUrl(rawUrl, fallbackUrl) {
  const target = normalizeUrl(rawUrl);
  if (!isHttpUrl(target)) return fallbackUrl;
  target.hash = "";
  target.search = "";
  if (!target.pathname.endsWith("/")) target.pathname = `${target.pathname}/`;
  return target.href;
}

function normalizeOptionalHttpBaseUrl(rawUrl) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "";
  const target = normalizeUrl(clean);
  if (!isHttpUrl(target)) return "";
  target.hash = "";
  target.search = "";
  if (!target.pathname.endsWith("/")) target.pathname = `${target.pathname}/`;
  return target.href;
}

function normalizeWsUrl(rawUrl, fallbackUrl) {
  const target = normalizeUrl(rawUrl);
  if (!isWsUrl(target)) return fallbackUrl;
  return target.href;
}

function normalizeSessionToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!SESSION_TOKEN_RE.test(token)) return "";
  return token;
}

function getDesktopRuntimeConfig() {
  return {
    gatewayUrl: normalizeWsUrl(process.env.YAGODKA_DESKTOP_GATEWAY_URL, DEFAULT_GATEWAY_URL),
    publicBaseUrl: normalizeHttpBaseUrl(process.env.YAGODKA_DESKTOP_PUBLIC_BASE_URL, DEFAULT_PUBLIC_BASE_URL),
    meetBaseUrl: normalizeHttpBaseUrl(process.env.YAGODKA_DESKTOP_MEET_URL, DEFAULT_MEET_BASE_URL).replace(/\/+$/, ""),
  };
}

function getDesktopUpdateConfig() {
  const rawFeed = String(process.env.YAGODKA_DESKTOP_UPDATE_FEED_URL || "").trim();
  const feedDisabled = ["0", "false", "off", "none", "disabled"].includes(rawFeed.toLowerCase());
  const autoCheckEnv = parseOptionalBoolEnv(process.env.YAGODKA_DESKTOP_UPDATE_AUTO_CHECK);
  return {
    feedUrl: feedDisabled ? "" : normalizeOptionalHttpBaseUrl(rawFeed) || DEFAULT_UPDATE_FEED_URL,
    autoCheck: autoCheckEnv === null ? true : autoCheckEnv,
  };
}

const DESKTOP_RUNTIME_CONFIG = getDesktopRuntimeConfig();
const DESKTOP_UPDATE_CONFIG = getDesktopUpdateConfig();
const MEDIA_PERMISSION_KINDS = new Set(["camera", "microphone"]);
const MEDIA_PERMISSION_TRACKS = new Map([
  ["video", "camera"],
  ["audio", "microphone"],
]);
const DESKTOP_RENDERER_RECOVERY_MAX_ATTEMPTS = 3;
const DESKTOP_RENDERER_RECOVERY_DELAY_MS = 650;
const DESKTOP_RENDERER_STABLE_MS = 15_000;
const desktopRendererRecovery = new WeakMap();
let desktopUpdaterConfigured = false;
let desktopUpdateStatus = {
  state: "idle",
  supported: false,
  reason: "",
  appVersion: "",
  feedUrl: DESKTOP_UPDATE_CONFIG.feedUrl,
  autoCheck: DESKTOP_UPDATE_CONFIG.autoCheck,
  updateInfo: null,
  progress: null,
  error: "",
};

function getDesktopPublicOrigin() {
  const target = normalizeUrl(DESKTOP_RUNTIME_CONFIG.publicBaseUrl);
  return isHttpUrl(target) ? target.origin : "https://yagodka.org";
}

function isExternalOpenAllowed(rawUrl) {
  const target = normalizeUrl(rawUrl);
  if (!target) return false;
  return ["http:", "https:", "mailto:", "tel:"].includes(target.protocol);
}

function isAppUrl(rawUrl) {
  const target = normalizeUrl(rawUrl);
  if (!target) return false;
  if (!app.isPackaged) {
    const dev = normalizeUrl(DEV_URL);
    return Boolean(dev && target.origin === dev.origin);
  }
  return target.protocol === "file:";
}

function isTrustedAppFrame(webContents, details) {
  const urls = [
    details?.requestingUrl,
    details?.embeddingOrigin,
    details?.securityOrigin,
    webContents?.getURL?.(),
  ];
  return urls.some((url) => isAppUrl(url));
}

function openExternalUrl(rawUrl) {
  if (!isExternalOpenAllowed(rawUrl)) return;
  void shell.openExternal(rawUrl);
}

async function clearDesktopServiceWorkerState() {
  const desktopSession = session.defaultSession;
  await Promise.allSettled([
    desktopSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] }),
    desktopSession.clearData({ dataTypes: ["serviceWorkers", "cache"] }),
  ]);
}

function urlPatternFor(rawUrl) {
  const target = normalizeUrl(rawUrl);
  if (!target) return "";
  return `${target.protocol}//${target.host}${target.pathname || "/"}*`;
}

function installDesktopRequestHeaders() {
  const publicOrigin = getDesktopPublicOrigin();
  const patterns = [
    urlPatternFor(DESKTOP_RUNTIME_CONFIG.gatewayUrl),
    `${publicOrigin}/*`,
  ].filter(Boolean);
  if (!patterns.length) return;

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: patterns }, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    requestHeaders.Origin = publicOrigin;
    callback({ requestHeaders });
  });
}

function normalizeMediaPermissionKind(rawKind) {
  const kind = String(rawKind || "").trim().toLowerCase();
  if (MEDIA_PERMISSION_KINDS.has(kind)) return kind;
  return MEDIA_PERMISSION_TRACKS.get(kind) || "";
}

function normalizeMediaPermissionKinds(rawKinds) {
  const source = Array.isArray(rawKinds) ? rawKinds : [rawKinds];
  const kinds = [];
  for (const rawKind of source) {
    const kind = normalizeMediaPermissionKind(rawKind);
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

function mediaKindsFromRequestDetails(details) {
  const fromTracks = normalizeMediaPermissionKinds(details?.mediaTypes || details?.mediaTypesRequested || details?.mediaType);
  return fromTracks.length ? fromTracks : ["camera", "microphone"];
}

function getDesktopMediaAccessStatus(kind) {
  const normalized = normalizeMediaPermissionKind(kind);
  if (!normalized) return "unknown";
  if (process.platform !== "darwin") return "unknown";
  try {
    if (typeof systemPreferences.getMediaAccessStatus !== "function") return "unknown";
    return systemPreferences.getMediaAccessStatus(normalized);
  } catch {
    return "unknown";
  }
}

async function requestDesktopMediaAccess(kind) {
  const normalized = normalizeMediaPermissionKind(kind);
  if (!normalized) return { ok: false, kind: "", status: "unknown", requested: false, reason: "bad_kind" };
  let status = getDesktopMediaAccessStatus(normalized);
  if (status === "granted" || status === "unknown") {
    return { ok: true, kind: normalized, status, requested: false };
  }
  if (status === "not-determined" && process.platform === "darwin") {
    try {
      if (typeof systemPreferences.askForMediaAccess !== "function") {
        return { ok: false, kind: normalized, status, requested: false, reason: "ask_unavailable" };
      }
      const granted = await systemPreferences.askForMediaAccess(normalized);
      status = getDesktopMediaAccessStatus(normalized);
      return { ok: Boolean(granted) && status === "granted", kind: normalized, status, requested: true };
    } catch {
      return { ok: false, kind: normalized, status: getDesktopMediaAccessStatus(normalized), requested: true, reason: "ask_failed" };
    }
  }
  return { ok: false, kind: normalized, status, requested: false, reason: status };
}

function getDesktopMediaPermissionSummary(kinds) {
  const normalized = normalizeMediaPermissionKinds(kinds);
  const wanted = normalized.length ? normalized : ["camera", "microphone"];
  const permissions = {};
  for (const kind of wanted) {
    permissions[kind] = { status: getDesktopMediaAccessStatus(kind) };
  }
  return { ok: true, permissions, platform: process.platform };
}

async function requestDesktopMediaPermissions(kinds) {
  const normalized = normalizeMediaPermissionKinds(kinds);
  const wanted = normalized.length ? normalized : ["camera", "microphone"];
  const permissions = {};
  let ok = true;
  for (const kind of wanted) {
    const result = await requestDesktopMediaAccess(kind);
    permissions[kind] = {
      status: result.status,
      requested: Boolean(result.requested),
      reason: result.reason || "",
    };
    if (!result.ok) ok = false;
  }
  return { ok, permissions, platform: process.platform };
}

function openDesktopMediaSettings(kind) {
  const normalized = normalizeMediaPermissionKind(kind) || "camera";
  if (process.platform !== "darwin") return false;
  const pane = normalized === "microphone" ? "Privacy_Microphone" : "Privacy_Camera";
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  return true;
}

function installDesktopMediaPermissions() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== "media") return false;
    if (!isAppUrl(requestingOrigin) && !isTrustedAppFrame(webContents, details)) return false;
    const kinds = mediaKindsFromRequestDetails(details);
    return kinds.every((kind) => {
      const status = getDesktopMediaAccessStatus(kind);
      return status === "granted" || status === "unknown";
    });
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== "media") {
      callback(false);
      return;
    }
    if (!isTrustedAppFrame(webContents, details)) {
      callback(false);
      return;
    }
    void requestDesktopMediaPermissions(mediaKindsFromRequestDetails(details)).then(
      (result) => callback(Boolean(result.ok)),
      () => callback(false)
    );
  });
}

function unsupportedDesktopUpdateReason() {
  if (!autoUpdater) return "electron_updater_missing";
  if (process.platform !== "darwin") return "macos_only";
  if (!app.isPackaged) return "not_packaged";
  if (!DESKTOP_UPDATE_CONFIG.feedUrl) return "feed_disabled";
  return "";
}

function isDesktopUpdateSupported() {
  return !unsupportedDesktopUpdateReason();
}

function sanitizeUpdateInfo(info) {
  if (!info || typeof info !== "object") return null;
  const files = Array.isArray(info.files)
    ? info.files.slice(0, 6).map((file) => ({
        url: String(file?.url || ""),
        sha512: String(file?.sha512 || ""),
        size: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0,
      }))
    : [];
  return {
    version: String(info.version || ""),
    releaseDate: String(info.releaseDate || ""),
    files,
  };
}

function sanitizeError(error) {
  const message = String(error?.message || error || "").replace(/\s+/g, " ").trim();
  return message.slice(0, 240);
}

function desktopUpdateSnapshot(patch = {}) {
  const reason = unsupportedDesktopUpdateReason();
  desktopUpdateStatus = {
    ...desktopUpdateStatus,
    appVersion: app.getVersion(),
    supported: !reason,
    reason,
    feedUrl: DESKTOP_UPDATE_CONFIG.feedUrl,
    autoCheck: DESKTOP_UPDATE_CONFIG.autoCheck,
    ...patch,
  };
  if (reason && (!patch.state || patch.state === "idle")) {
    desktopUpdateStatus.state = "disabled";
  }
  return desktopUpdateStatus;
}

function publishDesktopUpdateStatus(patch = {}) {
  const status = desktopUpdateSnapshot(patch);
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(DESKTOP_UPDATE_STATUS_CHANNEL, status);
    } catch {
      // ignore
    }
  }
  return status;
}

function configureDesktopUpdater() {
  if (desktopUpdaterConfigured) return Boolean(autoUpdater);
  desktopUpdaterConfigured = true;
  if (!autoUpdater) {
    desktopUpdateSnapshot({ state: "disabled", reason: "electron_updater_missing" });
    return false;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  if (DESKTOP_UPDATE_CONFIG.feedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: DESKTOP_UPDATE_CONFIG.feedUrl, channel: "latest" });
  }

  autoUpdater.on("checking-for-update", () => {
    publishDesktopUpdateStatus({ state: "checking", progress: null, error: "" });
  });
  autoUpdater.on("update-available", (info) => {
    publishDesktopUpdateStatus({ state: "available", updateInfo: sanitizeUpdateInfo(info), progress: null, error: "" });
  });
  autoUpdater.on("update-not-available", (info) => {
    publishDesktopUpdateStatus({ state: "not_available", updateInfo: sanitizeUpdateInfo(info), progress: null, error: "" });
  });
  autoUpdater.on("download-progress", (progress) => {
    publishDesktopUpdateStatus({
      state: "downloading",
      progress: {
        percent: Number.isFinite(Number(progress?.percent)) ? Number(progress.percent) : 0,
        transferred: Number.isFinite(Number(progress?.transferred)) ? Number(progress.transferred) : 0,
        total: Number.isFinite(Number(progress?.total)) ? Number(progress.total) : 0,
      },
      error: "",
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishDesktopUpdateStatus({ state: "ready", updateInfo: sanitizeUpdateInfo(info), progress: null, error: "" });
  });
  autoUpdater.on("error", (error) => {
    publishDesktopUpdateStatus({ state: "failed", progress: null, error: sanitizeError(error) || "update_failed" });
  });
  desktopUpdateSnapshot();
  return true;
}

function getDesktopUpdateStatus() {
  configureDesktopUpdater();
  return desktopUpdateSnapshot();
}

async function checkDesktopUpdates() {
  configureDesktopUpdater();
  if (!isDesktopUpdateSupported()) return publishDesktopUpdateStatus({ state: "disabled" });
  if (["checking", "downloading", "installing"].includes(desktopUpdateStatus.state)) return getDesktopUpdateStatus();
  publishDesktopUpdateStatus({ state: "checking", progress: null, error: "" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishDesktopUpdateStatus({ state: "failed", progress: null, error: sanitizeError(error) || "check_failed" });
  }
  return getDesktopUpdateStatus();
}

async function downloadDesktopUpdate() {
  configureDesktopUpdater();
  if (!isDesktopUpdateSupported()) return publishDesktopUpdateStatus({ state: "disabled" });
  if (desktopUpdateStatus.state !== "available") return getDesktopUpdateStatus();
  publishDesktopUpdateStatus({ state: "downloading", progress: null, error: "" });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    publishDesktopUpdateStatus({ state: "failed", progress: null, error: sanitizeError(error) || "download_failed" });
  }
  return getDesktopUpdateStatus();
}

function installDesktopUpdate() {
  configureDesktopUpdater();
  if (!isDesktopUpdateSupported()) return publishDesktopUpdateStatus({ state: "disabled" });
  if (desktopUpdateStatus.state !== "ready") return getDesktopUpdateStatus();
  const status = publishDesktopUpdateStatus({ state: "installing", progress: null, error: "" });
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      publishDesktopUpdateStatus({ state: "failed", error: sanitizeError(error) || "install_failed" });
    }
  }, 120);
  return status;
}

function maybeAutoCheckDesktopUpdates() {
  if (!DESKTOP_UPDATE_CONFIG.autoCheck) return;
  if (!isDesktopUpdateSupported()) return;
  setTimeout(() => {
    void checkDesktopUpdates();
  }, 5000);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolveWindowGeometry() {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
  const availableWidth = Math.max(860, workWidth - 32);
  const availableHeight = Math.max(660, workHeight - 48);
  const width = Math.min(availableWidth, clamp(Math.round(workWidth * 0.92), 1180, 1500));
  const height = Math.min(availableHeight, clamp(Math.round(workHeight * 0.9), 760, 980));
  return {
    width,
    height,
    minWidth: Math.min(width, 1080),
    minHeight: Math.min(height, 720),
  };
}

function shouldStartMaximized() {
  return !isTruthyEnv(process.env.YAGODKA_DESKTOP_DISABLE_MAXIMIZE);
}

function secureSessionPath() {
  return path.join(app.getPath("userData"), SECURE_SESSION_FILENAME);
}

function canUseTouchIdUnlock() {
  try {
    return (
      process.platform === "darwin" &&
      typeof systemPreferences.canPromptTouchID === "function" &&
      systemPreferences.canPromptTouchID() &&
      safeStorage.isEncryptionAvailable()
    );
  } catch {
    return false;
  }
}

function readSecureSessionPayload() {
  try {
    const raw = fs.readFileSync(secureSessionPath(), "utf8");
    const payload = JSON.parse(raw);
    const encrypted = String(payload?.token || "").trim();
    return encrypted ? encrypted : "";
  } catch {
    return "";
  }
}

function clearSecureSessionPayload() {
  try {
    fs.rmSync(secureSessionPath(), { force: true });
  } catch {
    // ignore
  }
}

function getDesktopRendererRecoveryState(win) {
  let state = desktopRendererRecovery.get(win);
  if (!state) {
    state = { attempts: 0, timer: null, stableTimer: null };
    desktopRendererRecovery.set(win, state);
  }
  return state;
}

function clearDesktopRendererRecoveryTimer(state, key) {
  if (!state?.[key]) return;
  clearTimeout(state[key]);
  state[key] = null;
}

function markDesktopRendererStableSoon(win) {
  const state = getDesktopRendererRecoveryState(win);
  clearDesktopRendererRecoveryTimer(state, "stableTimer");
  state.stableTimer = setTimeout(() => {
    state.stableTimer = null;
    state.attempts = 0;
  }, DESKTOP_RENDERER_STABLE_MS);
}

function desktopEntryQuery(opts = {}) {
  if (!opts.recovery) return undefined;
  return {
    desktop_recovery: "1",
    desktop_recovery_reason: String(opts.reason || "renderer"),
    desktop_recovery_attempt: String(opts.attempt || 0),
  };
}

function loadDesktopEntry(win, opts = {}) {
  const query = desktopEntryQuery(opts);
  if (app.isPackaged) {
    return win.loadFile(path.join(__dirname, "..", "dist", "index.html"), query ? { query } : undefined);
  }
  if (!query) return win.loadURL(DEV_URL);
  try {
    const url = new URL(DEV_URL);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return win.loadURL(url.href);
  } catch {
    return win.loadURL(DEV_URL);
  }
}

function shouldRecoverDesktopRenderer(reason) {
  const value = String(reason || "").trim().toLowerCase();
  if (!value || value === "clean-exit") return false;
  return true;
}

function recoverDesktopRenderer(win, details = {}) {
  if (!win || win.isDestroyed()) return;
  const reason = String(details.reason || details.type || "renderer").trim() || "renderer";
  if (!shouldRecoverDesktopRenderer(reason)) return;
  const state = getDesktopRendererRecoveryState(win);
  clearDesktopRendererRecoveryTimer(state, "timer");
  clearDesktopRendererRecoveryTimer(state, "stableTimer");
  state.attempts += 1;
  const attempt = state.attempts;
  console.warn("[desktop] renderer recovery scheduled", { attempt, reason, details });
  state.timer = setTimeout(() => {
    state.timer = null;
    if (win.isDestroyed()) return;
    void (async () => {
      try {
        await clearDesktopServiceWorkerState();
      } catch (error) {
        console.warn("[desktop] renderer recovery storage cleanup failed", sanitizeError(error));
      }
      if (win.isDestroyed()) return;
      if (attempt > DESKTOP_RENDERER_RECOVERY_MAX_ATTEMPTS) {
        console.error("[desktop] renderer recovery exhausted", { attempt, reason });
      }
      try {
        await loadDesktopEntry(win, { recovery: true, reason, attempt });
      } catch (error) {
        console.error("[desktop] renderer recovery reload failed", sanitizeError(error));
      }
    })();
  }, DESKTOP_RENDERER_RECOVERY_DELAY_MS);
}

function createWindow() {
  const appIcon = nativeImage.createFromPath(ICON_PATH);
  const geometry = resolveWindowGeometry();
  const win = new BrowserWindow({
    width: geometry.width,
    height: geometry.height,
    minWidth: geometry.minWidth,
    minHeight: geometry.minHeight,
    title: "Yagodka",
    backgroundColor: "#eef3f1",
    icon: appIcon.isEmpty() ? undefined : appIcon,
    show: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => {
    if (shouldStartMaximized()) win.maximize();
    win.show();
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[desktop] render-process-gone", details);
    recoverDesktopRenderer(win, details);
  });

  win.on("unresponsive", () => {
    recoverDesktopRenderer(win, { reason: "unresponsive" });
  });

  win.webContents.on("did-finish-load", () => {
    markDesktopRendererStableSoon(win);
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error("[desktop] did-fail-load", { errorCode, errorDescription, validatedURL });
    if (errorCode !== -3) {
      recoverDesktopRenderer(win, { reason: `load_failed_${errorCode}`, errorDescription, validatedURL });
    }
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 2) return;
    console.warn("[desktop:renderer]", { level, message, line, sourceId });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  void loadDesktopEntry(win);

  return win;
}

ipcMain.handle("yagodka:desktop-info", () => ({
  appId: APP_ID,
  appVersion: app.getVersion(),
  platform: process.platform,
  versions: process.versions,
  runtime: DESKTOP_RUNTIME_CONFIG,
  features: {
    touchId: canUseTouchIdUnlock(),
    mediaPermissions: true,
    desktopUpdates: Boolean(autoUpdater),
  },
  updates: getDesktopUpdateStatus(),
}));

ipcMain.handle("yagodka:desktop-updates-status", (event) => {
  if (!isAppUrl(event.senderFrame?.url || event.sender?.getURL?.())) {
    return { state: "disabled", supported: false, reason: "untrusted_sender" };
  }
  return getDesktopUpdateStatus();
});

ipcMain.handle("yagodka:desktop-updates-check", (event) => {
  if (!isAppUrl(event.senderFrame?.url || event.sender?.getURL?.())) {
    return { state: "disabled", supported: false, reason: "untrusted_sender" };
  }
  return checkDesktopUpdates();
});

ipcMain.handle("yagodka:desktop-updates-download", (event) => {
  if (!isAppUrl(event.senderFrame?.url || event.sender?.getURL?.())) {
    return { state: "disabled", supported: false, reason: "untrusted_sender" };
  }
  return downloadDesktopUpdate();
});

ipcMain.handle("yagodka:desktop-updates-install", (event) => {
  if (!isAppUrl(event.senderFrame?.url || event.sender?.getURL?.())) {
    return { state: "disabled", supported: false, reason: "untrusted_sender" };
  }
  return installDesktopUpdate();
});

ipcMain.handle("yagodka:media-permissions-status", (event, rawKinds) => {
  if (!isAppUrl(event.senderFrame?.url || event.sender?.getURL?.())) {
    return { ok: false, reason: "untrusted_sender", permissions: {}, platform: process.platform };
  }
  return getDesktopMediaPermissionSummary(rawKinds);
});

ipcMain.handle("yagodka:media-permissions-request", async (event, rawKinds) => {
  if (!isAppUrl(event.senderFrame?.url || event.sender?.getURL?.())) {
    return { ok: false, reason: "untrusted_sender", permissions: {}, platform: process.platform };
  }
  return requestDesktopMediaPermissions(rawKinds);
});

ipcMain.handle("yagodka:media-open-settings", (event, rawKind) => {
  if (!isAppUrl(event.senderFrame?.url || event.sender?.getURL?.())) {
    return { ok: false, reason: "untrusted_sender" };
  }
  return { ok: openDesktopMediaSettings(rawKind) };
});

ipcMain.handle("yagodka:secure-session-save", async (_event, rawToken) => {
  const token = normalizeSessionToken(rawToken);
  if (!token) return { ok: false, reason: "bad_token" };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: "safe_storage_unavailable" };
  try {
    fs.mkdirSync(path.dirname(secureSessionPath()), { recursive: true });
    const encrypted = safeStorage.encryptString(token).toString("base64");
    fs.writeFileSync(
      secureSessionPath(),
      JSON.stringify({ version: 1, token: encrypted, updatedAt: new Date().toISOString() }),
      { mode: 0o600 }
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
});

ipcMain.handle("yagodka:secure-session-has", async () => ({
  ok: true,
  available: Boolean(readSecureSessionPayload()),
  touchId: canUseTouchIdUnlock(),
}));

ipcMain.handle("yagodka:secure-session-clear", async () => {
  clearSecureSessionPayload();
  return { ok: true };
});

ipcMain.handle("yagodka:secure-session-unlock", async (_event, reasonRaw) => {
  const encrypted = readSecureSessionPayload();
  if (!encrypted) return { ok: false, reason: "no_session" };
  if (!canUseTouchIdUnlock()) return { ok: false, reason: "touch_id_unavailable" };
  try {
    const reason = String(reasonRaw || "").trim() || "Войти в Ягодку";
    await systemPreferences.promptTouchID(reason);
    const token = normalizeSessionToken(safeStorage.decryptString(Buffer.from(encrypted, "base64")));
    if (!token) {
      clearSecureSessionPayload();
      return { ok: false, reason: "bad_token" };
    }
    return { ok: true, token };
  } catch {
    return { ok: false, reason: "touch_id_cancelled" };
  }
});

ipcMain.on("yagodka:set-unread-count", (_event, value) => {
  const count = Number.parseInt(String(value ?? "0"), 10);
  app.setBadgeCount(Number.isFinite(count) && count > 0 ? count : 0);
});

app.whenReady().then(async () => {
  configureDesktopUpdater();
  installDesktopRequestHeaders();
  installDesktopMediaPermissions();
  await clearDesktopServiceWorkerState();
  createWindow();
  maybeAutoCheckDesktopUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
