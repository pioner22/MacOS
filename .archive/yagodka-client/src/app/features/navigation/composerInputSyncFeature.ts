export interface ComposerInputSyncFeatureDeps {
  input: HTMLTextAreaElement;
  setPendingInputValue: (value: string) => void;
  scheduleAutosize: () => void;
  scheduleBoardEditorPreview: () => void;
  updateComposerTypingUi: () => void;
  commitInputUpdate: () => void;
  applyInputFallback: (nextInput: string) => void;
}

export interface ComposerInputSyncFeature {
  getComposerText: () => string;
  applyComposerInput: (nextInput: string) => void;
}

export function createComposerInputSyncFeature(deps: ComposerInputSyncFeatureDeps): ComposerInputSyncFeature {
  const {
    input,
    setPendingInputValue,
    scheduleAutosize,
    scheduleBoardEditorPreview,
    updateComposerTypingUi,
    commitInputUpdate,
    applyInputFallback,
  } = deps;

  const getComposerText = () => String(input.value || "");

  const applyComposerInput = (nextInput: string) => {
    try {
      input.value = nextInput;
      setPendingInputValue(nextInput);
      scheduleAutosize();
      scheduleBoardEditorPreview();
      updateComposerTypingUi();
      commitInputUpdate();
    } catch {
      applyInputFallback(nextInput);
    }
  };

  return {
    getComposerText,
    applyComposerInput,
  };
}
