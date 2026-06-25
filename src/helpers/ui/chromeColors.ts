let pendingSync = false;
let lastColor = "";
const AUTH_CHROME_COLOR = "#eaf5f0";

function readCssVar(style: CSSStyleDeclaration, name: string): string {
  const raw = style.getPropertyValue(name);
  return raw ? raw.trim() : "";
}

function isChromeColor(value: string): boolean {
  return /^(#[0-9a-f]{3,8}|rgb\(|rgba\(|hsl\(|hsla\()/i.test(value.trim());
}

function resolveCssColor(style: CSSStyleDeclaration, value: string, seen = new Set<string>()): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (isChromeColor(raw)) return raw;
  const match = raw.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*(.+))?\)$/);
  if (!match) return null;
  const name = match[1];
  if (seen.has(name)) return null;
  seen.add(name);
  const direct = readCssVar(style, name);
  const resolved = resolveCssColor(style, direct, seen);
  if (resolved) return resolved;
  return resolveCssColor(style, match[2] || "", seen);
}

function readResolvedCssColor(style: CSSStyleDeclaration, name: string): string | null {
  return resolveCssColor(style, readCssVar(style, name));
}

function resolveChromeColor(style: CSSStyleDeclaration): string | null {
  if (document.documentElement.classList.contains("has-auth-pages")) {
    return readResolvedCssColor(style, "--app-host-canvas-bg") || readResolvedCssColor(style, "--safe-area-bg") || AUTH_CHROME_COLOR;
  }
  const candidates = ["--app-host-canvas-bg", "--safe-area-bg", "--app-bg", "--bg", "--sidebar-bg"];
  for (const name of candidates) {
    const value = readResolvedCssColor(style, name);
    if (value) return value;
  }
  return null;
}

function setMeta(name: string, value: string): void {
  const meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!meta) return;
  if (meta.content !== value) meta.setAttribute("content", value);
}

function setMaskIconColor(value: string): void {
  const link = document.querySelector('link[rel="mask-icon"]') as HTMLLinkElement | null;
  if (!link) return;
  if (link.getAttribute("color") !== value) link.setAttribute("color", value);
}

export function syncChromeColors(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return;
  const style = window.getComputedStyle(root);
  const color = resolveChromeColor(style);
  if (!color || color === lastColor) return;
  lastColor = color;
  setMeta("theme-color", color);
  setMaskIconColor(color);
}

export function scheduleChromeColorSync(): void {
  if (pendingSync) return;
  pendingSync = true;
  const run = () => {
    pendingSync = false;
    syncChromeColors();
  };
  if (typeof window === "undefined") {
    run();
    return;
  }
  try {
    window.requestAnimationFrame(run);
  } catch {
    run();
  }
  window.setTimeout(run, 60);
  window.setTimeout(run, 220);
}
