import { armCtxClickSuppression, type CtxClickSuppressionState } from "../../../helpers/ui/ctxClickSuppression";
import type { Store } from "../../../stores/store";
import type { AppState, ContextMenuTargetKind } from "../../../stores/types";
import type { SidebarContextMenuScrollFeature } from "./sidebarContextMenuScrollFeature";

const SIDEBAR_MOUSE_CLICK_SUPPRESS_MS = 650;
const SIDEBAR_MOUSE_KEY_SUPPRESS_MS = 1800;

export interface SidebarMouseContextMenuFeatureDeps {
  store: Store<AppState>;
  sidebar: HTMLElement;
  coarsePointerMq: MediaQueryList | null;
  sidebarContextMenuScrollFeature: SidebarContextMenuScrollFeature;
  getClickSuppressionState: () => CtxClickSuppressionState;
  setClickSuppressionState: (state: CtxClickSuppressionState) => void;
  openContextMenu: (target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) => void;
}

export interface SidebarMouseContextMenuFeature {
  installEventListeners: () => void;
  dispose: () => void;
}

export function createSidebarMouseContextMenuFeature(
  deps: SidebarMouseContextMenuFeatureDeps
): SidebarMouseContextMenuFeature {
  const {
    store,
    sidebar,
    coarsePointerMq,
    sidebarContextMenuScrollFeature,
    getClickSuppressionState,
    setClickSuppressionState,
    openContextMenu,
  } = deps;

  let listenersInstalled = false;

  const isContextClick = (ev: { button: number; ctrlKey: boolean }) => ev.button === 2 || (ev.button === 0 && ev.ctrlKey);

  const findContextButton = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;

  const onPointerDown = (e: Event) => {
    const ev = e as PointerEvent;
    if (ev.pointerType !== "mouse") return;
    if (!isContextClick(ev)) return;
    const btn = findContextButton(ev.target);
    if (!btn) return;
    sidebarContextMenuScrollFeature.suppressMouseFallbackFor(250);
    sidebarContextMenuScrollFeature.rememberSidebarCtxScroll();
    const { top, left } = sidebarContextMenuScrollFeature.readSidebarCtxScrollSnapshot();
    sidebarContextMenuScrollFeature.stabilizeSidebarScrollOnContextClick(top, left);
    sidebarContextMenuScrollFeature.armSidebarCtxScrollHold(top, left);
    ev.preventDefault();
    ev.stopPropagation();
    sidebarContextMenuScrollFeature.armSidebarClickSuppression(SIDEBAR_MOUSE_CLICK_SUPPRESS_MS);
  };

  const onMouseDown = (e: Event) => {
    const ev = e as MouseEvent;
    if (sidebarContextMenuScrollFeature.isMouseFallbackSuppressed()) return;
    if (!isContextClick(ev)) return;
    const btn = findContextButton(ev.target);
    if (!btn) return;
    sidebarContextMenuScrollFeature.rememberSidebarCtxScroll();
    const { top, left } = sidebarContextMenuScrollFeature.readSidebarCtxScrollSnapshot();
    sidebarContextMenuScrollFeature.stabilizeSidebarScrollOnContextClick(top, left);
    sidebarContextMenuScrollFeature.armSidebarCtxScrollHold(top, left);
    ev.preventDefault();
    ev.stopPropagation();
    sidebarContextMenuScrollFeature.armSidebarClickSuppression(SIDEBAR_MOUSE_CLICK_SUPPRESS_MS);
  };

  // Restore scroll before `contextmenu` if browser changes it on mouseup.
  const onPointerUp = (e: Event) => {
    const ev = e as PointerEvent;
    if (ev.pointerType !== "mouse") return;
    if (!isContextClick(ev)) return;
    const btn = findContextButton(ev.target);
    if (!btn) return;
    const { top, left } = sidebarContextMenuScrollFeature.readSidebarCtxScrollSnapshot();
    sidebarContextMenuScrollFeature.restoreSidebarCtxScroll(top, left);
  };

  const onMouseUp = (e: Event) => {
    const ev = e as MouseEvent;
    if (!isContextClick(ev)) return;
    const btn = findContextButton(ev.target);
    if (!btn) return;
    const { top, left } = sidebarContextMenuScrollFeature.readSidebarCtxScrollSnapshot();
    sidebarContextMenuScrollFeature.restoreSidebarCtxScroll(top, left);
  };

  const onContextMenu = (e: Event) => {
    const ev = e as MouseEvent;
    const isTouchContext = Boolean(coarsePointerMq?.matches) && ev.button === 0;
    if (isTouchContext) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    const { top: prevTop, left: prevLeft } = sidebarContextMenuScrollFeature.readSidebarCtxScrollSnapshot();
    const btn = findContextButton(ev.target);
    if (!btn) return;

    ev.preventDefault();
    ev.stopPropagation();
    // In some browsers Ctrl+Click may still generate a click; suppress list activation/jump.
    sidebarContextMenuScrollFeature.armSidebarClickSuppression(SIDEBAR_MOUSE_CLICK_SUPPRESS_MS);

    const st = store.get();
    if (st.modal) {
      sidebarContextMenuScrollFeature.restoreSidebarCtxScroll(prevTop, prevLeft);
      sidebarContextMenuScrollFeature.disarmSidebarCtxScrollHold();
      return;
    }

    // Stabilize scroll before rendering the menu to avoid rare jumps.
    sidebarContextMenuScrollFeature.stabilizeSidebarScrollOnContextClick(prevTop, prevLeft);
    sidebarContextMenuScrollFeature.armSidebarCtxScrollHold(prevTop, prevLeft);
    const kind = (btn.getAttribute("data-ctx-kind") || "").trim() as ContextMenuTargetKind;
    const id = (btn.getAttribute("data-ctx-id") || "").trim();
    if (!kind || !id) return;

    const nextSuppressionState = armCtxClickSuppression(
      getClickSuppressionState(),
      kind,
      id,
      SIDEBAR_MOUSE_KEY_SUPPRESS_MS
    );
    setClickSuppressionState(nextSuppressionState);
    openContextMenu({ kind, id }, ev.clientX, ev.clientY);

    // Extra guard for browsers that adjust scroll while native menu takes focus.
    const onFocus = (focusEvent: FocusEvent) => {
      const target = focusEvent.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest(".ctx-menu")) return;
      document.removeEventListener("focusin", onFocus, true);
      sidebarContextMenuScrollFeature.restoreSidebarCtxScroll(prevTop, prevLeft);
    };
    document.addEventListener("focusin", onFocus, true);
    window.setTimeout(() => document.removeEventListener("focusin", onFocus, true), 900);
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    sidebar.addEventListener("pointerdown", onPointerDown, true);
    sidebar.addEventListener("mousedown", onMouseDown, true);
    sidebar.addEventListener("pointerup", onPointerUp, true);
    sidebar.addEventListener("mouseup", onMouseUp, true);
    sidebar.addEventListener("contextmenu", onContextMenu);
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    sidebar.removeEventListener("pointerdown", onPointerDown, true);
    sidebar.removeEventListener("mousedown", onMouseDown, true);
    sidebar.removeEventListener("pointerup", onPointerUp, true);
    sidebar.removeEventListener("mouseup", onMouseUp, true);
    sidebar.removeEventListener("contextmenu", onContextMenu);
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
  };
}
