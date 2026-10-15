import { getPublicBaseUrl } from "../../config/env";
import { isCapacitorNativeRuntime } from "../runtime/nativeRuntime";

export interface FileHttpAuthResult {
  url: string;
  headers: Record<string, string>;
}

const FILE_HTTP_BEARER_MAX = 512;
const fileHttpBearerByUrl = new Map<string, string>();

function isFileBase(rawBase: string): boolean {
  try {
    return new URL(rawBase).protocol === "file:";
  } catch {
    return false;
  }
}

function isNativeLoopbackBase(rawBase: string): boolean {
  if (!isCapacitorNativeRuntime()) return false;
  try {
    const parsed = new URL(rawBase);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = String(parsed.hostname || "").trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function readLocationHref(): string {
  try {
    return typeof globalThis.location?.href === "string" ? globalThis.location.href.trim() : "";
  } catch {
    return "";
  }
}

function resolveBase(base?: string | null): string {
  const candidate = String(base ?? "").trim() || readLocationHref();
  if (candidate && !isFileBase(candidate) && !isNativeLoopbackBase(candidate)) return candidate;
  return getPublicBaseUrl() || "http://localhost/";
}

function trimToken(raw: string | null | undefined): string {
  return String(raw || "").trim();
}

function normalizeUrl(rawUrl: string, base?: string | null): string {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, resolveBase(base)).toString();
  } catch {
    return raw;
  }
}

function setRuntimeBearer(normalizedUrl: string, token: string): void {
  const url = String(normalizedUrl || "").trim();
  const bearer = trimToken(token);
  if (!url || !bearer) return;
  fileHttpBearerByUrl.delete(url);
  fileHttpBearerByUrl.set(url, bearer);
  while (fileHttpBearerByUrl.size > FILE_HTTP_BEARER_MAX) {
    const oldest = fileHttpBearerByUrl.keys().next().value;
    if (!oldest) break;
    fileHttpBearerByUrl.delete(oldest);
  }
}

export function rememberFileHttpBearer(rawUrl: string, token: string, opts?: { base?: string | null }): string {
  const normalizedUrl = normalizeUrl(rawUrl, opts?.base);
  const bearer = trimToken(token);
  if (!normalizedUrl || !bearer) return normalizedUrl;
  setRuntimeBearer(normalizedUrl, bearer);
  return normalizedUrl;
}

export function liftFileHttpTokenToBearer(rawUrl: string, opts?: { base?: string | null }): FileHttpAuthResult {
  const raw = String(rawUrl || "").trim();
  if (!raw) return { url: "", headers: {} };
  const base = resolveBase(opts?.base);
  try {
    const parsed = new URL(raw, base);
    const hadLegacyQueryToken = parsed.searchParams.has("t") || parsed.searchParams.has("token");
    parsed.searchParams.delete("t");
    parsed.searchParams.delete("token");
    const cleanUrl = parsed.toString();
    const runtimeToken = trimToken(fileHttpBearerByUrl.get(cleanUrl));
    if (!runtimeToken) {
      // Legacy signed query tokens are stripped from the URL but never promoted to headers.
      if (hadLegacyQueryToken) return { url: cleanUrl, headers: {} };
      return { url: cleanUrl, headers: {} };
    }
    return {
      url: cleanUrl,
      headers: { Authorization: `Bearer ${runtimeToken}` },
    };
  } catch {
    return { url: raw, headers: {} };
  }
}
