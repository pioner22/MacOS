import type { GatewayTransport } from "../../lib/net/gatewayClient";
import type { AppState } from "../../stores/types";
import {
  blockSessionAutoAuth,
  clearSessionAutoAuthBlock,
  clearStoredSessionToken,
  getStoredAuthId,
  getStoredSessionToken,
  storeAuthId,
  storeSessionToken,
} from "../../helpers/auth/session";
import { buildClientInfoTags } from "../../helpers/device/clientTags";
import { resetNavigationState } from "../../helpers/navigation/viewState";
import { resetSidebarState } from "../../helpers/sidebar/sidebarState";
import { clearOutboxForUser } from "../../helpers/pwa/outboxSync";
import { loadLastReadMarkers } from "../../helpers/ui/lastReadMarkers";

export function handleCoreAuthMessage(
  t: string,
  msg: any,
  state: AppState,
  gateway: GatewayTransport,
  patch: (p: Partial<AppState> | ((prev: AppState) => AppState)) => void
): boolean {
  if (t === "welcome") {
    const sv = typeof msg?.server_version === "string" ? msg.server_version : state.serverVersion;
    const pushKey = typeof msg?.pwa_push_public_key === "string" ? String(msg.pwa_push_public_key).trim() : "";
    const pushPermission = (() => {
      try {
        return (Notification?.permission ?? state.pwaPushPermission ?? "default") as "default" | "granted" | "denied";
      } catch {
        return state.pwaPushPermission ?? "default";
      }
    })();
    patch({
      serverVersion: sv,
      status: "Связь с сервером установлена",
      pwaPushPermission: pushPermission,
      ...(pushKey ? { pwaPushPublicKey: pushKey } : {}),
    });
    return true;
  }
  if (t === "session_replaced") {
    // Важно: не чистим общий session token в localStorage/cookie — он общий для вкладок/PWA.
    // Иначе “победившая” вкладка тоже потеряет автовход. Вместо этого блокируем автовход
    // только для текущей вкладки (sessionStorage) и просим войти вручную, если нужно.
    blockSessionAutoAuth();
    patch((prev) => ({
      ...resetSidebarState(resetNavigationState(prev, { page: "main" })),
      authed: false,
      rosterSync: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastPresenceAt: null },
      profileSync: {},
      authMode: getStoredAuthId() ? "login" : "register",
      sessionDevices: [],
      sessionDevicesStatus: null,
      // “В тишине”: не открываем модалку автоматически.
      status: "Эта сессия уже активна в другом окне. Чтобы продолжить здесь, войдите ещё раз.",
    }));
    return true;
  }
  if (t === "auth_ok") {
    const selfId = String(msg?.id ?? state.selfId ?? "");
    const sess = typeof msg?.session === "string" ? msg.session : null;
    const lastRead = selfId ? loadLastReadMarkers(selfId) : state.lastRead;
    if (selfId) storeAuthId(selfId);
    if (sess) storeSessionToken(sess);
    else {
      // Keep the existing session-scoped token normalized and migrated out of legacy persistence.
      const existing = getStoredSessionToken();
      if (existing) storeSessionToken(existing);
    }
    clearSessionAutoAuthBlock();
    patch({
      authed: true,
      selfId,
      authRememberedId: selfId || state.authRememberedId,
      ...(sess ? { authMode: "auto" as const } : {}),
      modal: null,
      status: "Вы снова в Ягодке.",
      lastRead,
    });
    if (state.netLeader) {
      gateway.send({ type: "client_info", client: "web", version: state.clientVersion, ...buildClientInfoTags() });
      gateway.send({ type: "group_list" });
      gateway.send({ type: "board_list" });
      gateway.send({ type: "profile_get" });
    }
    return true;
  }
  if (t === "pwa_push_subscribe_result") {
    const ok = Boolean(msg?.ok);
    const active = Boolean(msg?.active);
    const status = ok ? (active ? "Push подписка активна" : "Push подписка сохранена (сервер выключен)") : "Не удалось включить Push";
    patch({
      pwaPushSubscribed: ok,
      pwaPushStatus: status,
    });
    return true;
  }
  if (t === "pwa_push_unsubscribe_result") {
    const ok = Boolean(msg?.ok);
    patch({
      pwaPushSubscribed: !ok ? state.pwaPushSubscribed : false,
      pwaPushStatus: ok ? "Push отключен" : "Не удалось отключить Push",
    });
    return true;
  }
  if (t === "auth_fail") {
    const reason = String(msg?.reason ?? "auth_failed");
    if (reason === "session_invalid" || reason === "session_expired") {
      const uid = String(state.selfId || "").trim();
      if (uid) void clearOutboxForUser(uid);
      clearStoredSessionToken();
      patch({
        ...resetSidebarState(resetNavigationState(state, { page: "main" })),
        rosterSync: { loaded: false, source: "empty", reconcilePending: false, lastServerAt: null, lastPresenceAt: null },
        profileSync: {},
        authMode: getStoredAuthId() ? "login" : "register",
        sessionDevices: [],
        sessionDevicesStatus: null,
        // “В тишине”: не открываем модалку сами — только статус, дальше пользователь сам нажмёт «Войти».
        modal: null,
        status: "Сохранённая сессия больше не действует. Войдите снова, чтобы продолжить.",
      });
      return true;
    }
    const message =
      reason === "no_such_user"
        ? "Пользователь не найден"
        : reason === "bad_id_format"
          ? "Неверный формат ID/@логина"
        : reason === "bad_password"
          ? "Неверный ручной ключ"
          : reason === "rate_limited"
          ? "Слишком много попыток. Попробуйте позже."
            : "Не удалось выполнить вход";
    if (state.modal?.kind === "auth") {
      patch({ modal: { kind: "auth", message }, status: message });
    } else {
      patch({ status: message });
    }
    return true;
  }
  if (t === "register_ok") {
    const selfId = String(msg?.id ?? "");
    const sess = typeof msg?.session === "string" ? msg.session : null;
    if (selfId) storeAuthId(selfId);
    if (sess) storeSessionToken(sess);
    else {
      const existing = getStoredSessionToken();
      if (existing) storeSessionToken(existing);
    }
    clearSessionAutoAuthBlock();
    patch({
      authed: true,
      selfId,
      authRememberedId: selfId || state.authRememberedId,
      ...(sess ? { authMode: "auto" as const } : {}),
      modal: null,
      status: "Аккаунт создан. Добро пожаловать.",
    });
    if (state.netLeader) {
      gateway.send({ type: "client_info", client: "web", version: state.clientVersion, ...buildClientInfoTags() });
      gateway.send({ type: "group_list" });
      gateway.send({ type: "board_list" });
      gateway.send({ type: "profile_get" });
    }
    return true;
  }
  if (t === "register_fail") {
    const reason = String(msg?.reason ?? "register_failed");
    const message =
      reason === "empty_password"
        ? "Введите ручной ключ для регистрации"
        : reason === "password_too_short"
          ? "Ручной ключ слишком короткий"
          : reason === "password_too_long"
            ? "Ручной ключ слишком длинный"
            : reason === "rate_limited"
              ? "Слишком много попыток. Попробуйте позже."
              : "Регистрация не удалась";
    patch({ modal: { kind: "auth", message }, status: message });
    return true;
  }

  return false;
}
