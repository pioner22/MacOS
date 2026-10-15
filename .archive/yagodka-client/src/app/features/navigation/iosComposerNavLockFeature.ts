import { isIOS } from "../../../helpers/ui/iosInputAssistant";

type DisabledField = {
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  disabled: boolean;
};

export interface IosComposerNavLockFeatureDeps {
  input: HTMLTextAreaElement;
}

export interface IosComposerNavLockFeature {
  applyLock: () => void;
  restoreLock: () => void;
}

export function createIosComposerNavLockFeature(deps: IosComposerNavLockFeatureDeps): IosComposerNavLockFeature {
  const { input } = deps;
  let disabledFields: DisabledField[] = [];

  const restoreLock = () => {
    if (!disabledFields.length) return;
    for (const it of disabledFields) {
      try {
        it.el.disabled = it.disabled;
      } catch {
        // ignore
      }
    }
    disabledFields = [];
  };

  const applyLock = () => {
    if (!isIOS()) return;
    restoreLock();
    const keep = new Set<Element>([input]);
    const candidates: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = [];
    try {
      const nodes = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
      for (const node of Array.from(nodes)) {
        if (!node || keep.has(node)) continue;
        candidates.push(node);
      }
    } catch {
      // ignore
    }
    for (const node of candidates) {
      try {
        disabledFields.push({ el: node, disabled: node.disabled });
        node.disabled = true;
      } catch {
        // ignore
      }
    }
  };

  return {
    applyLock,
    restoreLock,
  };
}
