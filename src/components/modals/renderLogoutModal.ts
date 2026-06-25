import { el } from "../../helpers/dom/el";

export interface LogoutModalActions {
  onClose: () => void;
  onRelogin: () => void;
  onUseDifferentAccount: () => void;
}

export function renderLogoutModal(
  message: string | undefined,
  rememberedId: string | null,
  actions: LogoutModalActions
): HTMLElement {
  const rawStatus = String(message || "").trim();
  const status = (() => {
    if (!rawStatus) return "";
    const normalized = rawStatus.toLowerCase();
    if (
      normalized.includes("нет соединения") ||
      normalized.includes("подключение") ||
      normalized.includes("code=") ||
      normalized.includes("reason=")
    ) {
      return "Сессия завершена на этом устройстве. Можно войти снова или выбрать другой аккаунт.";
    }
    return rawStatus;
  })();
  const rememberedIdValue = String(rememberedId || "").trim();
  const box = el("div", {
    class: "modal modal-screen modal-logout modal-screen-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Выход",
    tabindex: "-1",
  });
  const reloginBtn = el("button", { class: "btn btn-primary", type: "button" }, ["Войти снова"]) as HTMLButtonElement;
  reloginBtn.addEventListener("click", () => actions.onRelogin());
  const switchBtn = el("button", { class: "btn btn-secondary", type: "button" }, ["Другой аккаунт"]) as HTMLButtonElement;
  switchBtn.addEventListener("click", () => actions.onUseDifferentAccount());
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onClose();
    }
  });
  box.append(
    el("img", { class: "screen-logo", src: "./icons/icon.svg", alt: "" }, []),
    el("div", { class: "screen-brand" }, ["Ягодка"]),
    el("div", { class: "screen-chip" }, ["Сессия завершена"]),
    el("div", { class: "screen-title" }, ["До встречи"]),
    el("div", { class: "screen-sub" }, [status || "Сессия завершена. Можно войти снова или выбрать другой аккаунт."]),
    rememberedIdValue
      ? el("div", { class: "screen-note screen-account-note" }, [
          el("span", { class: "screen-note-label" }, ["Сохранённый ID"]),
          el("strong", { class: "screen-note-value" }, [rememberedIdValue]),
        ])
      : el("div", { class: "screen-note" }, ["Локальная сессия очищена. Можно войти под другим аккаунтом."]),
    el("div", { class: "modal-actions modal-actions-compose" }, [switchBtn, reloginBtn])
  );
  return box;
}
