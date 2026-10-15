import type { GatewayTransport } from "../../lib/net/gatewayClient";
import type { Store } from "../../stores/store";
import type { AppState } from "../../stores/types";

type DebugHudLike = {
  isEnabled: () => boolean;
  setEnabled: (enabled: boolean, opts?: { persist?: boolean }) => void;
  toggle: () => void;
  log: (msg: string) => void;
};

type LazyDebugToolsDeps = {
  mount: HTMLElement;
  chatHost: HTMLElement;
  getState: () => AppState;
};

type LazyDebugMonitorDeps = {
  store: Store<AppState>;
  gateway: GatewayTransport;
};

function parseBoolish(value: string | null): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function shouldEnableFromLocation(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("debug")) return parseBoolish(sp.get("debug"));
  } catch {
    // ignore
  }
  return false;
}

function shouldEnableFromStorage(): boolean {
  try {
    return parseBoolish(window.localStorage?.getItem("yagodka_debug"));
  } catch {
    return false;
  }
}

function setStorageEnabled(enabled: boolean): void {
  try {
    if (!window.localStorage) return;
    if (enabled) window.localStorage.setItem("yagodka_debug", "1");
    else window.localStorage.removeItem("yagodka_debug");
  } catch {
    // ignore
  }
}

export function createLazyDebugTools(deps: LazyDebugToolsDeps): {
  debugHud: DebugHudLike;
  bindDebugMonitor: (monitorDeps: LazyDebugMonitorDeps) => void;
} {
  let desiredEnabled = shouldEnableFromLocation() || shouldEnableFromStorage();
  let debugHudImpl: DebugHudLike | null = null;
  let debugHudPromise: Promise<DebugHudLike> | null = null;
  let debugMonitorDeps: LazyDebugMonitorDeps | null = null;
  let debugMonitorInstalled = false;
  let debugMonitorPromise: Promise<void> | null = null;

  const debugHud: DebugHudLike = {
    isEnabled: () => debugHudImpl?.isEnabled() ?? desiredEnabled,
    setEnabled: (enabled, opts) => {
      desiredEnabled = Boolean(enabled);
      if (opts?.persist) setStorageEnabled(desiredEnabled);
      if (!desiredEnabled) {
        debugHudImpl?.setEnabled(false, opts);
        return;
      }
      void ensureDebugHudLoaded()
        .then((api) => {
          api.setEnabled(true, opts);
          void ensureDebugMonitorInstalled();
        })
        .catch(() => {});
    },
    toggle: () => {
      debugHud.setEnabled(!debugHud.isEnabled(), { persist: true });
    },
    log: (msg) => {
      debugHudImpl?.log(msg);
    },
  };

  function ensureDebugHudLoaded(): Promise<DebugHudLike> {
    if (debugHudImpl) return Promise.resolve(debugHudImpl);
    if (!debugHudPromise) {
      debugHudPromise = import("../../helpers/ui/debugHud")
        .then(({ installDebugHud }) => {
          const api = installDebugHud({
            mount: deps.mount,
            chatHost: deps.chatHost,
            getState: deps.getState,
          });
          api.setEnabled(desiredEnabled, { persist: false });
          debugHudImpl = api;
          return api;
        })
        .catch((err) => {
          debugHudPromise = null;
          throw err;
        });
    }
    return debugHudPromise;
  }

  function ensureDebugMonitorInstalled(): Promise<void> {
    if (!desiredEnabled || debugMonitorInstalled || !debugMonitorDeps) return Promise.resolve();
    if (!debugMonitorPromise) {
      debugMonitorPromise = Promise.all([
        ensureDebugHudLoaded(),
        import("../features/debug/debugMonitorFeature"),
      ])
        .then(([_, debugMonitorModule]) => {
          if (debugMonitorInstalled || !debugMonitorDeps) return;
          debugMonitorModule.installDebugMonitorFeature({
            store: debugMonitorDeps.store,
            gateway: debugMonitorDeps.gateway,
            mount: deps.mount,
            chatHost: deps.chatHost,
            debugHud,
          });
          debugMonitorInstalled = true;
        })
        .catch((err) => {
          debugMonitorPromise = null;
          throw err;
        });
    }
    return debugMonitorPromise;
  }

  function bindDebugMonitor(monitorDeps: LazyDebugMonitorDeps): void {
    debugMonitorDeps = monitorDeps;
    if (desiredEnabled) {
      void ensureDebugMonitorInstalled().catch(() => {});
    }
  }

  if (desiredEnabled) {
    void ensureDebugHudLoaded()
      .then(() => ensureDebugMonitorInstalled())
      .catch(() => {});
  }

  return { debugHud, bindDebugMonitor };
}
