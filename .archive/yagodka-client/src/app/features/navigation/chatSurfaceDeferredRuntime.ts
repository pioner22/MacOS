import type { ChatSurfaceDeferredDeps } from "./chatSurfaceEventsFeature";
import { recoverFromLazyImportError } from "../../bootstrap/lazyImportRecovery";

type ChatSurfaceDeferredModule = typeof import("./chatSurfaceDeferredActions");
type ChatSurfaceDeferredActions = ReturnType<ChatSurfaceDeferredModule["createChatSurfaceDeferredActions"]>;

const DEFERRED_CHAT_ACTIONS = new Set([
  "modal-react-set",
  "modal-react-picker",
  "msg-react-add",
  "msg-react-more",
  "msg-react",
  "chat-pinned-hide",
  "chat-pinned-list",
  "chat-pinned-jump",
  "chat-pinned-prev",
  "chat-pinned-next",
  "chat-search-open",
  "chat-search-close",
  "chat-search-prev",
  "chat-search-next",
  "chat-search-date-clear",
  "chat-search-filter",
  "chat-search-results-toggle",
  "chat-search-result",
  "auth-accept",
  "auth-decline",
  "auth-cancel",
  "group-invite-accept",
  "group-invite-decline",
  "group-invite-block",
  "group-join-accept",
  "group-join-decline",
  "board-invite-accept",
  "board-invite-decline",
  "board-invite-block",
  "file-accept",
  "file-download",
]);

const DEFERRED_SELECTION_ACTIONS = new Set([
  "chat-selection-forward",
  "chat-selection-copy",
  "chat-selection-download",
  "chat-selection-send-now",
  "chat-selection-delete",
  "chat-selection-pin",
]);

function stopEvent(event: Event): void {
  try {
    event.preventDefault();
    event.stopPropagation();
  } catch {
    // ignore
  }
}

export function createLazyChatSurfaceDeferredRuntime(deps: ChatSurfaceDeferredDeps) {
  let runtime: ChatSurfaceDeferredActions | null = null;
  let runtimePromise: Promise<ChatSurfaceDeferredActions | null> | null = null;

  const ensureRuntime = async (): Promise<ChatSurfaceDeferredActions | null> => {
    if (runtime) return runtime;
    if (runtimePromise) return runtimePromise;
    runtimePromise = import("./chatSurfaceDeferredActions")
      .then((mod) => {
        runtime = mod.createChatSurfaceDeferredActions(deps);
        return runtime;
      })
      .catch((err) => {
        recoverFromLazyImportError(err, "chat_surface_deferred");
        return null;
      })
      .finally(() => {
        if (!runtime) runtimePromise = null;
      });
    return runtimePromise;
  };

  const maybeHandleChatClick = (event: MouseEvent, target: HTMLElement | null): boolean => {
    const actionEl = target?.closest("[data-action]") as HTMLElement | null;
    const action = String(actionEl?.getAttribute("data-action") || "").trim();
    if (!actionEl || !DEFERRED_CHAT_ACTIONS.has(action)) return false;
    stopEvent(event);
    void ensureRuntime().then((loaded) => {
      loaded?.handleChatClick(action, actionEl);
    });
    return true;
  };

  const maybeHandleSelectionBarClick = (event: MouseEvent, target: HTMLElement | null): boolean => {
    const actionEl = target?.closest("button[data-action^='chat-selection-']") as HTMLButtonElement | null;
    const action = String(actionEl?.getAttribute("data-action") || "").trim();
    if (!actionEl || actionEl.hasAttribute("disabled") || !DEFERRED_SELECTION_ACTIONS.has(action)) return false;
    stopEvent(event);
    void ensureRuntime().then((loaded) => {
      loaded?.handleSelectionBarClick(action);
    });
    return true;
  };

  return {
    maybeHandleChatClick,
    maybeHandleSelectionBarClick,
  };
}
