import { el } from "../../helpers/dom/el";
import type { RenderSidebarStandaloneCtx } from "./renderSidebarStandalone";

type SidebarStandaloneModule = typeof import("./renderSidebarStandalone");

let sidebarStandaloneModule: SidebarStandaloneModule | null = null;
let sidebarStandalonePromise: Promise<SidebarStandaloneModule | null> | null = null;
let latestSidebarStandaloneCtx: RenderSidebarStandaloneCtx | null = null;
let sidebarStandaloneLoadFailed = false;

function renderSidebarStandalonePlaceholder(ctx: RenderSidebarStandaloneCtx, message: string) {
  const { target, body, bindHeaderScroll, setBodyChatlistClass } = ctx;
  bindHeaderScroll(null);
  setBodyChatlistClass([]);
  body.replaceChildren(
    el("div", { class: "pane-section sidebar-standalone-loading", role: "status", "aria-live": "polite", "aria-busy": "true" }, [
      el("div", { class: "msg msg-sys sidebar-standalone-loading-text" }, [message]),
    ])
  );
  target.replaceChildren(body);
}

function refreshDeferredSidebarStandalone() {
  const ctx = latestSidebarStandaloneCtx;
  if (!ctx) return;
  if (sidebarStandaloneModule) {
    sidebarStandaloneModule.renderSidebarStandalone(ctx);
    return;
  }
  renderSidebarStandalonePlaceholder(
    ctx,
    sidebarStandaloneLoadFailed ? "Не удалось загрузить PWA-панель" : "Загрузка PWA-панели…"
  );
}

function ensureSidebarStandaloneModule() {
  if (sidebarStandaloneModule || sidebarStandalonePromise) return;
  sidebarStandalonePromise = import("./renderSidebarStandalone")
    .then((mod) => {
      sidebarStandaloneModule = mod;
      sidebarStandaloneLoadFailed = false;
      refreshDeferredSidebarStandalone();
      return mod;
    })
    .catch(() => {
      sidebarStandaloneLoadFailed = true;
      refreshDeferredSidebarStandalone();
      return null;
    })
    .finally(() => {
      sidebarStandalonePromise = null;
    });
}

export function renderSidebarStandaloneDeferred(ctx: RenderSidebarStandaloneCtx) {
  latestSidebarStandaloneCtx = ctx;
  if (sidebarStandaloneModule) {
    sidebarStandaloneModule.renderSidebarStandalone(ctx);
    return;
  }
  renderSidebarStandalonePlaceholder(
    ctx,
    sidebarStandaloneLoadFailed ? "Не удалось загрузить PWA-панель" : "Загрузка PWA-панели…"
  );
  ensureSidebarStandaloneModule();
}

export function clearDeferredSidebarStandalone(target: HTMLElement) {
  if (!latestSidebarStandaloneCtx || latestSidebarStandaloneCtx.target !== target) return;
  latestSidebarStandaloneCtx = null;
}
