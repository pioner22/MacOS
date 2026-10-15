import { el } from "../../helpers/dom/el";
import { splitBuildId } from "../../helpers/version/buildId";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";

export interface UpdateModalActions {
  onDismiss: () => void;
  onReload: () => void;
}

export function renderUpdateModal(clientVersion: string, latest: string, actions: UpdateModalActions): HTMLElement {
  const mobileUi = isMobileLikeUi();
  const currentBuild = splitBuildId(clientVersion);
  const latestBuild = splitBuildId(latest);
  const box = el("div", { class: "modal" });

  const btnReload = el("button", { class: "btn btn-primary", type: "button" }, ["Обновить"]);
  const btnLater = el("button", { class: "btn", type: "button" }, ["Позже"]);
  const buttons = el("div", { class: "modal-actions" }, [btnReload, btnLater]);
  btnReload.addEventListener("click", () => actions.onReload());
  btnLater.addEventListener("click", () => actions.onDismiss());

  box.append(
    el("div", { class: "modal-title" }, ["Обнаружено обновление клиента"]),
    el("div", { class: "modal-line", title: currentBuild.build ? `build ${currentBuild.build}` : undefined }, [
      `web ${currentBuild.version || "—"} → ${latestBuild.version || latest || "—"}`,
    ]),
    ...(mobileUi
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
