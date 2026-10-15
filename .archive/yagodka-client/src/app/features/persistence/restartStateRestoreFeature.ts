import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { applyRestartAppShellState } from "../../../helpers/navigation/appShellState";
import type { RestartStateFeature } from "./restartStateFeature";

export interface RestartStateRestoreFeatureDeps {
  store: Store<AppState>;
  restartStateFeature: RestartStateFeature;
  input: HTMLTextAreaElement;
  autosizeInput: (input: HTMLTextAreaElement) => void;
}

export function applyRestartStateSnapshot(deps: RestartStateRestoreFeatureDeps): void {
  const { store, restartStateFeature, input, autosizeInput } = deps;

  const restored = restartStateFeature.consume();
  if (!restored) return;

  store.set((prev) => applyRestartAppShellState(prev, restored));

  try {
    input.value = restored.input ?? "";
    autosizeInput(input);
  } catch {
    // ignore
  }
}
