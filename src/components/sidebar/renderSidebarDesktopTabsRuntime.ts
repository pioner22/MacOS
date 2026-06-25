import { el } from "../../helpers/dom/el";
import type { RenderSidebarDesktopTabsCtx } from "./renderSidebarDesktopTabsSurface";

type SidebarDesktopTabsModule = typeof import("./renderSidebarDesktopTabsSurface");

let sidebarDesktopTabsModule: SidebarDesktopTabsModule | null = null;
let sidebarDesktopTabsPromise: Promise<SidebarDesktopTabsModule | null> | null = null;
let latestSidebarDesktopTabsCtx: RenderSidebarDesktopTabsCtx | null = null;
let sidebarDesktopTabsLoadFailed = false;

function deferredTabLabel(kind: RenderSidebarDesktopTabsCtx["kind"]): string {
  return kind === "boards" ? "каналы" : "контакты";
}

function renderSidebarDesktopTabsPlaceholder(ctx: RenderSidebarDesktopTabsCtx, message: string) {
  const label = deferredTabLabel(ctx.kind);
  ctx.mountDesktop([
    el(
      "div",
      { class: "pane-section sidebar-desktop-tabs-loading", role: "status", "aria-live": "polite", "aria-busy": "true" },
      [el("div", { class: "msg msg-sys sidebar-desktop-tabs-loading-text" }, [`${message} (${label})`])]
    ),
  ]);
}

function refreshDeferredSidebarDesktopTabs() {
  const ctx = latestSidebarDesktopTabsCtx;
  if (!ctx) return;
  if (sidebarDesktopTabsModule) {
    sidebarDesktopTabsModule.renderSidebarDesktopTabsSurface(ctx);
    return;
  }
  renderSidebarDesktopTabsPlaceholder(
    ctx,
    sidebarDesktopTabsLoadFailed ? "Не удалось загрузить вкладку" : "Загрузка вкладки…"
  );
}

function ensureSidebarDesktopTabsModule() {
  if (sidebarDesktopTabsModule || sidebarDesktopTabsPromise) return;
  sidebarDesktopTabsPromise = import("./renderSidebarDesktopTabsSurface")
    .then((mod) => {
      sidebarDesktopTabsModule = mod;
      sidebarDesktopTabsLoadFailed = false;
      refreshDeferredSidebarDesktopTabs();
      return mod;
    })
    .catch(() => {
      sidebarDesktopTabsLoadFailed = true;
      refreshDeferredSidebarDesktopTabs();
      return null;
    })
    .finally(() => {
      sidebarDesktopTabsPromise = null;
    });
}

export function renderSidebarDesktopTabsDeferred(ctx: RenderSidebarDesktopTabsCtx) {
  latestSidebarDesktopTabsCtx = ctx;
  if (sidebarDesktopTabsModule) {
    sidebarDesktopTabsModule.renderSidebarDesktopTabsSurface(ctx);
    return;
  }
  renderSidebarDesktopTabsPlaceholder(
    ctx,
    sidebarDesktopTabsLoadFailed ? "Не удалось загрузить вкладку" : "Загрузка вкладки…"
  );
  ensureSidebarDesktopTabsModule();
}

export function clearDeferredSidebarDesktopTabs(target: HTMLElement) {
  if (!latestSidebarDesktopTabsCtx || latestSidebarDesktopTabsCtx.target !== target) return;
  latestSidebarDesktopTabsCtx = null;
}
