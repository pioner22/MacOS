import {
  canUseDesktopBiometricUnlock,
  getStoredSessionToken,
  hasDesktopBiometricSession,
  isSessionAutoAuthBlocked,
  unlockDesktopBiometricSession,
} from "../../../helpers/auth/session";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface AuthFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
}

export interface AuthFeature {
  resetAutoAuthAttempt: () => void;
  maybeAutoAuthOnConnected: () => void;
  authLoginFromDom: () => void;
  authRegisterFromDom: () => void;
  authTouchIdFromDom: () => void;
}

export function createAuthFeature(deps: AuthFeatureDeps): AuthFeature {
  const { store, send } = deps;

  let autoAuthAttemptedForConn = false;

  function resetAutoAuthAttempt() {
    autoAuthAttemptedForConn = false;
  }

  function maybeAutoAuthOnConnected() {
    const st = store.get();
    if (!st.netLeader) return;
    if (st.authed) return;
    const token = getStoredSessionToken();
    if (token && isSessionAutoAuthBlocked()) {
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        status: "Сессия уже используется в другом окне. Чтобы продолжить здесь, подтвердите вход ещё раз.",
      }));
      return;
    }
    if (token && !autoAuthAttemptedForConn) {
      autoAuthAttemptedForConn = true;
      store.set({ status: "Пробуем восстановить сохранённую сессию…" });
      send({ type: "auth", session: token });
      return;
    }
    if (token && autoAuthAttemptedForConn) {
      return;
    }
    if (!token && canUseDesktopBiometricUnlock()) {
      void hasDesktopBiometricSession().then((available) => {
        if (!available) return;
        const latest = store.get();
        if (latest.authed || latest.conn !== "connected") return;
        store.set((prev) => ({
          ...prev,
          authMode: prev.authRememberedId ? "login" : "register",
          status: "Соединение установлено. Можно войти по Touch ID или ручному ключу.",
        }));
      });
    }
    store.set((prev) => ({
      ...prev,
      authMode: prev.authRememberedId ? "login" : "register",
      status: prev.authRememberedId
        ? "Соединение установлено. Введите ручной ключ, чтобы продолжить вход."
        : "Соединение установлено. Можно войти в существующий аккаунт или создать новый.",
    }));
  }

  function authLoginFromDom() {
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения с сервером" });
      return;
    }
    const id = (document.getElementById("auth-id") as HTMLInputElement | null)?.value?.trim() ?? "";
    const pw = (document.getElementById("auth-manual-entry") as HTMLInputElement | null)?.value ?? "";
    if (!id) {
      store.set({ modal: { kind: "auth", message: "Введите ID" } });
      return;
    }
    if (!pw) {
      store.set({ modal: { kind: "auth", message: "Введите ручной ключ" } });
      return;
    }
    send({ type: "auth", id, password: pw });
  }

  function authRegisterFromDom() {
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения с сервером" });
      return;
    }
    const pw1 = (document.getElementById("auth-manual-entry-a") as HTMLInputElement | null)?.value ?? "";
    const pw2 = (document.getElementById("auth-manual-entry-b") as HTMLInputElement | null)?.value ?? "";
    const pw = pw1;
    if (!pw) {
      store.set({ modal: { kind: "auth", message: "Введите ручной ключ для регистрации" } });
      return;
    }
    if (pw1 !== pw2) {
      store.set({ modal: { kind: "auth", message: "Значения ручного ввода не совпадают" } });
      return;
    }
    send({ type: "register", password: pw });
  }

  async function authTouchIdFromDom() {
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения с сервером" });
      return;
    }
    if (!canUseDesktopBiometricUnlock()) {
      store.set({ modal: { kind: "auth", message: "Touch ID доступен только в desktop-приложении на macOS." } });
      return;
    }
    store.set({ status: "Подтвердите Touch ID, чтобы открыть сохранённую сессию…" });
    const token = await unlockDesktopBiometricSession("Войти в Ягодку");
    if (!token) {
      store.set({ modal: { kind: "auth", message: "Не удалось войти по Touch ID. Используйте ручной ввод." } });
      return;
    }
    autoAuthAttemptedForConn = true;
    send({ type: "auth", session: token });
  }

  return { resetAutoAuthAttempt, maybeAutoAuthOnConnected, authLoginFromDom, authRegisterFromDom, authTouchIdFromDom };
}
