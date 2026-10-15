import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { getActiveConversationTarget } from "../../../helpers/navigation/mainConversationState";

export interface BoardEditorToggleInputActionFeatureDeps {
  store: Store<AppState>;
  scheduleBoardEditorPreview: () => void;
  scheduleFocusComposer: () => void;
}

export interface BoardEditorToggleInputActionFeature {
  handleBoardEditorToggleInputWrapClick: (target: HTMLElement | null, event: Event) => boolean;
}

export function createBoardEditorToggleInputActionFeature(
  deps: BoardEditorToggleInputActionFeatureDeps
): BoardEditorToggleInputActionFeature {
  const { store, scheduleBoardEditorPreview, scheduleFocusComposer } = deps;

  const handleBoardEditorToggleInputWrapClick = (target: HTMLElement | null, event: Event): boolean => {
    const boardToggle = target?.closest("button[data-action='board-editor-toggle']") as HTMLButtonElement | null;
    if (!boardToggle) return false;
    const st = store.get();
    const activeConversation = getActiveConversationTarget(st);
    if (!activeConversation || activeConversation.kind !== "board") return true;
    event.preventDefault();
    const board = (st.boards || []).find((entry) => entry.id === activeConversation.id);
    const owner = String(board?.owner_id || "").trim();
    const me = String(st.selfId || "").trim();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return true;
    }
    if (owner && me && owner !== me) {
      store.set({ status: "На доске писать может только владелец" });
      return true;
    }
    store.set((prev) => ({ ...prev, boardComposerOpen: !prev.boardComposerOpen }));
    queueMicrotask(() => {
      scheduleBoardEditorPreview();
      scheduleFocusComposer();
    });
    return true;
  };

  return {
    handleBoardEditorToggleInputWrapClick,
  };
}
