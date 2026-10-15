import { el } from "../../helpers/dom/el";

export interface RenameModalActions {
  onRename: () => void;
  onCancel: () => void;
}

export function renderRenameModal(
  title: string,
  targetKind: "group" | "board",
  currentName: string | null,
  message: string | undefined,
  actions: RenameModalActions
): HTMLElement {
  const box = el("div", { class: "modal" });
  const btnSave = el("button", { class: "btn btn-primary", type: "button" }, ["Сохранить"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);

  const label = targetKind === "group" ? "Новое название чата:" : "Новое название доски:";
  const placeholder = currentName || (targetKind === "group" ? "Например, Команда" : "Например, Новости");

  box.append(
    el("div", { class: "modal-title" }, ["Переименовать"]),
    el("div", { class: "modal-line" }, [title]),
    el("div", { class: "modal-line" }, [label]),
    el("input", {
      class: "modal-input",
      id: "rename-name",
      placeholder,
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "done",
      maxlength: "64",
      value: currentName || "",
    }),
    el("div", { class: "modal-help" }, ["До 64 символов."]),
    el("div", { class: "modal-warn" }, [message || ""]),
    el("div", { class: "modal-actions" }, [btnCancel, btnSave])
  );

  btnSave.addEventListener("click", () => actions.onRename());
  btnCancel.addEventListener("click", () => actions.onCancel());

  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      actions.onRename();
    }
  });

  return box;
}
