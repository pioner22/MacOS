import type { AppState } from "../../stores/types";
import { el } from "../../helpers/dom/el";
import type { CallModalActions, CallModalController } from "../../components/modals/call/createCallModal";

type CallModalState = Extract<NonNullable<AppState["modal"]>, { kind: "call" }>;
type CallModalModule = typeof import("../../components/modals/call/createCallModal");

function callKey(modal: CallModalState): string {
  const callId = String(modal.callId || "").trim();
  const targetKey = String(modal.room || modal.to || "").trim();
  const pendingKey = `call:pending:${modal.mode}:${targetKey}:${String(modal.from || "").trim()}`;
  return callId ? `call:${callId}` : pendingKey;
}

function createLoadingShell(message: string): HTMLElement {
  return el("div", { class: "modal modal-screen modal-screen-status modal-call-loading", role: "status", "aria-live": "polite", "aria-busy": "true" }, [
    el("div", { class: "screen-title" }, ["Звонок"]),
    el("div", { class: "screen-sub" }, [message]),
    el("div", { class: "screen-bar", "aria-hidden": "true" }, [""]),
  ]);
}

export function createLazyCallModalRuntime() {
  let host: HTMLElement | null = null;
  let moduleRef: CallModalModule | null = null;
  let loadPromise: Promise<CallModalModule | null> | null = null;
  let controller: CallModalController | null = null;
  let currentKey = "";
  let latestState: AppState | null = null;
  let latestModal: CallModalState | null = null;
  let latestActions: CallModalActions | null = null;
  let latestLoadToken = 0;

  function ensureHost(): HTMLElement {
    if (host) return host;
    host = el("div", { class: "deferred-call-modal-host" }, [createLoadingShell("Подключаем звонок…")]);
    return host;
  }

  function setLoading(message: string) {
    ensureHost().replaceChildren(createLoadingShell(message));
  }

  function destroyController() {
    if (!controller) return;
    try {
      controller.destroy();
    } catch {
      // ignore
    }
    controller = null;
  }

  function ensureController() {
    if (!moduleRef || !latestActions) return null;
    if (!controller) controller = moduleRef.createCallModal(latestActions);
    return controller;
  }

  function syncLoadedController() {
    if (!latestState || !latestModal) return;
    const instance = ensureController();
    if (!instance) return;
    const shell = ensureHost();
    if (shell.firstElementChild !== instance.root) shell.replaceChildren(instance.root);
    instance.update(latestState, latestModal);
  }

  function ensureLoaded() {
    if (moduleRef || loadPromise) return;
    const token = ++latestLoadToken;
    setLoading("Подключаем звонок…");
    loadPromise = import("../../components/modals/call/createCallModal")
      .then((mod) => {
        if (token !== latestLoadToken) return null;
        moduleRef = mod;
        syncLoadedController();
        return mod;
      })
      .catch(() => {
        if (token === latestLoadToken) setLoading("Не удалось загрузить звонок");
        return null;
      })
      .finally(() => {
        if (token === latestLoadToken) loadPromise = null;
      });
  }

  return {
    render(state: AppState, modal: CallModalState, actions: CallModalActions): HTMLElement {
      latestState = state;
      latestModal = modal;
      latestActions = actions;
      const nextKey = callKey(modal);
      if (currentKey && currentKey !== nextKey) {
        destroyController();
      }
      currentKey = nextKey;
      if (moduleRef) syncLoadedController();
      else ensureLoaded();
      return ensureHost();
    },
    clear() {
      latestState = null;
      latestModal = null;
      latestActions = null;
      currentKey = "";
      latestLoadToken += 1;
      loadPromise = null;
      destroyController();
      if (host) host.replaceChildren(createLoadingShell("Подключаем звонок…"));
    },
  };
}
