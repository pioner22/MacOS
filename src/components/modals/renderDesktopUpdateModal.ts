import type { DesktopUpdateRuntimeState } from "../../stores/types";
import { el } from "../../helpers/dom/el";

export interface DesktopUpdateModalActions {
  onClose: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}

function targetVersion(status: DesktopUpdateRuntimeState): string {
  return String(status.updateInfo?.version || "").trim();
}

function titleFor(status: DesktopUpdateRuntimeState): string {
  const version = targetVersion(status);
  if (status.state === "checking") return "Проверяем обновление";
  if (status.state === "available") return version ? `Доступно обновление ${version}` : "Доступно обновление";
  if (status.state === "downloading") return "Скачиваем обновление";
  if (status.state === "ready") return version ? `Обновление ${version} готово` : "Обновление готово";
  if (status.state === "installing") return "Перезапускаем приложение";
  if (status.state === "failed") return "Не удалось обновить";
  return "Обновление приложения";
}

function detailFor(status: DesktopUpdateRuntimeState): string {
  const version = targetVersion(status);
  if (status.state === "checking") return "Сначала проверяем установленный клиент. Подключение начнётся после проверки версии.";
  if (status.state === "available") {
    return version
      ? `Установлена версия ${status.appVersion || "—"}. Доступна версия ${version}.`
      : "Доступна новая версия desktop-клиента.";
  }
  if (status.state === "downloading") {
    const pct = Math.max(0, Math.min(100, Math.round(Number(status.progress?.percent || 0))));
    return pct ? `Загружено ${pct}%. Не закрывайте приложение до завершения.` : "Загружаем файлы обновления.";
  }
  if (status.state === "ready") return "Перезапустите приложение, чтобы открыть актуальный клиент и подключиться к серверу.";
  if (status.state === "installing") return "Сохраняем состояние и запускаем установку.";
  if (status.state === "failed") return status.error || "Проверьте соединение и повторите проверку обновлений.";
  return "Desktop-клиент проверяет наличие новой версии.";
}

function progressValue(status: DesktopUpdateRuntimeState): number {
  if (status.state === "checking") return 18;
  if (status.state === "available") return 32;
  if (status.state === "downloading") return Math.max(8, Math.min(96, Math.round(Number(status.progress?.percent || 0))));
  if (status.state === "ready") return 100;
  if (status.state === "installing") return 100;
  if (status.state === "failed") return 100;
  return 8;
}

function primaryButton(status: DesktopUpdateRuntimeState, actions: DesktopUpdateModalActions): HTMLButtonElement {
  if (status.state === "available") {
    const btn = el("button", { class: "btn btn-primary desktop-update-download", type: "button" }, ["Скачать"]) as HTMLButtonElement;
    btn.addEventListener("click", () => actions.onDownload());
    return btn;
  }
  if (status.state === "ready") {
    const btn = el("button", { class: "btn btn-primary desktop-update-install", type: "button" }, ["Перезапустить"]) as HTMLButtonElement;
    btn.addEventListener("click", () => actions.onInstall());
    return btn;
  }
  const btn = el("button", { class: "btn btn-primary desktop-update-check", type: "button" }, ["Проверить"]) as HTMLButtonElement;
  btn.addEventListener("click", () => actions.onCheck());
  btn.disabled = status.state === "checking" || status.state === "downloading" || status.state === "installing";
  return btn;
}

export function renderDesktopUpdateModal(status: DesktopUpdateRuntimeState, actions: DesktopUpdateModalActions): HTMLElement {
  const stage = status.state || "idle";
  const progress = progressValue(status);
  const btnPrimary = primaryButton(status, actions);
  const btnLater = el("button", { class: "btn desktop-update-later", type: "button" }, ["Позже"]) as HTMLButtonElement;
  btnLater.disabled = stage === "checking" || stage === "downloading" || stage === "installing";
  btnLater.addEventListener("click", () => actions.onClose());

  const box = el("div", {
    class: "modal modal-desktop-update",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "desktop-update-title",
    "data-update-stage": stage,
  });

  box.append(
    el("div", { class: "desktop-update-mark", "aria-hidden": "true" }, [""]),
    el("div", { class: "modal-title desktop-update-title", id: "desktop-update-title" }, [titleFor(status)]),
    el("div", { class: "modal-line desktop-update-version" }, [
      el("span", { class: "desktop-update-version-label" }, ["desktop"]),
      el("span", { class: "desktop-update-version-now" }, [status.appVersion || "—"]),
      ...(targetVersion(status)
        ? [
            el("span", { class: "desktop-update-version-arrow", "aria-hidden": "true" }, ["→"]),
            el("span", { class: "desktop-update-version-next" }, [targetVersion(status)]),
          ]
        : []),
    ]),
    el("div", { class: "modal-line desktop-update-copy" }, [detailFor(status)]),
    el(
      "div",
      {
        class: "desktop-update-progress",
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(progress),
      },
      [el("span", { class: "desktop-update-progress-bar", style: `width: ${progress}%` }, [""])]
    ),
    el("div", { class: "modal-actions desktop-update-actions" }, [btnPrimary, btnLater])
  );

  return box;
}
