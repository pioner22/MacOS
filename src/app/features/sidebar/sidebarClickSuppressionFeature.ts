import { consumeCtxClickSuppression, type CtxClickSuppressionState } from "../../../helpers/ui/ctxClickSuppression";

export interface SidebarClickSuppressionFeatureDeps {
  sidebar: HTMLElement;
  getClickSuppressionState: () => CtxClickSuppressionState;
  setClickSuppressionState: (state: CtxClickSuppressionState) => void;
  isSidebarClickSuppressed: () => boolean;
  disarmSidebarClickSuppression: () => void;
}

export interface SidebarClickSuppressionFeature {
  installEventListeners: () => void;
  dispose: () => void;
}

export function createSidebarClickSuppressionFeature(
  deps: SidebarClickSuppressionFeatureDeps
): SidebarClickSuppressionFeature {
  const {
    sidebar,
    getClickSuppressionState,
    setClickSuppressionState,
    disarmSidebarClickSuppression,
  } = deps;

  let listenersInstalled = false;

  const onClick = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
    if (!btn) return;

    const kind = (btn.getAttribute("data-ctx-kind") || "").trim();
    const id = (btn.getAttribute("data-ctx-id") || "").trim();
    const consumed = consumeCtxClickSuppression(getClickSuppressionState(), kind, id);
    setClickSuppressionState(consumed.state);
    const keySuppressed = consumed.suppressed;
    const shouldSuppress = keySuppressed;
    if (!shouldSuppress) return;
    e.preventDefault();
    e.stopPropagation();
    btn.removeAttribute("data-ctx-suppress-until");
    disarmSidebarClickSuppression();
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    sidebar.addEventListener("click", onClick, true);
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    sidebar.removeEventListener("click", onClick, true);
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
  };
}
