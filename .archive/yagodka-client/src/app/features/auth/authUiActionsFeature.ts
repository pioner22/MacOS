import type { Store } from "../../../stores/store";
import type { AppState, ThemeMode } from "../../../stores/types";
import { clearStoredAuthAll } from "../../../helpers/auth/session";
import { closeModalState, openAuthModal } from "../../../helpers/navigation/appShellState";
import { getPublicBaseUrl } from "../../../config/env";
import { getCapacitorPlatform, isCapacitorNativeRuntime } from "../../../helpers/runtime/nativeRuntime";

export interface AuthUiActionsFeatureDeps {
  store: Store<AppState>;
  logout: () => void;
  authLoginFromDom: () => void;
  authRegisterFromDom: () => void;
  authTouchIdFromDom?: () => void;
  closeModal: () => void;
  forceUpdateReload: (reason: string) => void;
  applyPwaUpdateNow: () => Promise<void> | void;
  deferPwaUpdate: () => void;
  setSkin: (skinId: string) => void;
  setTheme: (theme: ThemeMode) => void;
}

export interface AuthUiActionsFeature {
  onAuthOpen: () => void;
  onAuthLogout: () => void;
  onAuthLogin: () => void;
  onAuthRegister: () => void;
  onAuthTouchId: () => void;
  onAuthModeChange: (mode: "register" | "login") => void;
  onAuthUseDifferentAccount: () => void;
  onCloseModal: () => void;
  onDismissUpdate: () => void;
  onReloadUpdate: () => void;
  onApplyPwaUpdate: () => void;
  onDeferPwaUpdate: () => void;
  onSkinChange: (skinId: string) => void;
  onThemeChange: (theme: ThemeMode) => void;
}

function getAndroidApkDownloadUrl(): string {
  try {
    return new URL("downloads/android/yagodka-android-debug.apk", getPublicBaseUrl() || "https://yagodka.org/").href;
  } catch {
    return "https://yagodka.org/downloads/android/yagodka-android-debug.apk";
  }
}

function openExternalUrl(url: string): void {
  try {
    const opened = window.open(url, "_system", "noopener,noreferrer");
    if (opened) return;
  } catch {
    // Fall through to same-window navigation.
  }
  try {
    window.location.href = url;
  } catch {
    // ignore
  }
}

export function createAuthUiActionsFeature(deps: AuthUiActionsFeatureDeps): AuthUiActionsFeature {
  const {
    store,
    logout,
    authLoginFromDom,
    authRegisterFromDom,
    authTouchIdFromDom,
    closeModal,
    forceUpdateReload,
    applyPwaUpdateNow,
    deferPwaUpdate,
    setSkin,
    setTheme,
  } = deps;

  const onAuthOpen = () => store.set((prev) => openAuthModal(prev, { mode: prev.authRememberedId ? "login" : "register" }));

  const onAuthLogout = () => logout();

  const onAuthLogin = () => authLoginFromDom();

  const onAuthRegister = () => authRegisterFromDom();

  const onAuthTouchId = () => authTouchIdFromDom?.();

  const onAuthModeChange = (mode: "register" | "login") => {
    store.set((prev) => openAuthModal(prev, { mode }));
  };

  const onAuthUseDifferentAccount = () => {
    clearStoredAuthAll();
    store.set((prev) =>
      openAuthModal(
        {
          ...prev,
          authRememberedId: null,
        },
        { mode: "login", status: "Введите ID или @логин, чтобы войти в другой аккаунт." }
      )
    );
  };

  const onCloseModal = () => closeModal();

  const onDismissUpdate = () => {
    store.set((prev) => closeModalState(prev, { dismissUpdate: true }));
  };

  const onReloadUpdate = () => {
    if (isCapacitorNativeRuntime() && getCapacitorPlatform() === "android") {
      const url = getAndroidApkDownloadUrl();
      store.set((prev) => ({
        ...closeModalState(prev),
        status: "Скачайте обновлённый Android APK и установите его поверх текущей версии.",
      }));
      openExternalUrl(url);
      return;
    }
    forceUpdateReload("update_required");
  };

  const onApplyPwaUpdate = () => {
    void applyPwaUpdateNow();
  };

  const onDeferPwaUpdate = () => {
    deferPwaUpdate();
  };

  const onSkinChange = (skinId: string) => setSkin(skinId);

  const onThemeChange = (theme: ThemeMode) => setTheme(theme);

  return {
    onAuthOpen,
    onAuthLogout,
    onAuthLogin,
    onAuthRegister,
    onAuthTouchId,
    onAuthModeChange,
    onAuthUseDifferentAccount,
    onCloseModal,
    onDismissUpdate,
    onReloadUpdate,
    onApplyPwaUpdate,
    onDeferPwaUpdate,
    onSkinChange,
    onThemeChange,
  };
}
