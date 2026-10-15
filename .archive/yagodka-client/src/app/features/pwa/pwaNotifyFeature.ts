import type { Store } from "../../../stores/store";
import type { AppState, PageKind, TargetRef } from "../../../stores/types";

export interface PwaNotifyFeatureDeps {
  store: Store<AppState>;
  setPage: (page: PageKind) => void;
  selectTarget: (target: TargetRef) => void;
}

export interface PwaNotifyFeature {
  installEventListeners: () => void;
  dispose: () => void;
  syncNotifyPrefsToServiceWorker: () => void;
}

type PushDeepLink = { room: string; from: string };

function readPendingPushDeepLink(): PushDeepLink | null {
  try {
    const loc = globalThis.location;
    const search = typeof loc?.search === "string" ? loc.search : "";
    const params = new URLSearchParams(search || "");
    const room = String(params.get("push_room") || "").trim();
    const from = String(params.get("push_from") || "").trim();
    if (!room && !from) return null;
    params.delete("push_room");
    params.delete("push_from");
    const next = params.toString();
    const pathname = typeof loc?.pathname === "string" ? loc.pathname : "/";
    const hash = typeof loc?.hash === "string" ? loc.hash : "";
    const url = next ? `${pathname}?${next}${hash}` : `${pathname}${hash}`;
    globalThis.history?.replaceState?.(null, "", url);
    return { room, from };
  } catch {
    return null;
  }
}

function extractNotificationTarget(detail: any): PushDeepLink | null {
  const room = String(detail?.room || "").trim();
  const from = String(detail?.from || "").trim();
  if (!room && !from) return null;
  return { room, from };
}

export function createPwaNotifyFeature(deps: PwaNotifyFeatureDeps): PwaNotifyFeature {
  const { store, setPage, selectTarget } = deps;
  let listenersInstalled = false;
  const pendingPushDeepLink = readPendingPushDeepLink();

  const openFromPushTarget = (tgt: PushDeepLink) => {
    const room = String(tgt.room || "").trim();
    const from = String(tgt.from || "").trim();
    if (!room && !from) return;
    setPage("main");
    if (room) {
      if (room.startsWith("b-")) selectTarget({ kind: "board", id: room });
      else selectTarget({ kind: "group", id: room });
      return;
    }
    if (from) selectTarget({ kind: "dm", id: from });
  };

  const onNotificationClick = (e: Event) => {
    const ev = e as CustomEvent;
    const detail = ev?.detail as any;
    const tgt = extractNotificationTarget(detail);
    if (!tgt) return;
    openFromPushTarget(tgt);
  };

  function syncNotifyPrefsToServiceWorker(): void {
    try {
      if (!("serviceWorker" in navigator)) return;
    } catch {
      return;
    }
    const st = store.get();
    const prefs = { silent: !Boolean(st.notifySoundEnabled) };
    const msg = { type: "PWA_NOTIFY_PREFS", prefs };
    try {
      const controller = navigator.serviceWorker.controller;
      if (controller) {
        controller.postMessage(msg);
        return;
      }
    } catch {
      // ignore
    }
    try {
      navigator.serviceWorker.ready
        .then((reg) => {
          try {
            reg.active?.postMessage?.(msg);
          } catch {
            // ignore
          }
        })
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  function installEventListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    window.addEventListener("yagodka:pwa-notification-click", onNotificationClick);

    // Best-effort: keep SW notification prefs in sync (used for `silent` option).
    syncNotifyPrefsToServiceWorker();

    if (pendingPushDeepLink) {
      queueMicrotask(() => openFromPushTarget(pendingPushDeepLink));
    }
  }

  function dispose() {
    if (!listenersInstalled) return;
    listenersInstalled = false;
    try {
      window.removeEventListener("yagodka:pwa-notification-click", onNotificationClick);
    } catch {
      // ignore
    }
  }

  return { installEventListeners, dispose, syncNotifyPrefsToServiceWorker };
}

