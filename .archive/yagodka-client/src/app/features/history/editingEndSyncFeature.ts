import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface EditingEndSyncFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  autosizeInput: (input: HTMLTextAreaElement) => void;
  scheduleBoardEditorPreview: () => void;
}

export function installEditingEndSyncFeature(deps: EditingEndSyncFeatureDeps): void {
  const { store, input, autosizeInput, scheduleBoardEditorPreview } = deps;

  let prevEditing: { key: string; id: number } | null = (() => {
    const e = store.get().editing;
    return e ? { key: e.key, id: e.id } : null;
  })();

  store.subscribe(() => {
    const st = store.get();
    const cur = st.editing ? { key: st.editing.key, id: st.editing.id } : null;
    const ended = Boolean(prevEditing && !cur);
    prevEditing = cur;
    if (!ended) return;
    try {
      const next = st.input || "";
      if (input.value !== next) input.value = next;
      autosizeInput(input);
      scheduleBoardEditorPreview();
    } catch {
      // ignore
    }
  });
}
