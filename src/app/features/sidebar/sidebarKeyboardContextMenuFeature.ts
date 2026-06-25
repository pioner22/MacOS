import type { Store } from "../../../stores/store";
import type { AppState, ContextMenuTargetKind } from "../../../stores/types";

export interface SidebarKeyboardContextMenuFeatureDeps {
  store: Store<AppState>;
  sidebar: HTMLElement;
  openContextMenu: (target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) => void;
}

export interface SidebarKeyboardContextMenuFeature {
  installEventListeners: () => void;
  dispose: () => void;
}

export function createSidebarKeyboardContextMenuFeature(
  deps: SidebarKeyboardContextMenuFeatureDeps
): SidebarKeyboardContextMenuFeature {
  const { store, sidebar, openContextMenu } = deps;

  let listenersInstalled = false;

  const onKeyDown = (e: Event) => {
    const ev = e as KeyboardEvent;
    const st = store.get();
    if (st.modal) return;
    const isMenuKey = ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10");
    if (!isMenuKey) return;

    const btn = (document.activeElement as HTMLElement | null)?.closest(
      "button[data-ctx-kind][data-ctx-id]"
    ) as HTMLButtonElement | null;
    if (!btn) return;

    const kind = (btn.getAttribute("data-ctx-kind") || "").trim() as ContextMenuTargetKind;
    const id = (btn.getAttribute("data-ctx-id") || "").trim();
    if (!kind || !id) return;

    ev.preventDefault();
    const rect = btn.getBoundingClientRect();
    const x = Math.round(rect.left + Math.min(24, Math.max(8, rect.width / 2)));
    const y = Math.round(rect.bottom - 2);
    openContextMenu({ kind, id }, x, y);
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    sidebar.addEventListener("keydown", onKeyDown);
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    sidebar.removeEventListener("keydown", onKeyDown);
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
  };
}
