import { el } from "../../helpers/dom/el";
import { splitBuildId } from "../../helpers/version/buildId";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { getCapacitorPlatform, isCapacitorNativeRuntime } from "../../helpers/runtime/nativeRuntime";
import { getCurrentAndroidAppVersionInfo } from "../../helpers/runtime/androidAppVersion";

export interface UpdateModalActions {
  onDismiss: () => void;
  onReload: () => void;
}

export function renderUpdateModal(clientVersion: string, latest: string, actions: UpdateModalActions): HTMLElement {
  const mobileUi = isMobileLikeUi();
  const platform = getCapacitorPlatform();
  const isAndroidNative = isCapacitorNativeRuntime() && platform === "android";
  const currentAndroidApp = getCurrentAndroidAppVersionInfo();
  const currentBuild = splitBuildId(clientVersion);
  const latestBuild = splitBuildId(latest);
  const currentAndroidVersionLabel = currentAndroidApp.versionName || currentBuild.version || clientVersion || "—";
  const currentAndroidVersionHint = currentAndroidApp.versionCode !== null ? `versionCode ${currentAndroidApp.versionCode}` : undefined;
  const latestAndroidVersionLabel = latestBuild.version || latest || "—";
  const box = el("div", { class: "modal" });

  const btnReload = el("button", { class: "btn btn-primary", type: "button" }, [isAndroidNative ? "Обновить приложение" : "Обновить"]);
  const btnLater = el("button", { class: "btn", type: "button" }, ["Позже"]);
  const buttons = el("div", { class: "modal-actions" }, [btnReload, btnLater]);
  btnReload.addEventListener("click", () => actions.onReload());
  btnLater.addEventListener("click", () => actions.onDismiss());

  box.append(
    el("div", { class: "modal-title" }, [isAndroidNative ? "Доступно обновление приложения" : "Обнаружено обновление клиента"]),
    ...(isAndroidNative
      ? [
          el("div", { class: "modal-line", title: currentAndroidVersionHint }, [
            `Установлена версия ${currentAndroidVersionLabel}. Доступна версия ${latestAndroidVersionLabel}.`,
          ]),
          el("div", { class: "modal-line" }, ["Вышло новое обновление, и приложение нужно обновить."]),
          el("div", { class: "modal-line" }, ["Нажмите «Обновить приложение» — откроется актуальный Android APK для установки поверх текущей версии."]),
        ]
      : [
          el("div", { class: "modal-line", title: currentBuild.build ? `build ${currentBuild.build}` : undefined }, [
            `web ${currentBuild.version || "—"} → ${latest || "—"}`,
          ]),
        ]),
    ...(isAndroidNative
      ? [
          el("div", { class: "modal-line" }, ["Автоустановка без подтверждения пользователя недоступна для sideload APK."]),
        ]
      : []),
    ...(mobileUi || isAndroidNative
      ? []
      : [el("div", { class: "modal-line" }, ["Ctrl+U или Enter (OK) — обновить"]), el("div", { class: "modal-line" }, ["Esc или любая клавиша — позже"])]),
    buttons
  );
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onDismiss();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      actions.onReload();
    }
  });
  return box;
}
