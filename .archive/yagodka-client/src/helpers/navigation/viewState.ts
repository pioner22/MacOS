import type { AppState, PageKind, TargetRef } from "../../stores/types";

type ViewPatch = Pick<AppState, "userViewId" | "groupViewId" | "boardViewId">;

export interface NavigationRestoreSnapshot {
  page?: PageKind | null;
  userViewId?: string | null;
  groupViewId?: string | null;
  boardViewId?: string | null;
  selected?: TargetRef | null;
}

function cleanId(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? value : null;
}

export function sanitizeTargetRef(raw: unknown): TargetRef | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const kind = String(source.kind || "").trim();
  const id = cleanId(source.id);
  if (!id) return null;
  if (kind !== "dm" && kind !== "group" && kind !== "board") return null;
  return { kind, id } as TargetRef;
}

export function createPageViewPatch(target: TargetRef | null): ViewPatch {
  if (!target) {
    return { userViewId: null, groupViewId: null, boardViewId: null };
  }
  if (target.kind === "dm") {
    return { userViewId: target.id, groupViewId: null, boardViewId: null };
  }
  if (target.kind === "group") {
    return { userViewId: null, groupViewId: target.id, boardViewId: null };
  }
  return { userViewId: null, groupViewId: null, boardViewId: target.id };
}

export function getPageViewTarget(
  state: Pick<AppState, "page" | "userViewId" | "groupViewId" | "boardViewId">
): TargetRef | null {
  if (state.page === "user") {
    const id = cleanId(state.userViewId);
    return id ? { kind: "dm", id } : null;
  }
  if (state.page === "group") {
    const id = cleanId(state.groupViewId);
    return id ? { kind: "group", id } : null;
  }
  if (state.page === "board") {
    const id = cleanId(state.boardViewId);
    return id ? { kind: "board", id } : null;
  }
  return null;
}

export function getRightPanelTarget(state: Pick<AppState, "rightPanel">): TargetRef | null {
  return sanitizeTargetRef(state.rightPanel);
}

export function applyPageState(prev: AppState, page: PageKind): AppState {
  const currentView = getPageViewTarget(prev);
  const keptView =
    page === "user"
      ? currentView?.kind === "dm"
        ? currentView
        : null
      : page === "group"
        ? currentView?.kind === "group"
          ? currentView
          : null
        : page === "board"
          ? currentView?.kind === "board"
            ? currentView
            : null
          : null;
  return {
    ...prev,
    page,
    ...createPageViewPatch(keptView),
    rightPanel: page === "main" ? getRightPanelTarget(prev) : null,
  };
}

export function applyPageTargetState(prev: AppState, target: TargetRef): AppState {
  const nextTarget = sanitizeTargetRef(target);
  if (!nextTarget) return prev;
  const page: PageKind = nextTarget.kind === "dm" ? "user" : nextTarget.kind;
  return {
    ...applyPageState(prev, page),
    ...createPageViewPatch(nextTarget),
  };
}

export function applyRightPanelTarget(prev: AppState, target: TargetRef | null): AppState {
  return { ...prev, rightPanel: sanitizeTargetRef(target) };
}

export function resetNavigationState(prev: AppState, opts?: { page?: PageKind }): AppState {
  return {
    ...prev,
    page: opts?.page || "main",
    selected: null,
    rightPanel: null,
    userViewId: null,
    groupViewId: null,
    boardViewId: null,
  };
}

export function applyRestartNavigationState(prev: AppState, restored: NavigationRestoreSnapshot): AppState {
  const page = restored.page || prev.page;
  const selected = sanitizeTargetRef(restored.selected);
  let next = applyPageState(prev, page);
  if (selected || restored.selected === null) {
    next = { ...next, selected };
  }
  if (page === "user") {
    const id = cleanId(restored.userViewId) || (selected?.kind === "dm" ? selected.id : null);
    return { ...next, ...createPageViewPatch(id ? { kind: "dm", id } : null) };
  }
  if (page === "group") {
    const id = cleanId(restored.groupViewId) || (selected?.kind === "group" ? selected.id : null);
    return { ...next, ...createPageViewPatch(id ? { kind: "group", id } : null) };
  }
  if (page === "board") {
    const id = cleanId(restored.boardViewId) || (selected?.kind === "board" ? selected.id : null);
    return { ...next, ...createPageViewPatch(id ? { kind: "board", id } : null) };
  }
  return { ...next, ...createPageViewPatch(null), rightPanel: null };
}
