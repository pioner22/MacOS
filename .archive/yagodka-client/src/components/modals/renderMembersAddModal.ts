import { el } from "../../helpers/dom/el";

export interface MembersAddModalActions {
  onAdd: () => void;
  onCancel: () => void;
}

export function renderMembersAddModal(
  title: string,
  targetKind: "group" | "board",
  message: string | undefined,
  actions: MembersAddModalActions
): HTMLElement {
  const box = el("div", { class: "modal" });
  const btnAdd = el("button", { class: "btn", type: "button" }, ["Добавить"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);

  const hint =
    targetKind === "group"
      ? "ID или @handle — можно вставить список; проверка выполняется на лету"
      : "ID или @handle — можно вставить список; проверка выполняется на лету";

  const chipsField = el("div", { class: "chips-field", id: "members-add-field", role: "group", "aria-label": "Участники" }, [
    el("div", { class: "chips", id: "members-add-chips" }),
    el("input", {
      class: "chips-entry",
      id: "members-add-entry",
      placeholder: "Например: 123-456-789, @name",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "done",
    }),
    el("input", { id: "members-add-input", type: "hidden", value: "" }),
  ]);

  box.append(
    el("div", { class: "modal-title" }, ["Добавить участников"]),
    el("div", { class: "modal-line" }, [title]),
    el("div", { class: "modal-line" }, [hint]),
    chipsField,
    el("div", { class: "modal-warn" }, [message || ""]),
    el("div", { class: "modal-actions" }, [btnAdd, btnCancel])
  );

  btnAdd.addEventListener("click", () => actions.onAdd());
  btnCancel.addEventListener("click", () => actions.onCancel());

  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      actions.onAdd();
    }
  });

  return box;
}
