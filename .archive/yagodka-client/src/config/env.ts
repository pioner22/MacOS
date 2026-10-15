import { getNativeRuntimeConfig, isCapacitorNativeRuntime } from "../helpers/runtime/nativeRuntime";

interface DesktopRuntimeConfig {
  gatewayUrl?: unknown;
  publicBaseUrl?: unknown;
  meetBaseUrl?: unknown;
}

interface DesktopBridge {
  config?: DesktopRuntimeConfig;
}

const DEFAULT_NATIVE_GATEWAY_URL = "wss://yagodka.org/ws";
const DEFAULT_NATIVE_PUBLIC_BASE_URL = "https://yagodka.org/";
const DEFAULT_NATIVE_MEET_BASE_URL = "https://meet.yagodka.org";

function getEnv(): Record<string, unknown> {
  return ((import.meta as any).env || {}) as Record<string, unknown>;
}

function readEnvString(name: string): string {
  return String(getEnv()[name] ?? "").trim();
}

function getDesktopRuntimeConfig(): DesktopRuntimeConfig {
  const bridge = (globalThis as typeof globalThis & { yagodkaDesktop?: DesktopBridge }).yagodkaDesktop;
  return bridge?.config && typeof bridge.config === "object" ? bridge.config : {};
}

function parseUrl(rawUrl: unknown): URL | null {
  try {
    return new URL(String(rawUrl ?? "").trim());
  } catch {
    return null;
  }
}

function isProtocol(target: URL | null, protocols: readonly string[]): target is URL {
  return Boolean(target && protocols.includes(target.protocol));
}

function normalizeHttpBaseUrl(rawUrl: unknown): string {
  const target = parseUrl(rawUrl);
  if (!isProtocol(target, ["http:", "https:"])) return "";
  target.hash = "";
  target.search = "";
  if (!target.pathname.endsWith("/")) target.pathname = `${target.pathname}/`;
  return target.href;
}

function normalizeWsUrl(rawUrl: unknown): string {
  const target = parseUrl(rawUrl);
  if (!isProtocol(target, ["ws:", "wss:"])) return "";
  return target.href;
}

export function getGatewayUrl(): string {
  const env = getEnv();
  const u = readEnvString("VITE_GATEWAY_URL");
  if (u) return u;

  const desktopGatewayUrl = normalizeWsUrl(getDesktopRuntimeConfig().gatewayUrl);
  if (desktopGatewayUrl) return desktopGatewayUrl;

  if (isCapacitorNativeRuntime()) {
    return normalizeWsUrl(getNativeRuntimeConfig().gatewayUrl) || DEFAULT_NATIVE_GATEWAY_URL;
  }

  try {
    const loc = globalThis.location;
    if (!loc || typeof loc.hostname !== "string" || !loc.hostname) throw new Error("no location");

    const proto = loc.protocol === "https:" ? "wss:" : "ws:";

    // Dev default: Vite/preview runs on a separate port; gateway is usually on :8787.
    // Use current hostname so LAN devices can connect (e.g. phone to 192.168.x.x:8787).
    if (env.DEV || (loc.port && loc.port !== "80" && loc.port !== "443")) {
      return `${proto}//${loc.hostname}:8787/ws`;
    }

    // Production default: same host (no extra port), /ws, matching page scheme (https -> wss).
    if (typeof loc.host === "string" && loc.host) {
      return `${proto}//${loc.host}/ws`;
    }
  } catch {
    // ignore
  }

  // Dev/CLI fallback.
  return "ws://127.0.0.1:8787/ws";
}

export function getPublicBaseUrl(): string {
  const u = normalizeHttpBaseUrl(readEnvString("VITE_PUBLIC_BASE_URL"));
  if (u) return u;

  const desktopPublicBaseUrl = normalizeHttpBaseUrl(getDesktopRuntimeConfig().publicBaseUrl);
  if (desktopPublicBaseUrl) return desktopPublicBaseUrl;

  if (isCapacitorNativeRuntime()) {
    return normalizeHttpBaseUrl(getNativeRuntimeConfig().publicBaseUrl) || DEFAULT_NATIVE_PUBLIC_BASE_URL;
  }

  try {
    const loc = globalThis.location;
    const proto = typeof loc?.protocol === "string" ? loc.protocol : "";
    const origin = typeof loc?.origin === "string" ? loc.origin : "";
    if ((proto === "http:" || proto === "https:") && origin) {
      return `${origin.replace(/\/+$/, "")}/`;
    }
  } catch {
    // ignore
  }

  return "";
}

export function getMeetBaseUrl(): string {
  const env = getEnv();
  const u = readEnvString("VITE_MEET_URL");
  if (u) return u.replace(/\/+$/, "");

  const desktopMeetBaseUrl = normalizeHttpBaseUrl(getDesktopRuntimeConfig().meetBaseUrl);
  if (desktopMeetBaseUrl) return desktopMeetBaseUrl.replace(/\/+$/, "");

  if (isCapacitorNativeRuntime()) {
    const nativeMeetBaseUrl = normalizeHttpBaseUrl(getNativeRuntimeConfig().meetBaseUrl);
    return (nativeMeetBaseUrl || DEFAULT_NATIVE_MEET_BASE_URL).replace(/\/+$/, "");
  }

  if (env.DEV) {
    return "https://meet.yagodka.org";
  }

  // Production default: stable, branded meet domain.
  // Uses runtime hostname so the Node/test environment keeps returning "".
  try {
    const loc = globalThis.location;
    const hostname = typeof loc?.hostname === "string" ? loc.hostname : "";
    if (hostname === "yagodka.org" || hostname === "www.yagodka.org") {
      return "https://meet.yagodka.org";
    }
  } catch {
    // ignore
  }

  return "";
}
