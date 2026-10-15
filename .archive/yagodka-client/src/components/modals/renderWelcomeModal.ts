import { el } from "../../helpers/dom/el";
import type { AuthMode, ConnStatus } from "../../stores/types";

export interface WelcomeModalOptions {
  authMode?: AuthMode;
  rememberedId?: string | null;
  conn?: ConnStatus;
}

function screenTitle(authMode: AuthMode, rememberedId: string): string {
  if (authMode === "auto") return "Проверяем сессию";
  if (rememberedId) return "Готовим вход";
  return "Yagodka Corporate Messenger";
}

function screenSubtitle(authMode: AuthMode, rememberedId: string, status: string): string {
  if (status) return status;
  if (authMode === "auto") return "Проверяем сохранённую сессию и откроем рабочее пространство.";
  if (rememberedId) return "Подключаем устройство к сохранённому рабочему аккаунту.";
  return "Подключаем устройство и открываем экран авторизации.";
}

function screenChip(conn: ConnStatus, authMode: AuthMode): string {
  if (conn === "connected") return authMode === "auto" ? "Сессия найдена" : "Связь готова";
  if (conn === "disconnected") return "Нет связи";
  return "Подключаемся";
}

export function renderWelcomeModal(message?: string, options?: WelcomeModalOptions): HTMLElement {
  const status = String(message || "").trim();
  const authMode = options?.authMode ?? "register";
  const rememberedId = String(options?.rememberedId ?? "").trim();
  const conn = options?.conn ?? "connecting";
  const box = el("div", {
    class: "modal modal-screen modal-welcome modal-screen-status auth-welcome-screen",
    role: "status",
    "aria-live": "polite",
    "aria-busy": "true",
  });

  box.append(
    el("div", { class: "screen-logo-wrap", "aria-hidden": "true" }, [
      el("img", { class: "screen-logo", src: "./icons/icon.svg", alt: "" }, []),
    ]),
    el("div", { class: "screen-brand" }, ["Ягодка"]),
    el("div", { class: "screen-chip" }, [screenChip(conn, authMode)]),
    el("div", { class: "screen-title" }, [screenTitle(authMode, rememberedId)]),
    el("div", { class: "screen-sub" }, [screenSubtitle(authMode, rememberedId, status)]),
    rememberedId
      ? el("div", { class: "screen-note" }, [
          el("div", { class: "screen-note-label" }, [authMode === "auto" ? "Сохранённая сессия" : "Сохранённый аккаунт"]),
          el("div", { class: "screen-note-value" }, [rememberedId]),
        ])
      : el("div", { class: "screen-note screen-note-soft" }, [
          el("div", { class: "screen-note-label" }, ["Следующий шаг"]),
          el("div", { class: "screen-note-value" }, [
            authMode === "auto"
              ? "Открыть рабочее пространство после проверки."
              : "Показать вход или создание аккаунта.",
          ]),
        ])
  );
  return box;
}
