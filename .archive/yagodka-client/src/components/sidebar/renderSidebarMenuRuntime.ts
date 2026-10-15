import { el } from "../../helpers/dom/el";
import type { RenderSidebarMenuCtx } from "./renderSidebarMenuSurface";

type SidebarMenuModule = typeof import("./renderSidebarMenuSurface");

let sidebarMenuModule: SidebarMenuModule | null = null;
let sidebarMenuPromise: Promise<SidebarMenuModule | null> | null = null;
let latestSidebarMenuCtx: RenderSidebarMenuCtx | null = null;
let sidebarMenuLoadFailed = false;

function renderSidebarMenuPlaceholder(ctx: RenderSidebarMenuCtx, message: string) {
  ctx.mountDesktop([
    el("div", { class: "pane-section sidebar-menu-loading", role: "status", "aria-live": "polite", "aria-busy": "true" }, [
      el("div", { class: "msg msg-sys sidebar-menu-loading-text" }, [message]),
    ]),
  ]);
}

function refreshDeferredSidebarMenu() {
  const ctx = latestSidebarMenuCtx;
  if (!ctx) return;
  if (sidebarMenuModule) {
    sidebarMenuModule.renderSidebarMenuSurface(ctx);
    return;
  }
  renderSidebarMenuPlaceholder(ctx, sidebarMenuLoadFailed ? "Не удалось загрузить меню" : "Загрузка меню…");
}

function ensureSidebarMenuModule() {
  if (sidebarMenuModule || sidebarMenuPromise) return;
  sidebarMenuPromise = import("./renderSidebarMenuSurface")
    .then((mod) => {
      sidebarMenuModule = mod;
      sidebarMenuLoadFailed = false;
      refreshDeferredSidebarMenu();
      return mod;
    })
    .catch(() => {
      sidebarMenuLoadFailed = true;
      refreshDeferredSidebarMenu();
      return null;
    })
    .finally(() => {
      sidebarMenuPromise = null;
    });
}

export function renderSidebarMenuDeferred(ctx: RenderSidebarMenuCtx) {
  latestSidebarMenuCtx = ctx;
  if (sidebarMenuModule) {
    sidebarMenuModule.renderSidebarMenuSurface(ctx);
    return;
  }
  renderSidebarMenuPlaceholder(ctx, sidebarMenuLoadFailed ? "Не удалось загрузить меню" : "Загрузка меню…");
  ensureSidebarMenuModule();
}

export function clearDeferredSidebarMenu(_target: HTMLElement) {
  if (!latestSidebarMenuCtx) return;
  latestSidebarMenuCtx = null;
}
