import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { getActiveConversationTarget } from "../../../helpers/navigation/mainConversationState";

export interface ComposerInputKeydownFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  isEmojiPopoverOpen: () => boolean;
  closeEmojiPopover: () => void;
  sendChat: () => void;
  cancelEditing: () => void;
  clearComposerHelper: () => void;
  closeBoardComposer: () => void;
}

export interface ComposerInputKeydownFeature {
  bind: () => void;
}

export function createComposerInputKeydownFeature(deps: ComposerInputKeydownFeatureDeps): ComposerInputKeydownFeature {
  const {
    store,
    input,
    isEmojiPopoverOpen,
    closeEmojiPopover,
    sendChat,
    cancelEditing,
    clearComposerHelper,
    closeBoardComposer,
  } = deps;

  const bind = () => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isEmojiPopoverOpen()) {
        e.preventDefault();
        e.stopPropagation();
        closeEmojiPopover();
        return;
      }
      const st = store.get();
      const activeConversation = getActiveConversationTarget(st);
      const boardEditorOpen = Boolean(st.boardComposerOpen && activeConversation?.kind === "board");

      if (e.key === "Enter" && !e.shiftKey) {
        if (boardEditorOpen) {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            sendChat();
          }
          return;
        }
        e.preventDefault();
        sendChat();
        return;
      }

      if (e.key === "Escape") {
        if (st.editing) {
          e.preventDefault();
          e.stopPropagation();
          cancelEditing();
          return;
        }
        if (st.replyDraft || st.forwardDraft) {
          e.preventDefault();
          e.stopPropagation();
          clearComposerHelper();
          return;
        }
        if (boardEditorOpen) {
          e.preventDefault();
          e.stopPropagation();
          closeBoardComposer();
          return;
        }
      }
    });
  };

  return {
    bind,
  };
}
