import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { getActiveConversationTarget } from "../../../helpers/navigation/mainConversationState";

export interface BoardEditorPreviewSyncFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  previewBody: HTMLElement;
  renderBoardPost: (text: string) => HTMLElement;
}

export interface BoardEditorPreviewSyncFeature {
  scheduleBoardEditorPreview: () => void;
}

export function createBoardEditorPreviewSyncFeature(deps: BoardEditorPreviewSyncFeatureDeps): BoardEditorPreviewSyncFeature {
  const { store, input, previewBody, renderBoardPost } = deps;
  let boardPreviewRaf: number | null = null;

  const scheduleBoardEditorPreview = () => {
    if (boardPreviewRaf !== null) return;
    boardPreviewRaf = window.requestAnimationFrame(() => {
      boardPreviewRaf = null;
      const st = store.get();
      const activeConversation = getActiveConversationTarget(st);
      if (!st.boardComposerOpen) return;
      if (!activeConversation || activeConversation.kind !== "board") return;
      const raw = String(input.value || "");
      const trimmed = raw.trimEnd();
      const preview = previewBody;
      const prevTop = preview.scrollTop;
      const bottomSlack = 48;
      const wasAtBottom = preview.scrollTop + preview.clientHeight >= preview.scrollHeight - bottomSlack;
      const caretAtEnd = (() => {
        try {
          const len = input.value.length;
          const s = typeof input.selectionStart === "number" ? input.selectionStart : len;
          const e = typeof input.selectionEnd === "number" ? input.selectionEnd : len;
          return s === len && e === len;
        } catch {
          return true;
        }
      })();
      if (!trimmed) {
        const empty = document.createElement("div");
        empty.className = "board-editor-preview-empty";
        empty.textContent = "Пусто — напишите новость выше";
        preview.replaceChildren(empty);
        preview.scrollTop = 0;
        return;
      }
      preview.replaceChildren(renderBoardPost(trimmed));
      const applyScroll = () => {
        try {
          const maxTop = Math.max(0, preview.scrollHeight - preview.clientHeight);
          if (wasAtBottom || caretAtEnd) preview.scrollTop = maxTop;
          else preview.scrollTop = Math.max(0, Math.min(maxTop, prevTop));
        } catch {
          // ignore
        }
      };
      applyScroll();
      window.requestAnimationFrame(applyScroll);
    });
  };

  return {
    scheduleBoardEditorPreview,
  };
}
