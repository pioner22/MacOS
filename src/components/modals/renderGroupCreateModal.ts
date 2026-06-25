import { el } from "../../helpers/dom/el";

export interface GroupCreateModalActions {
  onCreate: () => void;
  onCancel: () => void;
}

export function renderGroupCreateModal(message: string | undefined, actions: GroupCreateModalActions): HTMLElement {
  const box = el("div", { class: "modal" });
  const btnCreate = el("button", { class: "btn", type: "button" }, ["Создать"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);

  box.append(
    el("div", { class: "modal-title" }, ["Создать чат"]),
    el("div", { class: "modal-line" }, ["Название чата:"]),
    el("input", {
      class: "modal-input",
      id: "group-name",
      type: "text",
      placeholder: "Например, Команда",
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
      id: "group-members",
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
