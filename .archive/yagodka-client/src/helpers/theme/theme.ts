import { normalizeSkinId } from "../skin/skin";
import { scheduleChromeColorSync } from "../ui/chromeColors";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "yagodka_theme";
const LIGHT_SKINS = new Set(["yagodka-modern", "telegram-exact"]);

function normalizeTheme(input: unknown): ThemeMode | null {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "light" || raw === "dark") return raw;
  return null;
}

export function getStoredTheme(): ThemeMode | null {
  try {
    return normalizeTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function resolveInitialTheme(skinId: string): ThemeMode {
  const stored = getStoredTheme();
  if (stored) return stored;
  const normSkin = normalizeSkinId(skinId);
  return LIGHT_SKINS.has(normSkin) ? "light" : "dark";
}

export function storeTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

export function applyTheme(theme: ThemeMode): void {
  try {
    document.documentElement.dataset.theme = theme;
  } catch {
    // ignore
  }
  scheduleChromeColorSync();
}
