import type { EmojiPopoverFeature, EmojiPopoverFeatureDeps } from "../features/emoji/emojiPopoverFeature";

export type { EmojiPopoverFeature } from "../features/emoji/emojiPopoverFeature";

type PendingEmojiAction =
  | { kind: "composer" }
  | {
      kind: "reaction";
      target: Parameters<EmojiPopoverFeature["openForReaction"]>[0];
    };

export function createLazyEmojiPopoverRuntime(deps: EmojiPopoverFeatureDeps): EmojiPopoverFeature {
  let featureImpl: EmojiPopoverFeature | null = null;
  let featurePromise: Promise<EmojiPopoverFeature> | null = null;
  let listenersInstalled = false;
  let pendingAction: PendingEmojiAction | null = null;

  const bootstrapButtonClick = (event: Event) => {
    event.preventDefault();
    open();
  };

  function clearBootstrapButtonListener(): void {
    deps.emojiButton.removeEventListener("click", bootstrapButtonClick);
  }

  function flushPendingAction(feature: EmojiPopoverFeature): void {
    const action = pendingAction;
    pendingAction = null;
    if (!action) return;
    if (action.kind === "reaction") feature.openForReaction(action.target);
    else feature.open();
  }

  function ensureFeatureLoaded(): Promise<EmojiPopoverFeature> {
    if (featureImpl) return Promise.resolve(featureImpl);
    if (!featurePromise) {
      featurePromise = import("../features/emoji/emojiPopoverFeature")
        .then(({ createEmojiPopoverFeature }) => {
          const feature = createEmojiPopoverFeature(deps);
          featureImpl = feature;
          clearBootstrapButtonListener();
          if (listenersInstalled) feature.installEventListeners();
          flushPendingAction(feature);
          return feature;
        })
        .catch((err) => {
          featurePromise = null;
          throw err;
        });
    }
    return featurePromise;
  }

  function installEventListeners(): void {
    if (listenersInstalled) return;
    listenersInstalled = true;
    if (featureImpl) {
      featureImpl.installEventListeners();
      return;
    }
    deps.emojiButton.addEventListener("click", bootstrapButtonClick);
  }

  function dispose(): void {
    pendingAction = null;
    clearBootstrapButtonListener();
    featureImpl?.dispose();
    listenersInstalled = false;
  }

  function open(): void {
    if (featureImpl) {
      featureImpl.open();
      return;
    }
    pendingAction = { kind: "composer" };
    void ensureFeatureLoaded().catch(() => {
      pendingAction = null;
    });
  }

  function openForReaction(target: Parameters<EmojiPopoverFeature["openForReaction"]>[0]): void {
    if (!target?.key || !target?.msgId) return;
    if (featureImpl) {
      featureImpl.openForReaction(target);
      return;
    }
    pendingAction = { kind: "reaction", target };
    void ensureFeatureLoaded().catch(() => {
      pendingAction = null;
    });
  }

  function close(): void {
    pendingAction = null;
    featureImpl?.close();
  }

  function isOpen(): boolean {
    return featureImpl?.isOpen() ?? false;
  }

  return {
    installEventListeners,
    dispose,
    open,
    openForReaction,
    close,
    isOpen,
  };
}
