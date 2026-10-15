import type {
  ContextMenuActionsFeature,
  ContextMenuActionsFeatureDeps,
} from "../features/contextMenu/contextMenuActionsFeature";
import { recoverFromLazyImportError } from "./lazyImportRecovery";

export function createLazyContextMenuActionsRuntime(
  deps: ContextMenuActionsFeatureDeps
): ContextMenuActionsFeature {
  let runtime: ContextMenuActionsFeature | null = null;
  let runtimePromise: Promise<ContextMenuActionsFeature | null> | null = null;

  async function ensureRuntime(): Promise<ContextMenuActionsFeature | null> {
    if (runtime) return runtime;
    if (!runtimePromise) {
      runtimePromise = import("../features/contextMenu/contextMenuActionsFeature")
        .then(({ createContextMenuActionsFeature }) => {
          const nextRuntime = createContextMenuActionsFeature(deps);
          runtime = nextRuntime;
          runtimePromise = null;
          return nextRuntime;
        })
        .catch((err) => {
          recoverFromLazyImportError(err, "context_menu_actions");
          runtimePromise = null;
          return null;
        });
    }
    return await runtimePromise;
  }

  return {
    async handleContextMenuAction(itemId: string) {
      const loadedRuntime = await ensureRuntime();
      await loadedRuntime?.handleContextMenuAction(itemId);
    },
  };
}
