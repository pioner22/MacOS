import { updateDraftMap } from "../../../helpers/chat/drafts";
import { getConversationViewportKey } from "../../../helpers/navigation/mainConversationState";
import { applyDraftMapMutation } from "../../../helpers/runtime/deliverySync";
import { scheduleSaveDrafts } from "../persistence/localPersistenceTimers";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface ComposerInputStateFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  inputWrap: HTMLElement;
  autosizeInput: (el: HTMLTextAreaElement) => void;
}

export interface ComposerInputStateFeature {
  scheduleAutosize: () => void;
  setPendingInputValue: (value: string) => void;
  commitInputUpdate: () => void;
  updateComposerTypingUi: (forceOff?: boolean) => void;
  handleInputEvent: () => void;
  handleFocus: () => void;
  handleBlur: () => void;
}

export function createComposerInputStateFeature(deps: ComposerInputStateFeatureDeps): ComposerInputStateFeature {
  const { store, input, inputWrap, autosizeInput } = deps;

  let autosizeRaf: number | null = null;
  let pendingInputValue: string | null = null;
  let lastCommittedInput = input.value || "";
  let inputCommitTimer: number | null = null;
  let lastCommitAt = 0;
  const INPUT_COMMIT_MS = 140;

  const scheduleAutosize = () => {
    if (autosizeRaf !== null) return;
    autosizeRaf = window.requestAnimationFrame(() => {
      autosizeRaf = null;
      autosizeInput(input);
    });
  };

  const commitInputUpdate = () => {
    if (inputCommitTimer !== null) {
      window.clearTimeout(inputCommitTimer);
      inputCommitTimer = null;
    }
    const value = pendingInputValue ?? input.value ?? "";
    pendingInputValue = null;
    if (value === lastCommittedInput) return;
    lastCommittedInput = value;
    store.set((prev) => {
      const key = getConversationViewportKey(prev);
      const isEditing = Boolean(prev.editing && key && prev.editing.key === key);
      const drafts = key && !isEditing ? updateDraftMap(prev.drafts, key, value) : prev.drafts;
      return { ...applyDraftMapMutation(prev, drafts), input: value };
    });
    scheduleSaveDrafts(store);
  };

  const updateComposerTypingUi = (forceOff = false) => {
    try {
      const hasText = Boolean(String(input.value || "").trim());
      inputWrap.classList.toggle("composer-has-text", hasText);

      if (forceOff) {
        inputWrap.classList.remove("composer-typing");
        if (typeof document !== "undefined") document.documentElement.classList.remove("app-typing");
        return;
      }
      const active = Boolean(document.activeElement === input && hasText);
      inputWrap.classList.toggle("composer-typing", active);
      if (typeof document !== "undefined") document.documentElement.classList.toggle("app-typing", active);
    } catch {
      // ignore
    }
  };

  const handleInputEvent = () => {
    pendingInputValue = input.value || "";
    scheduleAutosize();
    updateComposerTypingUi();
    const now = Date.now();
    if (now - lastCommitAt >= INPUT_COMMIT_MS) {
      lastCommitAt = now;
      commitInputUpdate();
      return;
    }
    if (inputCommitTimer !== null) return;
    const delay = Math.max(24, INPUT_COMMIT_MS - (now - lastCommitAt));
    inputCommitTimer = window.setTimeout(() => {
      lastCommitAt = Date.now();
      commitInputUpdate();
    }, delay);
  };

  const handleFocus = () => {
    scheduleAutosize();
    updateComposerTypingUi();
  };

  const handleBlur = () => {
    scheduleAutosize();
    updateComposerTypingUi(true);
    commitInputUpdate();
  };

  const setPendingInputValue = (value: string) => {
    pendingInputValue = value;
  };

  return {
    scheduleAutosize,
    setPendingInputValue,
    commitInputUpdate,
    updateComposerTypingUi,
    handleInputEvent,
    handleFocus,
    handleBlur,
  };
}
