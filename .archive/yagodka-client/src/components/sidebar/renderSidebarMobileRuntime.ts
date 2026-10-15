import { el } from "../../helpers/dom/el";
import type { RenderSidebarMobileCtx } from "./renderSidebarMobile";

type SidebarMobileModule = typeof import("./renderSidebarMobile");

let sidebarMobileModule: SidebarMobileModule | null = null;
let sidebarMobilePromise: Promise<SidebarMobileModule | null> | null = null;
let latestSidebarMobileCtx: RenderSidebarMobileCtx | null = null;
let sidebarMobileLoadFailed = false;

function renderSidebarMobilePlaceholder(ctx: RenderSidebarMobileCtx, message: string) {
  const { target, body, bindHeaderScroll, setBodyChatlistClass } = ctx;
  bindHeaderScroll(null);
  setBodyChatlistClass([]);
  body.replaceChildren(
    el("div", { class: "pane-section sidebar-mobile-loading", role: "status", "aria-live": "polite", "aria-busy": "true" }, [
      el("div", { class: "msg msg-sys sidebar-mobile-loading-text" }, [message]),
    ])
  );
  target.replaceChildren(body);
}

function refreshDeferredSidebarMobile() {
  const ctx = latestSidebarMobileCtx;
  if (!ctx) return;
  if (sidebarMobileModule) {
    sidebarMobileModule.renderSidebarMobile(ctx);
    return;
  }
  renderSidebarMobilePlaceholder(ctx, sidebarMobileLoadFailed ? "Не удалось загрузить боковую панель" : "Загрузка панели…");
}

function ensureSidebarMobileModule() {
  if (sidebarMobileModule || sidebarMobilePromise) return;
  sidebarMobilePromise = import("./renderSidebarMobile")
    .then((mod) => {
      sidebarMobileModule = mod;
      sidebarMobileLoadFailed = false;
      refreshDeferredSidebarMobile();
      return mod;
    })
    .catch(() => {
      sidebarMobileLoadFailed = true;
      refreshDeferredSidebarMobile();
      return null;
    })
    .finally(() => {
      sidebarMobilePromise = null;
    });
}

export function renderSidebarMobileDeferred(ctx: RenderSidebarMobileCtx) {
  latestSidebarMobileCtx = ctx;
  if (sidebarMobileModule) {
    sidebarMobileModule.renderSidebarMobile(ctx);
    return;
  }
  renderSidebarMobilePlaceholder(ctx, sidebarMobileLoadFailed ? "Не удалось загрузить боковую панель" : "Загрузка панели…");
  ensureSidebarMobileModule();
}

export function clearDeferredSidebarMobile(target: HTMLElement) {
  if (!latestSidebarMobileCtx || latestSidebarMobileCtx.target !== target) return;
  latestSidebarMobileCtx = null;
}
