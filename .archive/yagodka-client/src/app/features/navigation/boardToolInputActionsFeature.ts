import { insertTextAtSelection } from "../../../helpers/ui/textSelection";

export interface BoardToolInputActionsFeatureDeps {
  input: HTMLTextAreaElement;
}

export interface BoardToolInputActionsFeature {
  handleBoardToolInputWrapClick: (target: HTMLElement | null, event: Event) => boolean;
}

type EditorUpdate = { value: string; caret: number };

export function createBoardToolInputActionsFeature(deps: BoardToolInputActionsFeatureDeps): BoardToolInputActionsFeature {
  const { input } = deps;

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const lineStartIndex = (value: string, pos: number) => {
    const i = value.lastIndexOf("\n", Math.max(0, pos - 1));
    return i === -1 ? 0 : i + 1;
  };
  const lineEndIndex = (value: string, pos: number) => {
    const i = value.indexOf("\n", Math.max(0, pos));
    return i === -1 ? value.length : i;
  };
  const prefixCurrentLine = (value: string, caret: number, prefix: string): EditorUpdate => {
    const start = lineStartIndex(value, caret);
    const next = value.slice(0, start) + prefix + value.slice(start);
    return { value: next, caret: caret + prefix.length };
  };
  const prefixSelectedLines = (value: string, selStart: number, selEnd: number, prefix: string): EditorUpdate => {
    const a = Math.min(selStart, selEnd);
    const b = Math.max(selStart, selEnd);
    const start = lineStartIndex(value, a);
    const end = lineEndIndex(value, b);
    const region = value.slice(start, end);
    const lines = region.split("\n");
    const nextRegion = lines.map((line) => (line ? prefix + line : prefix.trimEnd() ? prefix.trimEnd() : prefix)).join("\n");
    const next = value.slice(0, start) + nextRegion + value.slice(end);
    const added = prefix.length * lines.length;
    return { value: next, caret: b + added };
  };
  const ensureBlockPrefix = (base: string, pos: number) => {
    const before = base.slice(0, Math.max(0, pos));
    if (!before) return "";
    if (before.endsWith("\n\n")) return "";
    if (before.endsWith("\n")) return "\n";
    return "\n\n";
  };

  const applyValue = (next: EditorUpdate) => {
    input.value = next.value;
    try {
      const caret = clamp(next.caret, 0, next.value.length);
      input.selectionStart = caret;
      input.selectionEnd = caret;
    } catch {
      // ignore
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      input.focus();
    } catch {
      // ignore
    }
  };

  const handleBoardToolInputWrapClick = (target: HTMLElement | null, event: Event): boolean => {
    const toolBtn = target?.closest("button[data-action^='board-tool-']") as HTMLButtonElement | null;
    if (!toolBtn) return false;
    const action = String(toolBtn.getAttribute("data-action") || "").trim();
    if (!action) return true;
    event.preventDefault();

    const value = String(input.value || "");
    const start = typeof input.selectionStart === "number" ? input.selectionStart : value.length;
    const end = typeof input.selectionEnd === "number" ? input.selectionEnd : start;

    if (action === "board-tool-heading") {
      applyValue(prefixCurrentLine(value, start, "# "));
      return true;
    }
    if (action === "board-tool-list") {
      applyValue(prefixSelectedLines(value, start, end, "• "));
      return true;
    }
    if (action === "board-tool-quote") {
      applyValue(prefixSelectedLines(value, start, end, "> "));
      return true;
    }
    if (action === "board-tool-divider") {
      const insertText = "\n—\n";
      applyValue(insertTextAtSelection({ value, selectionStart: start, selectionEnd: end, insertText }));
      return true;
    }

    const insertChangelogBlock = (marker: string) => {
      const prefix = ensureBlockPrefix(value, Math.min(start, end));
      const basePos = Math.min(start, end);
      const insertText = `${prefix}##${marker} \n- `;
      const out = insertTextAtSelection({ value, selectionStart: start, selectionEnd: end, insertText });
      const caret = basePos + prefix.length + 2 + marker.length + 1;
      applyValue({ value: out.value, caret });
    };

    if (action === "board-tool-kind-added") {
      insertChangelogBlock("+");
      return true;
    }
    if (action === "board-tool-kind-improved") {
      insertChangelogBlock("^");
      return true;
    }
    if (action === "board-tool-kind-fixed") {
      insertChangelogBlock("!");
      return true;
    }
    if (action === "board-tool-kind-notes") {
      insertChangelogBlock("?");
      return true;
    }

    return true;
  };

  return {
    handleBoardToolInputWrapClick,
  };
}
