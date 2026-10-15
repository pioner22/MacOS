import { el } from "../../helpers/dom/el";
import { focusElement } from "../../helpers/ui/focus";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { AppState } from "../../stores/types";

export interface CreateBoardPageActions {
  onCreate: () => void;
  onCancel: () => void;
}

export interface CreateBoardPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

export function createBoardCreatePage(actions: CreateBoardPageActions): CreateBoardPage {
  const mobileUi = isMobileLikeUi();
  const title = el("div", { class: "chat-title" }, ["Создать доску"]);

  const nameLabel = el("label", { class: "modal-label", for: "board-name" }, ["Название"]);
  const nameInput = el("input", {
    class: "modal-input",
    id: "board-name",
    placeholder: "Например, Новости",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const handleLabel = el("label", { class: "modal-label", for: "board-handle" }, ["Хэндл (опционально)"]);
  const handleInput = el("input", {
    class: "modal-input",
    id: "board-handle",
    placeholder: "@news",
    "data-ios-assistant": "off",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const membersLabel = el("label", { class: "modal-label", for: "board-members-entry" }, ["Участники (опционально)"]);
  const membersField = el(
    "div",
    { class: "chips-field", id: "board-members-field", role: "group", "aria-label": "Участники" },
    [
      el("div", { class: "chips", id: "board-members-chips" }),
      el("input", {
        class: "chips-entry",
        id: "board-members-entry",
        placeholder: "ID или @handle (можно вставить список)",
        "data-ios-assistant": "off",
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        inputmode: "text",
        enterkeyhint: "done",
      }),
      // Hidden canonical value for submit.
      el("input", { id: "board-members", type: "hidden", value: "" }),
    ]
  );

  const descriptionLabel = el("label", { class: "modal-label", for: "board-description" }, ["Описание (опционально)"]);
  const descriptionInput = el("textarea", {
    class: "modal-input",
    id: "board-description",
    placeholder: "Коротко о доске…",
    rows: "3",
    maxlength: "2000",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLTextAreaElement;

  const rulesLabel = el("label", { class: "modal-label", for: "board-rules" }, ["Правила (опционально)"]);
  const rulesInput = el("textarea", {
    class: "modal-input",
    id: "board-rules",
    placeholder: "Например: только новости, без рекламы…",
    rows: "4",
    maxlength: "2000",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLTextAreaElement;

  const warn = el("div", { class: "page-warn" }, [""]);

  const btnCreate = el("button", { class: "btn", type: "button" }, ["Создать"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);
  const actionsRow = el("div", { class: "page-actions" }, [btnCreate, btnCancel]);

  const hint = mobileUi ? null : el("div", { class: "msg msg-sys page-hint" }, ["Enter — создать | Esc — назад"]);

  const mainCard = el("div", { class: "page-card" }, [
    el("div", { class: "page-card-title" }, ["Основное"]),
    nameLabel,
    nameInput,
    handleLabel,
    handleInput,
  ]);
  const infoCard = el("div", { class: "page-card" }, [
    el("div", { class: "page-card-title" }, ["Описание и правила"]),
    descriptionLabel,
    descriptionInput,
    rulesLabel,
    rulesInput,
  ]);
  const membersCard = el("div", { class: "page-card" }, [
    el("div", { class: "page-card-title" }, ["Участники"]),
    membersLabel,
    membersField,
  ]);
  const root = el("div", { class: "page page-create" }, [title, mainCard, infoCard, membersCard, warn, actionsRow, ...(hint ? [hint] : [])]);

  function submit() {
    actions.onCreate();
  }

  btnCreate.addEventListener("click", () => submit());
  btnCancel.addEventListener("click", () => actions.onCancel());

  root.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === "TEXTAREA") return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  return {
    root,
    update: (state: AppState) => {
      const message = String(state.boardCreateMessage || "");
      warn.textContent = message;
      warn.classList.toggle("hidden", !message);

      const canSubmit = state.conn === "connected" && state.authed;
      btnCreate.disabled = !canSubmit;
    },
    focus: () => {
      nameInput.value = "";
      handleInput.value = "";
      descriptionInput.value = "";
      rulesInput.value = "";
      const hidden = root.querySelector("#board-members") as HTMLInputElement | null;
      const entry = root.querySelector("#board-members-entry") as HTMLInputElement | null;
      const chips = root.querySelector("#board-members-chips") as HTMLElement | null;
      if (hidden) hidden.value = "";
      if (entry) entry.value = "";
      chips?.replaceChildren();
      focusElement(nameInput, { select: true });
    },
  };
}
