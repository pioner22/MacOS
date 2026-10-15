export interface ComposerViewportResizeAutosizeFeatureDeps {
  input: HTMLTextAreaElement;
  autosizeInput: (el: HTMLTextAreaElement) => void;
}

export interface ComposerViewportResizeAutosizeFeature {
  bind: () => void;
}

export function createComposerViewportResizeAutosizeFeature(
  deps: ComposerViewportResizeAutosizeFeatureDeps
): ComposerViewportResizeAutosizeFeature {
  const { input, autosizeInput } = deps;

  const bind = () => {
    const vv = window.visualViewport;
    const onViewportResize = () => {
      if (document.activeElement !== input) return;
      autosizeInput(input);
    };
    vv?.addEventListener("resize", onViewportResize, { passive: true });
  };

  return {
    bind,
  };
}
