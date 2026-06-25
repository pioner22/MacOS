import { el } from "../../helpers/dom/el";

export interface BoardCreateModalActions {
  onCreate: () => void;
  onCancel: () => void;
}

export function renderBoardCreateModal(message: string | undefined, actions: BoardCreateModalActions): HTMLElement {
  const box = el("div", { class: "modal" });
  const btnCreate = el("button", { class: "btn", type: "button" }, ["Создать"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);

  box.append(
    el("div", { class: "modal-title" }, ["Создать доску"]),
    el("div", { class: "modal-line" }, ["Название доски:"]),
    el("input", {
      class: "modal-input",
      id: "board-name",
      type: "text",
      placeholder: "Например, Новости",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "done",
    }),
    el("div", { class: "modal-line" }, ["Хэндл (опционально):"]),
    el("input", {
      class: "modal-input",
      id: "board-handle",
      type: "text",
      placeholder: "@news",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "done",
    }),
    el("div", { class: "modal-line" }, ["Участники (опционально):"]),
    el("input", {
      class: "modal-input",
      id: "board-members",
      type: "text",
      placeholder: "ID или @handle через пробел/запятую",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "done",
    }),
    el("div", { class: "modal-warn" }, [message || ""]),
    el("div", { class: "modal-actions" }, [btnCreate, btnCancel])
  );

  btnCreate.addEventListener("click", () => actions.onCreate());
  btnCancel.addEventListener("click", () => actions.onCancel());

  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      actions.onCreate();
    }
  });

  return box;
}
