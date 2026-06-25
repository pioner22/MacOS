import { el } from "../../helpers/dom/el";
import { buildAppShellProjection } from "../../helpers/navigation/appShellProjection";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { AppState } from "../../stores/types";

export function renderFooter(target: HTMLElement, state: AppState) {
  const mobileUi = isMobileLikeUi();
  const shell = buildAppShellProjection(state);
  target.classList.toggle("hidden", mobileUi);
  if (mobileUi) {
    target.replaceChildren();
    return;
  }
  const tabMain = el(
    "button",
    {
      class: state.page === "main" ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(state.page === "main"),
      "data-action": "nav-main",
    },
    ["Контакты"]
  );
  const tabProfile = el(
    "button",
    {
      class: shell.profileAreaOpen ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(shell.profileAreaOpen),
      "data-action": "nav-profile",
    },
    ["Профиль"]
  );
  const tabFiles = el(
    "button",
    {
      class: shell.isFilesPage ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(shell.isFilesPage),
      "data-action": "nav-files",
    },
    ["Файлы"]
  );

  target.replaceChildren(
    el("div", { class: "footer-nav", role: "tablist" }, [tabMain, tabProfile, tabFiles])
  );
}
