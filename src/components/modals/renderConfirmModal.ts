import { el } from "../../helpers/dom/el";

export interface ConfirmModalActions {
  onConfirm: () => void;
  onCancel: () => void;
}

export function renderConfirmModal(
  title: string,
  message: string,
  confirmLabel: string | undefined,
  cancelLabel: string | undefined,
  danger: boolean | undefined,
  actions: ConfirmModalActions
): HTMLElement {
  const box = el("div", {
    class: danger ? "modal modal-confirm modal-confirm-danger" : "modal modal-confirm",
    role: danger ? "alertdialog" : "dialog",
    "aria-modal": "true",
    "aria-label": title,
    "data-confirm-tone": danger ? "danger" : "default",
    tabindex: "-1",
  });
  const btnOk = el("button", { class: danger ? "btn btn-danger" : "btn btn-primary", type: "button" }, [
    confirmLabel || (danger ? "Удалить" : "ОК"),
  ]);
  const btnCancel = el("button", { class: "btn btn-secondary", type: "button" }, [cancelLabel || "Отмена"]);

  box.append(
    el("div", { class: "modal-title" }, [title]),
    el("div", { class: "modal-line modal-copy" }, [message]),
    el("div", { class: "modal-actions modal-actions-confirm" }, [btnCancel, btnOk])
  );

  btnOk.addEventListener("click", () => actions.onConfirm());
  btnCancel.addEventListener("click", () => actions.onCancel());

  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      actions.onConfirm();
    }
  });

  return box;
}
