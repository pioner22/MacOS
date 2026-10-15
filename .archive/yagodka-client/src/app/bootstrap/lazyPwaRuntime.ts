import type { Store } from "../../stores/store";
import type { AppState, PageKind, TargetRef } from "../../stores/types";
import { scheduleDeferredTask } from "./scheduleDeferredTask";

type BufferedPwaEvent = {
  type: string;
  detail?: unknown;
};

type LazyPwaRuntimeDeps = {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  autosizeInput: (el: HTMLTextAreaElement) => void;
  scheduleSaveDrafts: () => void;
  showToast: (
    message: string,
    opts?: {
      kind?: "info" | "success" | "warn" | "error";
      undo?: () => void;
      actions?: Array<{ id: string; label: string; primary?: boolean; onClick: () => void }>;
      timeoutMs?: number;
      placement?: "bottom" | "center";
    }
  ) => void;
  canSendFiles: () => boolean;
  sendFile: (file: File, target: TargetRef, caption: string) => void;
  send: (payload: any) => void;
  setPage: (page: PageKind) => void;
  selectTarget: (target: TargetRef) => void;
};

type PwaShareFeatureLike = {
  tryAppendShareTextToSelected: (text: string) => boolean;
};

type PwaNotifyFeatureLike = {
  syncNotifyPrefsToServiceWorker: () => void;
};

type PwaShareFeatureRuntime = PwaShareFeatureLike & {
  installEventListeners: () => void;
};

type PwaNotifyFeatureRuntime = PwaNotifyFeatureLike & {
  installEventListeners: () => void;
};

export function createLazyPwaRuntime(deps: LazyPwaRuntimeDeps): {
  pwaShareFeature: PwaShareFeatureLike;
  pwaNotifyFeature: PwaNotifyFeatureLike;
  startDeferredBoot: () => void;
  enablePush: () => Promise<void>;
  disablePush: () => Promise<void>;
  onLogout: () => void;
} {
  const bufferedEvents: BufferedPwaEvent[] = [];
  let buffersInstalled = false;
  let runtimeLoaded = false;
  let runtimePromise: Promise<void> | null = null;
  let shareFeature: PwaShareFeatureRuntime | null = null;
  let notifyFeature: PwaNotifyFeatureRuntime | null = null;
  let pushFeature:
    | {
        installAutoSync: () => void;
        enablePush: () => Promise<void>;
        disablePush: () => Promise<void>;
        syncExistingPushSubscription: () => Promise<void>;
        onLogout: () => void;
      }
    | null = null;

  const bufferPwaShare = (ev: Event) => {
    if (runtimeLoaded) return;
    bufferedEvents.push({ type: "yagodka:pwa-share", detail: (ev as CustomEvent<unknown>).detail });
  };
  const bufferPwaNotify = (ev: Event) => {
    if (runtimeLoaded) return;
    bufferedEvents.push({ type: "yagodka:pwa-notification-click", detail: (ev as CustomEvent<unknown>).detail });
  };

  function installBuffers(): void {
    if (buffersInstalled) return;
    buffersInstalled = true;
    window.addEventListener("yagodka:pwa-share", bufferPwaShare);
    window.addEventListener("yagodka:pwa-notification-click", bufferPwaNotify);
  }

  function removeBuffers(): void {
    if (!buffersInstalled) return;
    buffersInstalled = false;
    window.removeEventListener("yagodka:pwa-share", bufferPwaShare);
    window.removeEventListener("yagodka:pwa-notification-click", bufferPwaNotify);
  }

  function replayBufferedEvents(): void {
    const queued = bufferedEvents.splice(0, bufferedEvents.length);
    for (const event of queued) {
      if (event.type === "yagodka:pwa-notification-click") {
        window.dispatchEvent(new CustomEvent(event.type, { detail: event.detail }));
        continue;
      }
      window.dispatchEvent(new CustomEvent(event.type, { detail: event.detail }));
    }
  }

  function ensureRuntimeLoaded(): Promise<void> {
    if (runtimeLoaded) return Promise.resolve();
    if (!runtimePromise) {
      runtimePromise = Promise.all([
        import("../features/pwa/pwaShareFeature"),
        import("../features/pwa/pwaNotifyFeature"),
        import("../features/pwa/pwaPushFeature"),
        import("../features/pwa/pwaInstallPromptFeature"),
      ])
        .then(([shareModule, notifyModule, pushModule, installPromptModule]) => {
          if (!shareFeature) {
            shareFeature = shareModule.createPwaShareFeature({
              store: deps.store,
              input: deps.input,
              autosizeInput: deps.autosizeInput,
              scheduleSaveDrafts: deps.scheduleSaveDrafts,
              showToast: deps.showToast,
              canSendFiles: deps.canSendFiles,
              sendFile: deps.sendFile,
            });
            shareFeature.installEventListeners();
          }
          if (!notifyFeature) {
            notifyFeature = notifyModule.createPwaNotifyFeature({
              store: deps.store,
              setPage: deps.setPage,
              selectTarget: deps.selectTarget,
            });
            notifyFeature.installEventListeners();
          }
          if (!pushFeature) {
            pushFeature = pushModule.createPwaPushFeature({
              store: deps.store,
              send: deps.send,
            });
            pushFeature.installAutoSync();
            void pushFeature.syncExistingPushSubscription().catch(() => {});
          }
          installPromptModule
            .createPwaInstallPromptFeature({
              showToast: deps.showToast,
              setPage: deps.setPage,
            })
            .installEventListeners();
          runtimeLoaded = true;
          removeBuffers();
          replayBufferedEvents();
        })
        .catch((err) => {
          runtimePromise = null;
          throw err;
        });
    }
    return runtimePromise;
  }

  const pwaShareFeature: PwaShareFeatureLike = {
    tryAppendShareTextToSelected: (text) => {
      if (shareFeature) return shareFeature.tryAppendShareTextToSelected(text);
      void ensureRuntimeLoaded().catch(() => {});
      return false;
    },
  };

  const pwaNotifyFeature: PwaNotifyFeatureLike = {
    syncNotifyPrefsToServiceWorker: () => {
      if (notifyFeature) {
        notifyFeature.syncNotifyPrefsToServiceWorker();
        return;
      }
      void ensureRuntimeLoaded().catch(() => {});
    },
  };

  function startDeferredBoot(): void {
    scheduleDeferredTask(() => {
      void ensureRuntimeLoaded().catch(() => {});
    });
  }

  async function enablePush(): Promise<void> {
    await ensureRuntimeLoaded();
    await pushFeature?.enablePush();
  }

  async function disablePush(): Promise<void> {
    await ensureRuntimeLoaded();
    await pushFeature?.disablePush();
  }

  function onLogout(): void {
    pushFeature?.onLogout();
  }

  installBuffers();

  return {
    pwaShareFeature,
    pwaNotifyFeature,
    startDeferredBoot,
    enablePush,
    disablePush,
    onLogout,
  };
}
