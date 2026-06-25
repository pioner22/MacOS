import { armCtxClickSuppression, type CtxClickSuppressionState } from "../../../helpers/ui/ctxClickSuppression";
import type { Store } from "../../../stores/store";
import type { AppState, ContextMenuTargetKind } from "../../../stores/types";

const SIDEBAR_LONG_PRESS_SUPPRESS_MS = 400;
const SIDEBAR_LONG_PRESS_DELAY_MS = 520;

export interface SidebarLongPressContextMenuFeatureDeps {
  store: Store<AppState>;
  sidebar: HTMLElement;
  sidebarBody: HTMLElement;
  getClickSuppressionState: () => CtxClickSuppressionState;
  setClickSuppressionState: (state: CtxClickSuppressionState) => void;
  openContextMenu: (target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) => void;
}

export interface SidebarLongPressContextMenuFeature {
  installEventListeners: () => void;
  dispose: () => void;
  clearLongPress: () => void;
}

export function createSidebarLongPressContextMenuFeature(
  deps: SidebarLongPressContextMenuFeatureDeps
): SidebarLongPressContextMenuFeature {
  const { store, sidebar, sidebarBody, getClickSuppressionState, setClickSuppressionState, openContextMenu } = deps;

  let listenersInstalled = false;
  let longPressTimer: number | null = null;
  let longPressStartX = 0;
  let longPressStartY = 0;

  const clearLongPress = () => {
    if (longPressTimer === null) return;
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  const onPointerDown = (e: Event) => {
    const st = store.get();
    if (st.modal) return;
    const ev = e as PointerEvent;
    // Only long-press for touch/pen (mouse has right click).
    if (ev.pointerType === "mouse") return;
    if (ev.button !== 0) return;
    const btn = (ev.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
    if (!btn) return;
    const kind = (btn.getAttribute("data-ctx-kind") || "").trim() as ContextMenuTargetKind;
    const id = (btn.getAttribute("data-ctx-id") || "").trim();
    if (!kind || !id) return;

    clearLongPress();
    longPressStartX = ev.clientX;
    longPressStartY = ev.clientY;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      const suppressUntil = Date.now() + SIDEBAR_LONG_PRESS_SUPPRESS_MS;
      btn.setAttribute("data-ctx-suppress-until", String(suppressUntil));
      const prevTop = sidebarBody.scrollTop;
      const prevLeft = sidebarBody.scrollLeft;
      const nextSuppression = armCtxClickSuppression(getClickSuppressionState(), kind, id, SIDEBAR_LONG_PRESS_SUPPRESS_MS);
      setClickSuppressionState(nextSuppression);
      openContextMenu({ kind, id }, longPressStartX, longPressStartY);
      window.requestAnimationFrame(() => {
        if (sidebarBody.scrollTop !== prevTop) sidebarBody.scrollTop = prevTop;
        if (sidebarBody.scrollLeft !== prevLeft) sidebarBody.scrollLeft = prevLeft;
      });
      window.setTimeout(() => {
        if (sidebarBody.scrollTop !== prevTop) sidebarBody.scrollTop = prevTop;
        if (sidebarBody.scrollLeft !== prevLeft) sidebarBody.scrollLeft = prevLeft;
      }, 0);
    }, SIDEBAR_LONG_PRESS_DELAY_MS);
  };

  const onPointerMove = (e: Event) => {
    if (longPressTimer === null) return;
    const ev = e as PointerEvent;
    const dx = Math.abs(ev.clientX - longPressStartX);
    const dy = Math.abs(ev.clientY - longPressStartY);
    if (dx > 12 || dy > 12) clearLongPress();
  };

  const onPointerUp = () => clearLongPress();
  const onPointerCancel = () => clearLongPress();

  function installEventListeners() {
    if (listenersInstalled) return;
    sidebar.addEventListener("pointerdown", onPointerDown);
    sidebar.addEventListener("pointermove", onPointerMove);
    sidebar.addEventListener("pointerup", onPointerUp);
    sidebar.addEventListener("pointercancel", onPointerCancel);
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    sidebar.removeEventListener("pointerdown", onPointerDown);
    sidebar.removeEventListener("pointermove", onPointerMove);
    sidebar.removeEventListener("pointerup", onPointerUp);
    sidebar.removeEventListener("pointercancel", onPointerCancel);
    clearLongPress();
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
    clearLongPress,
  };
}
