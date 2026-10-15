import { el } from "../../helpers/dom/el";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";

export function renderHelpModal(): HTMLElement {
  const mobileUi = isMobileLikeUi();
  const box = el("div", { class: "modal" });
  if (mobileUi) {
    box.append(
      el("div", { class: "modal-title" }, ["Подсказки"]),
      el("div", { class: "modal-line" }, ["Вкладка «Меню» — поиск, профиль, файлы, создание, справка."]),
      el("div", { class: "modal-line" }, ["Долгий тап по контакту/сообщению — меню действий."])
    );
    return box;
  }
  box.append(
    el("div", { class: "modal-title" }, ["Подсказка клавиш"]),
    el("div", { class: "modal-line" }, ["F1 — помощь"]),
    el("div", { class: "modal-line" }, ["F2 — профиль"]),
    el("div", { class: "modal-line" }, ["F3 — поиск"]),
    el("div", { class: "modal-line" }, ["Ctrl+U — обновление (manual)"]),
    el("div", { class: "modal-line" }, ["F5 — создать чат"]),
    el("div", { class: "modal-line" }, ["F6 — создать доску"]),
    el("div", { class: "modal-line" }, ["F7 — файлы"]),
    el("div", { class: "modal-line" }, ["Enter — отправить сообщение"]),
    el("div", { class: "modal-line" }, ["Shift+Enter — новая строка"]),
    el("div", { class: "modal-line" }, ["Esc — закрыть окно"])
  );
  return box;
}
