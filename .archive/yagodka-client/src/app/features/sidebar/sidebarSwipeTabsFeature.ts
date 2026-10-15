import { normalizeMobileSidebarTab } from "../../../helpers/sidebar/sidebarState";
import type { Store } from "../../../stores/store";
import type { AppState, MobileSidebarTab } from "../../../stores/types";

const MOBILE_SIDEBAR_TAB_ORDER: MobileSidebarTab[] = ["contacts", "groups", "boards", "menu"];

export interface SidebarSwipeTabsFeatureDeps {
  store: Store<AppState>;
  sidebar: HTMLElement;
  sidebarBody: HTMLElement;
  mobileSidebarMq: MediaQueryList;
  isMobileSidebarOpen: () => boolean;
  setMobileSidebarTab: (tab: MobileSidebarTab) => void;
  armSidebarClickSuppression: (ms: number) => void;
  onClearLongPress: () => void;
}

export interface SidebarSwipeTabsFeature {
  installEventListeners: () => void;
  dispose: () => void;
}

export function createSidebarSwipeTabsFeature(deps: SidebarSwipeTabsFeatureDeps): SidebarSwipeTabsFeature {
  const {
    store,
    sidebar,
    sidebarBody,
    mobileSidebarMq,
    isMobileSidebarOpen,
    setMobileSidebarTab,
    armSidebarClickSuppression,
    onClearLongPress,
  } = deps;

  let listenersInstalled = false;

  let sidebarSwipePointerId: number | null = null;
  let sidebarSwipeStartX = 0;
  let sidebarSwipeStartY = 0;
  let sidebarSwipeStartAt = 0;
  let sidebarSwipeLastX = 0;
  let sidebarSwipeLastY = 0;
  let sidebarSwipeHorizontal = false;
  let sidebarSwipeLockUntil = 0;
  let sidebarSwipeScrollWasHidden = false;

  const resetSidebarSwipe = () => {
    sidebarSwipePointerId = null;
    sidebarSwipeStartX = 0;
    sidebarSwipeStartY = 0;
    sidebarSwipeStartAt = 0;
    sidebarSwipeLastX = 0;
    sidebarSwipeLastY = 0;
    sidebarSwipeHorizontal = false;
  };

  const clearSidebarSwipeFx = () => {
    if (sidebarSwipeScrollWasHidden) {
      sidebarSwipeScrollWasHidden = false;
      sidebarBody.style.overflowY = "";
    }
    delete sidebar.dataset.swipeActive;
    delete sidebar.dataset.swipeAnim;
    sidebar.style.removeProperty("--sidebar-swipe-x");
    sidebar.style.removeProperty("--sidebar-swipe-scale");
    sidebar.style.removeProperty("--sidebar-swipe-opacity");
  };

  const setSidebarSwipeFx = (xPx: number, opts?: { anim?: boolean; scale?: number; opacity?: number }) => {
    const anim = Boolean(opts?.anim);
    const scale = Number.isFinite(opts?.scale) ? Number(opts?.scale) : 1;
    const opacity = Number.isFinite(opts?.opacity) ? Number(opts?.opacity) : 1;
    sidebar.dataset.swipeActive = "1";
    if (anim) sidebar.dataset.swipeAnim = "1";
    else delete sidebar.dataset.swipeAnim;
    sidebar.style.setProperty("--sidebar-swipe-x", `${Math.round(xPx)}px`);
    sidebar.style.setProperty("--sidebar-swipe-scale", String(Math.max(0.9, Math.min(1, scale))));
    sidebar.style.setProperty("--sidebar-swipe-opacity", String(Math.max(0.3, Math.min(1, opacity))));
  };

  const canUseSidebarTabSwipe = (ev: PointerEvent, target: HTMLElement | null): boolean => {
    const st = store.get();
    if (st.modal) return false;
    if (!mobileSidebarMq.matches) return false;
    if (!isMobileSidebarOpen()) return false;
    if (Date.now() < sidebarSwipeLockUntil) return false;
    if (ev.pointerType === "mouse") return false;
    if (ev.button !== 0) return false;
    if (!target) return false;
    if (target.isContentEditable) return false;
    if (target.closest(".sidebar-searchbar")) return false;
    if (target.closest(".sidebar-tabs")) return false;
    if (target.closest("button[data-action='sidebar-close']")) return false;

    const vw = Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);
    const edge = Math.min(28, Math.max(18, Math.round(vw * 0.06)));
    if (vw > 0 && (ev.clientX <= edge || ev.clientX >= vw - edge)) return false;
    return true;
  };

  const sidebarSwipeThresholdPx = (): number => {
    const vw = Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);
    if (!vw) return 64;
    return Math.round(Math.min(110, Math.max(50, vw * 0.14)));
  };

  const nextMobileSidebarTab = (dir: -1 | 1): MobileSidebarTab | null => {
    const cur = normalizeMobileSidebarTab(store.get().mobileSidebarTab);
    const idx = MOBILE_SIDEBAR_TAB_ORDER.indexOf(cur);
    const safeIdx = idx >= 0 ? idx : MOBILE_SIDEBAR_TAB_ORDER.indexOf("contacts");
    const nextIdx = safeIdx + dir;
    if (nextIdx < 0 || nextIdx >= MOBILE_SIDEBAR_TAB_ORDER.length) return null;
    return MOBILE_SIDEBAR_TAB_ORDER[nextIdx] || null;
  };

  const sidebarSwipeWidth = (): number => {
    const rect = sidebar.getBoundingClientRect();
    const w = Math.round(rect.width || 0);
    return w > 0 ? w : Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);
  };

  const applySwipeResistance = (dx: number): number => {
    const w = sidebarSwipeWidth() || 1;
    const softMax = Math.max(72, Math.round(w * 0.28));
    const adx = Math.abs(dx);
    if (adx <= softMax) return dx;
    const extra = adx - softMax;
    return Math.sign(dx) * (softMax + extra * 0.22);
  };

  const applySidebarSwipeDragFx = (dx: number) => {
    const w = sidebarSwipeWidth() || 1;
    const x = applySwipeResistance(dx);
    const progress = Math.min(1, Math.abs(dx) / w);
    const scale = 1 - 0.025 * progress;
    const opacity = 1 - 0.1 * progress;
    setSidebarSwipeFx(x, { anim: false, scale, opacity });
  };

  const afterSidebarSwipeTransition = (cb: () => void, timeoutMs = 260) => {
    let done = false;
    let timer = 0;
    const sticky = sidebar.querySelector(".sidebar-mobile-sticky") as HTMLElement | null;
    const finish = () => {
      if (done) return;
      done = true;
      sidebarBody.removeEventListener("transitionend", onEnd);
      sticky?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
      cb();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "transform") return;
      finish();
    };
    sidebarBody.addEventListener("transitionend", onEnd);
    sticky?.addEventListener("transitionend", onEnd);
    timer = window.setTimeout(finish, timeoutMs);
  };

  const snapSidebarSwipeBack = () => {
    setSidebarSwipeFx(0, { anim: true, scale: 1, opacity: 1 });
    afterSidebarSwipeTransition(() => clearSidebarSwipeFx());
  };

  const runSidebarSwipeCommit = (dir: -1 | 1) => {
    const nextTab = nextMobileSidebarTab(dir);
    if (!nextTab) {
      snapSidebarSwipeBack();
      return;
    }

    const w = sidebarSwipeWidth();
    const outX = dir === 1 ? -w : w;
    sidebarSwipeLockUntil = Date.now() + 650;
    armSidebarClickSuppression(650);

    setSidebarSwipeFx(outX, { anim: true, scale: 0.98, opacity: 0.6 });
    afterSidebarSwipeTransition(() => {
      // Put the next tab offscreen without animation, then render it.
      setSidebarSwipeFx(-outX, { anim: false, scale: 0.98, opacity: 0.6 });
      setMobileSidebarTab(nextTab);
      // Animate the new tab into place.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setSidebarSwipeFx(0, { anim: true, scale: 1, opacity: 1 });
          afterSidebarSwipeTransition(() => clearSidebarSwipeFx(), 320);
        });
      });
    }, 320);
  };

  const onPointerDown = (e: Event) => {
    const ev = e as PointerEvent;
    const target = ev.target as HTMLElement | null;
    if (!canUseSidebarTabSwipe(ev, target)) return;
    clearSidebarSwipeFx();
    resetSidebarSwipe();
    sidebarSwipePointerId = ev.pointerId;
    sidebarSwipeStartX = ev.clientX;
    sidebarSwipeStartY = ev.clientY;
    sidebarSwipeStartAt = Date.now();
    sidebarSwipeLastX = ev.clientX;
    sidebarSwipeLastY = ev.clientY;
  };

  const onPointerMove = (e: Event) => {
    if (sidebarSwipePointerId === null) return;
    const ev = e as PointerEvent;
    if (ev.pointerId !== sidebarSwipePointerId) return;
    sidebarSwipeLastX = ev.clientX;
    sidebarSwipeLastY = ev.clientY;

    const dx = ev.clientX - sidebarSwipeStartX;
    const dy = ev.clientY - sidebarSwipeStartY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (!sidebarSwipeHorizontal) {
      // If the user scrolls vertically, stop tracking this gesture as a tab swipe.
      if (ady > 14 && ady > adx + 6) {
        clearSidebarSwipeFx();
        resetSidebarSwipe();
        return;
      }
      // If the movement is clearly horizontal, treat it as a swipe gesture.
      if (adx > 14 && adx > ady + 6) {
        sidebarSwipeHorizontal = true;
        onClearLongPress();
        if (!sidebarSwipeScrollWasHidden) {
          sidebarSwipeScrollWasHidden = true;
          sidebarBody.style.overflowY = "hidden";
        }
      }
      return;
    }

    applySidebarSwipeDragFx(dx);

    // Too diagonal/vertical movement -> cancel to avoid accidental tab switch.
    if (ady > 140) {
      snapSidebarSwipeBack();
      resetSidebarSwipe();
    }
  };

  const consumeSidebarSwipe = (ev: PointerEvent): boolean => {
    if (sidebarSwipePointerId === null) return false;
    if (ev.pointerId !== sidebarSwipePointerId) return false;
    const dx = sidebarSwipeLastX - sidebarSwipeStartX;
    const dy = sidebarSwipeLastY - sidebarSwipeStartY;
    const dt = Date.now() - sidebarSwipeStartAt;
    const wasHorizontal = sidebarSwipeHorizontal;
    resetSidebarSwipe();
    if (!wasHorizontal) {
      clearSidebarSwipeFx();
      return false;
    }

    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const threshold = sidebarSwipeThresholdPx();
    if (dt > 900) {
      snapSidebarSwipeBack();
      return false;
    }

    const vel = adx / Math.max(1, dt); // px/ms
    const fast = vel > 0.9 && adx > 34;
    const strongHorizontal = adx >= ady * 1.5;
    const shouldCommit = strongHorizontal && (adx >= threshold || fast);
    if (!shouldCommit) {
      snapSidebarSwipeBack();
      return false;
    }

    // Telegram-like: swipe left -> next tab (to the right), swipe right -> prev tab.
    runSidebarSwipeCommit(dx < 0 ? 1 : -1);
    return true;
  };

  const onPointerUp = (e: Event) => {
    void consumeSidebarSwipe(e as PointerEvent);
  };

  const onPointerCancel = () => {
    clearSidebarSwipeFx();
    resetSidebarSwipe();
  };

  const onScroll = () => {
    clearSidebarSwipeFx();
    resetSidebarSwipe();
    onClearLongPress();
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    sidebarBody.addEventListener("pointerdown", onPointerDown);
    sidebarBody.addEventListener("pointermove", onPointerMove);
    sidebarBody.addEventListener("pointerup", onPointerUp);
    sidebarBody.addEventListener("pointercancel", onPointerCancel);
    sidebarBody.addEventListener("scroll", onScroll, { passive: true });
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    sidebarBody.removeEventListener("pointerdown", onPointerDown);
    sidebarBody.removeEventListener("pointermove", onPointerMove);
    sidebarBody.removeEventListener("pointerup", onPointerUp);
    sidebarBody.removeEventListener("pointercancel", onPointerCancel);
    sidebarBody.removeEventListener("scroll", onScroll);
    clearSidebarSwipeFx();
    resetSidebarSwipe();
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
  };
}
