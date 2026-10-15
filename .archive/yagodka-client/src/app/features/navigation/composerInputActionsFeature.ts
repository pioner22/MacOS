export interface ComposerInputActionsFeatureDeps {
  cancelEditing: () => void;
  openComposerHelperMenu: (x: number, y: number) => void;
  clearComposerHelper: () => void;
}

export interface ComposerInputActionsFeature {
  handleComposerInputWrapClick: (target: HTMLElement | null, event: Event) => boolean;
}

export function createComposerInputActionsFeature(deps: ComposerInputActionsFeatureDeps): ComposerInputActionsFeature {
  const { cancelEditing, openComposerHelperMenu, clearComposerHelper } = deps;

  const handleComposerInputWrapClick = (target: HTMLElement | null, event: Event): boolean => {
    const cancelBtn = target?.closest("button[data-action='composer-edit-cancel']") as HTMLButtonElement | null;
    if (cancelBtn) {
      event.preventDefault();
      cancelEditing();
      return true;
    }

    const helperMenuBtn = target?.closest("button[data-action='composer-helper-menu']") as HTMLButtonElement | null;
    if (helperMenuBtn) {
      event.preventDefault();
      const rect = helperMenuBtn.getBoundingClientRect();
      openComposerHelperMenu(rect.right, rect.bottom);
      return true;
    }

    const helperCancelBtn = target?.closest("button[data-action='composer-helper-cancel']") as HTMLButtonElement | null;
    if (helperCancelBtn) {
      event.preventDefault();
      clearComposerHelper();
      return true;
    }

    return false;
  };

  return {
    handleComposerInputWrapClick,
  };
}
