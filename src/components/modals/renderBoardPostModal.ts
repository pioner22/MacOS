import { el } from "../../helpers/dom/el";
import { APP_MSG_MAX_LEN } from "../../config/app";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function lineStartIndex(text: string, pos: number): number {
  const i = text.lastIndexOf("\n", Math.max(0, pos - 1));
  return i === -1 ? 0 : i + 1;
}

function lineEndIndex(text: string, pos: number): number {
  const i = text.indexOf("\n", Math.max(0, pos));
  return i === -1 ? text.length : i;
}

function prefixCurrentLine(text: string, caret: number, prefix: string): { value: string; caret: number } {
  const start = lineStartIndex(text, caret);
  const next = text.slice(0, start) + prefix + text.slice(start);
  return { value: next, caret: caret + prefix.length };
}

function prefixSelectedLines(text: string, selStart: number, selEnd: number, prefix: string): { value: string; caret: number } {
  const a = Math.min(selStart, selEnd);
  const b = Math.max(selStart, selEnd);
  const start = lineStartIndex(text, a);
  const end = lineEndIndex(text, b);
  const region = text.slice(start, end);
  const lines = region.split("\n");
  const nextRegion = lines.map((line) => (line ? prefix + line : prefix.trimEnd() ? prefix.trimEnd() : prefix)).join("\n");
  const next = text.slice(0, start) + nextRegion + text.slice(end);
  const added = prefix.length * lines.length;
  return { value: next, caret: b + added };
}

export function renderBoardPostModal(
  boardLabel: string,
  actions: { onPublish: (text: string) => void; onCancel: () => void }
): HTMLElement {
  const title = el("div", { class: "modal-title" }, ["Новый пост"]);
  const sub = el("div", { class: "modal-sub" }, [boardLabel ? `Доска: ${boardLabel}` : "Доска"]);

  const toolbar = el("div", { class: "board-post-toolbar" }, []);
  const input = el("textarea", {
    class: "modal-input board-post-input",
    id: "board-post-text",
    rows: "10",
    placeholder: "Текст объявления…",
    maxlength: String(APP_MSG_MAX_LEN),
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
  }) as HTMLTextAreaElement;

  const counter = el("div", { class: "board-post-counter", "aria-hidden": "true" }, ["0/4000"]);

  const btnPublish = el("button", { class: "btn btn-primary", type: "button" }, ["Опубликовать"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);
  const actionsRow = el("div", { class: "modal-actions" }, [btnPublish, btnCancel]);

  const box = el("div", { class: "modal modal-board-post" }, [title, sub, toolbar, input, counter, actionsRow]);

  function updateCounter() {
    const len = String(input.value || "").length;
    counter.textContent = `${len}/${APP_MSG_MAX_LEN}`;
    box.classList.toggle("board-post-too-long", len > APP_MSG_MAX_LEN);
  }

  function apply(fn: (value: string, start: number, end: number) => { value: string; caret: number }) {
    const value = String(input.value || "");
    const start = typeof input.selectionStart === "number" ? input.selectionStart : value.length;
    const end = typeof input.selectionEnd === "number" ? input.selectionEnd : start;
    const next = fn(value, start, end);
    input.value = next.value;
    try {
      const caret = clamp(next.caret, 0, input.value.length);
      input.selectionStart = caret;
      input.selectionEnd = caret;
      input.focus();
    } catch {
      // ignore
    }
    updateCounter();
  }

  const addToolBtn = (label: string, titleText: string, fn: () => void) => {
    const b = el("button", { class: "btn board-post-tool", type: "button", title: titleText, "aria-label": titleText }, [label]);
    b.addEventListener("click", () => fn());
    toolbar.appendChild(b);
  };

  addToolBtn("H", "Заголовок (добавить # в начале строки)", () => {
    apply((value, start) => prefixCurrentLine(value, start, "# "));
  });
  addToolBtn("•", "Список (добавить маркер • в начало строк)", () => {
    apply((value, start, end) => prefixSelectedLines(value, start, end, "• "));
  });
  addToolBtn("❝", "Цитата (добавить > в начало строк)", () => {
    apply((value, start, end) => prefixSelectedLines(value, start, end, "> "));
  });
  addToolBtn("—", "Разделитель (вставить строку —)", () => {
    apply((value, start, end) => {
      const a = Math.min(start, end);
      const b = Math.max(start, end);
      const ins = "\n—\n";
      return { value: value.slice(0, a) + ins + value.slice(b), caret: a + ins.length };
    });
  });

  const publish = () => {
    const text = String(input.value || "").trimEnd();
    if (!text) return;
    actions.onPublish(text);
  };

  input.addEventListener("input", () => updateCounter());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      publish();
    }
  });
  btnPublish.addEventListener("click", () => publish());
  btnCancel.addEventListener("click", () => actions.onCancel());

  updateCounter();
  return box;
}

