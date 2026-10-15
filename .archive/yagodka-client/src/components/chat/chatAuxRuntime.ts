import { el } from "../../helpers/dom/el";
import { hasActiveConversationSelection } from "../../helpers/navigation/mainConversationState";
import type { Layout } from "../layout/types";
import type { AppState, ChatMessage } from "../../stores/types";
import type { RenderChatPinnedDeferredOptions, RenderChatSearchDeferredOptions } from "./chatAuxSurface";

type ChatAuxModule = typeof import("./chatAuxSurface");

let auxModule: ChatAuxModule | null = null;
let auxPromise: Promise<ChatAuxModule> | null = null;
let auxLoadFailed = false;
let latestPinnedCtx: RenderChatPinnedDeferredOptions | null = null;
let latestSearchCtx: RenderChatSearchDeferredOptions | null = null;

function renderPinnedPlaceholder(ctx: RenderChatPinnedDeferredOptions, message: string) {
  ctx.mount.replaceChildren(el("div", { class: "chat-pinned chat-pinned-loading", role: "status", "aria-live": "polite" }, [message]));
}

function renderSearchPlaceholder(ctx: RenderChatSearchDeferredOptions, message: string) {
  const { layout, state, searchResultsOpen } = ctx;
  if (hasActiveConversationSelection(state) && state.chatSearchOpen) {
    layout.chatSearchFooter.classList.remove("hidden");
    layout.chatSearchFooter.replaceChildren(el("div", { class: "chat-search-footer-row chat-search-footer-loading", role: "status", "aria-live": "polite" }, [message]));
  } else {
    layout.chatSearchFooter.classList.add("hidden");
    layout.chatSearchFooter.replaceChildren();
  }
  if (searchResultsOpen) {
    layout.chatSearchResults.classList.remove("hidden");
    layout.chatSearchResults.replaceChildren(el("div", { class: "chat-search-results-empty", role: "status", "aria-live": "polite" }, [message]));
  } else {
    layout.chatSearchResults.classList.add("hidden");
    layout.chatSearchResults.replaceChildren();
  }
}

function canRenderPinned(ctx: RenderChatPinnedDeferredOptions | null): ctx is RenderChatPinnedDeferredOptions {
  return Boolean(ctx && ctx.mount.isConnected);
}

function canRenderSearch(ctx: RenderChatSearchDeferredOptions | null): ctx is RenderChatSearchDeferredOptions {
  return Boolean(ctx && ctx.layout.chatSearchFooter.isConnected && ctx.layout.chatSearchResults.isConnected);
}

function ensureChatAuxModule() {
  if (auxModule) return Promise.resolve(auxModule);
  if (auxPromise) return auxPromise;
  auxPromise = import("./chatAuxSurface")
    .then((mod: ChatAuxModule) => {
      auxModule = mod;
      auxLoadFailed = false;
      if (canRenderPinned(latestPinnedCtx)) mod.renderPinnedSurface(latestPinnedCtx);
      if (canRenderSearch(latestSearchCtx)) mod.renderSearchDeferredSurface(latestSearchCtx);
      return mod;
    })
    .catch((err) => {
      auxLoadFailed = true;
      auxPromise = null;
      if (canRenderPinned(latestPinnedCtx)) renderPinnedPlaceholder(latestPinnedCtx, "Не удалось загрузить закреп");
      if (canRenderSearch(latestSearchCtx)) renderSearchPlaceholder(latestSearchCtx, "Не удалось загрузить поиск");
      throw err;
    });
  return auxPromise;
}

export function clearDeferredPinnedSurface() {
  latestPinnedCtx = null;
}

export function renderPinnedDeferred(opts: {
  msgs: ChatMessage[];
  pinnedIds: number[] | null;
  activeRaw: number | null;
  pinnedHidden: boolean;
}): HTMLElement | null {
  if (opts.pinnedHidden || !Array.isArray(opts.pinnedIds) || !opts.pinnedIds.length) {
    latestPinnedCtx = null;
    return null;
  }
  const mount = el("div", { class: "chat-pinned-deferred-mount" });
  const ctx: RenderChatPinnedDeferredOptions = { mount, ...opts };
  latestPinnedCtx = ctx;
  if (auxModule) {
    auxModule.renderPinnedSurface(ctx);
    return mount;
  }
  renderPinnedPlaceholder(ctx, auxLoadFailed ? "Не удалось загрузить закреп" : "Загрузка закрепа...");
  void ensureChatAuxModule();
  return mount;
}

export function renderSearchAuxDeferred(opts: {
  layout: Pick<Layout, "chatSearchResults" | "chatSearchFooter">;
  state: AppState;
  msgs: ChatMessage[];
  hits: number[];
  activePos: number;
  searchResultsOpen: boolean;
  friendLabels: Map<string, string>;
}) {
  const ctx: RenderChatSearchDeferredOptions = opts;
  latestSearchCtx = ctx;
  if (auxModule) {
    auxModule.renderSearchDeferredSurface(ctx);
    return;
  }
  renderSearchPlaceholder(ctx, auxLoadFailed ? "Не удалось загрузить поиск" : "Загрузка поиска...");
  void ensureChatAuxModule();
}
