import { el } from "../../helpers/dom/el";

export function renderMessageSelectionControl(opts: {
  selectionIdx: number;
  selected?: boolean;
  partial?: boolean;
  groupStartIdx?: number | null;
  groupEndIdx?: number | null;
}): HTMLElement {
  const selected = Boolean(opts.selected);
  const partial = Boolean(opts.partial);
  return el(
    "button",
    {
      class: `btn msg-select${selected || partial ? " msg-select-on" : ""}${partial ? " msg-select-partial" : ""}`,
      type: "button",
      "data-action": "msg-select-toggle",
      "data-msg-idx": String(Math.trunc(opts.selectionIdx)),
      ...(typeof opts.groupStartIdx === "number" && Number.isFinite(opts.groupStartIdx)
        ? { "data-msg-group-start": String(Math.trunc(opts.groupStartIdx)) }
        : {}),
      ...(typeof opts.groupEndIdx === "number" && Number.isFinite(opts.groupEndIdx)
        ? { "data-msg-group-end": String(Math.trunc(opts.groupEndIdx)) }
        : {}),
      title: selected ? "Снять выбор" : partial ? "Выбрать всё" : "Выбрать",
      "aria-label": selected ? "Снять выбор" : partial ? "Выбрать всё" : "Выбрать",
      ...(selected ? { "aria-pressed": "true" } : partial ? { "aria-pressed": "mixed" } : { "aria-pressed": "false" }),
    },
    [selected ? "✓" : partial ? "–" : ""]
  );
}
