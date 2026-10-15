import { el } from "../../helpers/dom/el";

export interface MembersRemoveModalActions {
  onRemove: () => void;
  onCancel: () => void;
}

export function renderMembersRemoveModal(
  title: string,
  targetKind: "group" | "board",
  message: string | undefined,
  actions: MembersRemoveModalActions
): HTMLElement {
  const box = el("div", { class: "modal" });
  const btnRemove = el("button", { class: "btn btn-danger", type: "button" }, ["Удалить"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);

  const hint =
    targetKind === "group"
      ? "ID участников через пробел/запятую (удалять можно только других участников)"
      : "ID участников через пробел/запятую (удалять можно только других участников)";

  box.append(
    el("div", { class: "modal-title" }, ["Удалить участников"]),
    el("div", { class: "modal-line" }, [title]),
    el("div", { class: "modal-line" }, [hint]),
    el("input", {
      class: "modal-input",
      id: "members-remove-input",
      placeholder: "Например: 123-456-789, @name",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "done",
    }),
    el("div", { class: "modal-warn" }, [message || ""]),
    el("div", { class: "modal-actions" }, [btnCancel, btnRemove])
  );

  btnRemove.addEventListener("click", () => actions.onRemove());
  btnCancel.addEventListener("click", () => actions.onCancel());

  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      actions.onRemove();
    }
  });

  return box;
}
