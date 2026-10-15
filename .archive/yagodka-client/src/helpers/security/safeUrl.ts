export type SafeUrlProtocol = "http:" | "https:" | "blob:";

export interface SafeUrlOptions {
  base: string;
  allowedProtocols: SafeUrlProtocol[];
}

export function safeUrl(raw: string, options: SafeUrlOptions): string | null {
  const url = String(raw || "").trim();
  if (!url) return null;
  try {
    const parsed = new URL(url, options.base);
    const protocol = parsed.protocol as SafeUrlProtocol;
    if (!options.allowedProtocols.includes(protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

