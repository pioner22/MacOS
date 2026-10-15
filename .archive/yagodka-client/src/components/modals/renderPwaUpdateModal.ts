import { el } from "../../helpers/dom/el";
import { isPwaUpdateBusy } from "../../helpers/pwa/updateState";
import { splitBuildId } from "../../helpers/version/buildId";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { PwaUpdateRuntimeState, PwaUpdateStage } from "../../stores/types";

export interface PwaUpdateModalActions {
  onDismiss: () => void;
  onApply: () => void;
}

function titleForStage(stage: PwaUpdateStage): string {
  if (stage === "checking") return "Проверяем обновление";
  if (stage === "downloading") return "Загружаем обновление";
  if (stage === "applying") return "Устанавливаем обновление";
  if (stage === "verifying") return "Проверяем запуск";
  if (stage === "done") return "Обновление готово";
  if (stage === "error") return "Обновление требует внимания";
  return "Доступно обновление";
}

function stepClass(stage: PwaUpdateStage, step: "checking" | "downloading" | "applying" | "verifying"): string {
  const order: PwaUpdateStage[] = ["available", "checking", "downloading", "applying", "verifying", "done"];
  const currentIndex = order.indexOf(stage);
  const stepIndex = order.indexOf(step);
  const classes = ["pwa-update-step"];
  if (stage === "error" && step === "verifying") classes.push("pwa-update-step-error");
  else if (stage === step) classes.push("pwa-update-step-active");
  else if (currentIndex > stepIndex || stage === "done") classes.push("pwa-update-step-done");
  return classes.join(" ");
}

export function renderPwaUpdateModal(
  clientVersion: string,
  latest: string,
  updateState: PwaUpdateRuntimeState,
  actions: PwaUpdateModalActions
): HTMLElement {
  const mobileUi = isMobileLikeUi();
  const webBuild = splitBuildId(clientVersion);
  const stage = updateState?.stage ?? "available";
  const busy = isPwaUpdateBusy(stage);
  const targetBuild = updateState?.buildId || latest;
  const latestBuild = splitBuildId(targetBuild);
  const latestLabel = latestBuild.version || latest || "новая сборка";
  const progress = Math.max(0, Math.min(100, Math.round(updateState?.progress ?? 16)));
  const message =
    updateState?.message ||
    "Клиент подготовит обновлённые файлы, применит новую версию и проверит запуск. Можно обновить позже.";
  const detail =
    updateState?.detail ||
    "Обновление не применяется само: сначала подтверждение, потом загрузка, установка и проверка новой сборки.";
  const box = el("div", {
    class: "modal modal-pwa-update",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "pwa-update-title",
    "data-update-stage": stage,
  });

  const btnApply = el(
    "button",
    { class: "btn btn-primary pwa-update-apply", type: "button", ...(busy ? { disabled: "true" } : {}) },
    [stage === "error" ? "Повторить" : busy ? "Обновляем..." : "Обновить"]
  );
  const btnLater = el("button", { class: "btn pwa-update-later", type: "button" }, ["Отложить"]);
  const buttons = el("div", { class: "modal-actions pwa-update-actions" }, [btnApply, btnLater]);
  btnApply.addEventListener("click", () => {
    if (!busy) actions.onApply();
  });
  btnLater.addEventListener("click", () => {
    actions.onDismiss();
  });

  box.append(
    el("div", { class: "pwa-update-mark", "aria-hidden": "true" }, [""]),
    el("div", { class: "modal-title pwa-update-title", id: "pwa-update-title" }, [titleForStage(stage)]),
    el("div", { class: "modal-line pwa-update-version", title: webBuild.build ? `build ${webBuild.build}` : undefined }, [
      el("span", { class: "pwa-update-version-label" }, ["web"]),
      el("span", { class: "pwa-update-version-now" }, [webBuild.version || "—"]),
      el("span", { class: "pwa-update-version-arrow", "aria-hidden": "true" }, ["→"]),
      el("span", { class: "pwa-update-version-next" }, [latestLabel]),
    ]),
    el("div", { class: "modal-line pwa-update-copy" }, [message]),
    el("div", { class: "modal-line pwa-update-detail" }, [detail]),
    el("div", { class: "pwa-update-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(progress) }, [
      el("span", { class: "pwa-update-progress-bar", style: `width: ${progress}%` }, [""]),
    ]),
    el("div", { class: "pwa-update-steps", "aria-label": "Шаги обновления" }, [
      el("span", { class: stepClass(stage, "checking") }, ["Проверка"]),
      el("span", { class: stepClass(stage, "downloading") }, ["Загрузка"]),
      el("span", { class: stepClass(stage, "applying") }, ["Установка"]),
      el("span", { class: stepClass(stage, "verifying") }, ["Запуск"]),
    ]),
    ...(mobileUi
      ? []
      : [
          el("div", { class: "modal-line pwa-update-hint" }, ["Enter — обновить"]),
          el("div", { class: "modal-line pwa-update-hint" }, ["Esc — отложить, остальные клавиши не закрывают окно"]),
        ]),
    buttons
  );
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onDismiss();
    }
    if (!busy && e.key === "Enter") {
      e.preventDefault();
      actions.onApply();
    }
  });
  return box;
}
