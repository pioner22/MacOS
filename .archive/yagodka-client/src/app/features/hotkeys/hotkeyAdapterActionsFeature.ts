import type { HotkeysFeatureDeps } from "./hotkeysFeature";

type HotkeyAdapterActionsCoreDeps = Omit<HotkeysFeatureDeps, "store" | "hotkeysRoot">;

export type HotkeyAdapterActionsFeatureDeps = HotkeyAdapterActionsCoreDeps;

export type HotkeyAdapterActionsFeature = HotkeyAdapterActionsCoreDeps;

export function createHotkeyAdapterActionsFeature(deps: HotkeyAdapterActionsFeatureDeps): HotkeyAdapterActionsFeature {
  return { ...deps };
}
