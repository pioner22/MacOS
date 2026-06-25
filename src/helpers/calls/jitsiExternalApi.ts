export type JitsiMeetExternalApiCtor = new (domain: string, options: any) => any;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiMeetExternalApiCtor;
  }
}

function stripTrailingSlashes(value: string): string {
  return String(value || "").replace(/\/+$/, "");
}

export function resolveJitsiApiDomain(meetBaseUrl: string): string | null {
  const raw = String(meetBaseUrl || "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname;
    if (!host) return null;
    return host;
  } catch {
    return null;
  }
}

export function resolveJitsiExternalApiScriptUrl(meetBaseUrl: string): string | null {
  const domain = resolveJitsiApiDomain(meetBaseUrl);
  if (!domain) return null;
  return `https://${domain}/external_api.js`;
}

const scriptCache = new Map<string, Promise<JitsiMeetExternalApiCtor | null>>();

export function loadJitsiExternalApi(scriptUrl: string): Promise<JitsiMeetExternalApiCtor | null> {
  const url = stripTrailingSlashes(String(scriptUrl || "").trim());
  if (!url) return Promise.resolve(null);
  const win = typeof window !== "undefined" ? window : null;
  const existing = win?.JitsiMeetExternalAPI;
  if (existing) return Promise.resolve(existing);

  const cached = scriptCache.get(url);
  if (cached) return cached;

  const p = new Promise<JitsiMeetExternalApiCtor | null>((resolve) => {
    if (!win || typeof document === "undefined") {
      resolve(null);
      return;
    }
    const s = document.createElement("script");
    s.async = true;
    s.defer = true;
    s.src = url;
    s.onload = () => {
      resolve(win.JitsiMeetExternalAPI ?? null);
    };
    s.onerror = () => {
      resolve(null);
    };
    document.head.appendChild(s);
  });
  scriptCache.set(url, p);
  return p;
}
