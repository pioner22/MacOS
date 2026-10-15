import {
  DEFAULT_SKIN_ID,
  applySkin,
  fetchAvailableSkins,
  normalizeSkinId,
  storeSkinId,
} from "../../../helpers/skin/skin";
import { applyTheme, storeTheme } from "../../../helpers/theme/theme";
import type { Store } from "../../../stores/store";
import type { AppState, ThemeMode } from "../../../stores/types";

export interface ThemeSkinActionsFeature {
  initSkins: () => Promise<void>;
  setTheme: (mode: ThemeMode) => void;
  setSkin: (id: string) => void;
}

export interface ThemeSkinActionsFeatureDeps {
  store: Store<AppState>;
}

export function createThemeSkinActionsFeature(deps: ThemeSkinActionsFeatureDeps): ThemeSkinActionsFeature {
  const { store } = deps;

  async function initSkins() {
    const skins = await fetchAvailableSkins();
    if (!skins) return;
    store.set({ skins });
    const current = normalizeSkinId(store.get().skin);
    if (!skins.some((s) => s.id === current)) {
      store.set({ skin: DEFAULT_SKIN_ID });
      storeSkinId(DEFAULT_SKIN_ID);
      applySkin(DEFAULT_SKIN_ID);
    }
  }

  function setTheme(mode: ThemeMode) {
    const theme: ThemeMode = mode === "light" ? "light" : "dark";
    store.set({ theme, status: `Тема: ${theme === "light" ? "светлая" : "тёмная"}` });
    storeTheme(theme);
    applyTheme(theme);
  }

  function setSkin(id: string) {
    const norm = normalizeSkinId(id);
    const skins = store.get().skins || [];
    const exists = skins.some((s) => s.id === norm);
    const finalId = exists ? norm : DEFAULT_SKIN_ID;
    const title = skins.find((s) => s.id === finalId)?.title ?? finalId;
    store.set({ skin: finalId, status: `Скин: ${title}` });
    storeSkinId(finalId);
    applySkin(finalId);
  }

  return {
    initSkins,
    setTheme,
    setSkin,
  };
}
