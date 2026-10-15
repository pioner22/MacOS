import type { AppState, TargetRef } from "../../stores/types";
import { createPageViewPatch, getRightPanelTarget, sanitizeTargetRef } from "./viewState";

export function getRightPanelTitle(target: TargetRef | null): string {
  if (!target) return "";
  if (target.kind === "dm") return "Контакт";
  if (target.kind === "group") return "Чат";
  return "Доска";
}

export function isRightPanelActiveForSelected(
  state: Pick<AppState, "page" | "selected" | "rightPanel">
): boolean {
  const selected = sanitizeTargetRef(state.selected);
  const rightTarget = getRightPanelTarget(state);
  return Boolean(
    state.page === "main" &&
      selected &&
      rightTarget &&
      rightTarget.kind === selected.kind &&
      rightTarget.id === selected.id
  );
}

export function shouldShowRightPanel(
  state: Pick<AppState, "page" | "rightPanel">,
  opts?: { fullScreenActive?: boolean; mobileUi?: boolean }
): boolean {
  const target = getRightPanelTarget(state);
  return Boolean(!opts?.fullScreenActive && !opts?.mobileUi && state.page === "main" && target);
}

export function shouldShowRightPanelOverlay(
  state: Pick<AppState, "page" | "rightPanel" | "modal">,
  opts?: { overlayMatches?: boolean; mobileUi?: boolean }
): boolean {
  const target = getRightPanelTarget(state);
  return Boolean(!state.modal && !opts?.mobileUi && opts?.overlayMatches && state.page === "main" && target);
}

export function applyRightPanelViewState<T extends AppState>(state: T, target?: TargetRef | null): T {
  const nextTarget = sanitizeTargetRef(target ?? getRightPanelTarget(state));
  return { ...state, ...createPageViewPatch(nextTarget) };
}

export function syncRightPanelWithSelected(prev: AppState, target: TargetRef | null): AppState["rightPanel"] {
  const current = sanitizeTargetRef(prev.rightPanel);
  if (!current || !target) return current;
  return { kind: target.kind, id: target.id };
}
