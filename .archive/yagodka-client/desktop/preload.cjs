const { contextBridge, ipcRenderer } = require("electron");

const DEFAULT_GATEWAY_URL = "wss://yagodka.org/ws";
const DEFAULT_PUBLIC_BASE_URL = "https://yagodka.org/";
const DEFAULT_MEET_BASE_URL = "https://meet.yagodka.org";
const DESKTOP_UPDATE_STATUS_CHANNEL = "yagodka:desktop-update-status";

function normalizeUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || ""));
  } catch {
    return null;
  }
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

function normalizeWsUrl(rawUrl, fallbackUrl) {
  const target = normalizeUrl(rawUrl);
  if (!isWsUrl(target)) return fallbackUrl;
  return target.href;
}

const runtimeConfig = Object.freeze({
  gatewayUrl: normalizeWsUrl(process.env.YAGODKA_DESKTOP_GATEWAY_URL, DEFAULT_GATEWAY_URL),
  publicBaseUrl: normalizeHttpBaseUrl(process.env.YAGODKA_DESKTOP_PUBLIC_BASE_URL, DEFAULT_PUBLIC_BASE_URL),
  meetBaseUrl: normalizeHttpBaseUrl(process.env.YAGODKA_DESKTOP_MEET_URL, DEFAULT_MEET_BASE_URL).replace(/\/+$/, ""),
});

const features = Object.freeze({
  touchId: process.platform === "darwin",
  mediaPermissions: true,
  desktopUpdates: true,
});

function normalizeMediaKind(rawKind) {
  const kind = String(rawKind || "").trim().toLowerCase();
  if (kind === "camera" || kind === "microphone") return kind;
  return "";
}

function normalizeMediaKinds(rawKinds) {
  const source = Array.isArray(rawKinds) ? rawKinds : [rawKinds];
  const kinds = [];
  for (const rawKind of source) {
    const kind = normalizeMediaKind(rawKind);
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

contextBridge.exposeInMainWorld("yagodkaDesktop", {
  config: runtimeConfig,
  features,
  getInfo: () => ipcRenderer.invoke("yagodka:desktop-info"),
  updates: {
    getStatus: () => ipcRenderer.invoke("yagodka:desktop-updates-status"),
    check: () => ipcRenderer.invoke("yagodka:desktop-updates-check"),
    download: () => ipcRenderer.invoke("yagodka:desktop-updates-download"),
    install: () => ipcRenderer.invoke("yagodka:desktop-updates-install"),
    onStatus: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, status) => callback(status);
      ipcRenderer.on(DESKTOP_UPDATE_STATUS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(DESKTOP_UPDATE_STATUS_CHANNEL, listener);
    },
  },
  mediaPermissions: {
    getStatus: (kinds) => ipcRenderer.invoke("yagodka:media-permissions-status", normalizeMediaKinds(kinds)),
    request: (kinds) => ipcRenderer.invoke("yagodka:media-permissions-request", normalizeMediaKinds(kinds)),
    openSettings: (kind) => ipcRenderer.invoke("yagodka:media-open-settings", normalizeMediaKind(kind)),
  },
  saveSessionToken: (token) => ipcRenderer.invoke("yagodka:secure-session-save", String(token || "")),
  hasSessionToken: () => ipcRenderer.invoke("yagodka:secure-session-has"),
  unlockSession: (reason) => ipcRenderer.invoke("yagodka:secure-session-unlock", String(reason || "")),
  clearSessionToken: () => ipcRenderer.invoke("yagodka:secure-session-clear"),
  setUnreadCount: (count) => {
    const normalized = Number.parseInt(String(count ?? "0"), 10);
    ipcRenderer.send("yagodka:set-unread-count", Number.isFinite(normalized) ? normalized : 0);
  },
});
