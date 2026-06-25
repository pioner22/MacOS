const STORAGE_KEY = "sidebar-left-width";
const MIN_SIDEBAR_WIDTH = 308;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_COLLAPSE_FACTOR = 0.65;
const COLLAPSED_SIDEBAR_WIDTH = 80;
const COLLAPSED_ROOT_CLASS = "sidebar-left-collapsed";
const DESKTOP_MEDIA_QUERY = "(min-width: 926px)";

type SidebarResizeState = {
  width: number;
  collapsed: boolean;
  stored: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeWidth = (raw: number | null | undefined): SidebarResizeState => {
  let next = Number.isFinite(raw as number) ? Number(raw) : MAX_SIDEBAR_WIDTH;
  if (next > MAX_SIDEBAR_WIDTH) next = MAX_SIDEBAR_WIDTH;
  if (next < MIN_SIDEBAR_WIDTH * SIDEBAR_COLLAPSE_FACTOR) {
    return { width: COLLAPSED_SIDEBAR_WIDTH, collapsed: true, stored: 0 };
  }
  next = clamp(next, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
  return { width: Math.round(next), collapsed: false, stored: Math.round(next) };
};

const readStoredWidth = (): number | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const storeWidth = (value: number) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // ignore storage errors
  }
};

export function installSidebarLeftResize(sidebar: HTMLElement, handle: HTMLElement | null): void {
  if (!handle) return;
  const root = document.documentElement;
  const desktopQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
  const syncRootClass = (collapsed: boolean) => {
    root.classList.toggle(COLLAPSED_ROOT_CLASS, collapsed && desktopQuery.matches);
  };
  const applyState = (state: SidebarResizeState, persist: boolean) => {
    root.style.setProperty("--current-sidebar-left-width", `${state.width}px`);
    sidebar.classList.toggle("sidebar-collapsed", state.collapsed);
    syncRootClass(state.collapsed);
    if (persist) storeWidth(state.stored);
  };

  const initialStored = readStoredWidth();
  const initialState = normalizeWidth(initialStored);
  applyState(initialState, initialStored !== null && initialState.stored !== initialStored);

  let pointerId: number | null = null;
  let startX = 0;
  let startWidth = initialState.width;
  let lastState = initialState;

  desktopQuery.addEventListener("change", () => syncRootClass(lastState.collapsed));

  const cleanupPointerStyles = () => {
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  const onPointerMove = (event: PointerEvent) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const delta = event.clientX - startX;
    lastState = normalizeWidth(startWidth + delta);
    applyState(lastState, false);
  };

  const stopDrag = (event: PointerEvent) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    pointerId = null;
    handle.classList.remove("is-active");
    cleanupPointerStyles();
    handle.releasePointerCapture(event.pointerId);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
    applyState(lastState, true);
  };

  handle.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startWidth = sidebar.getBoundingClientRect().width || initialState.width;
    lastState = normalizeWidth(startWidth);
    handle.classList.add("is-active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    event.preventDefault();
  });
}
