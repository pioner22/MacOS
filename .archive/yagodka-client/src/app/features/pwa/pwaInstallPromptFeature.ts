import {
  clearPwaInstallDismissed,
  isBeforeInstallPromptEvent,
  markPwaInstallDismissed,
  shouldOfferPwaInstall,
  type BeforeInstallPromptEvent,
} from "../../../helpers/pwa/installPrompt";
import { isIOS, isStandaloneDisplayMode } from "../../../helpers/ui/iosInputAssistant";
import type { PageKind } from "../../../stores/types";
import type { ShowToastOptions } from "../ui/toastFeature";

export interface PwaInstallPromptFeatureDeps {
  showToast: (message: string, opts?: ShowToastOptions) => void;
  setPage: (page: PageKind) => void;
}

export interface PwaInstallPromptFeature {
  installEventListeners: () => void;
}

export function createPwaInstallPromptFeature(
  deps: PwaInstallPromptFeatureDeps
): PwaInstallPromptFeature {
  const { showToast, setPage } = deps;
  let deferredPwaInstall: BeforeInstallPromptEvent | null = null;
  let listenersInstalled = false;
  let pwaInstallOffered = false;

  const runPwaInstallPrompt = async () => {
    const ev = deferredPwaInstall;
    if (!ev) return;
    deferredPwaInstall = null;
    try {
      await ev.prompt();
    } catch {
      markPwaInstallDismissed(localStorage, Date.now());
      return;
    }
    try {
      const choice = await ev.userChoice;
      if (choice?.outcome === "dismissed") {
        markPwaInstallDismissed(localStorage, Date.now());
      } else {
        clearPwaInstallDismissed(localStorage);
      }
    } catch {
      // ignore
    }
  };

  const maybeOfferPwaInstallToast = () => {
    if (pwaInstallOffered) return;
    const isStandalone = isStandaloneDisplayMode();
    if (!shouldOfferPwaInstall({ storage: localStorage, now: Date.now(), isStandalone })) return;
    pwaInstallOffered = true;
    showToast("Установить «Ягодку» как приложение?", {
      kind: "info",
      timeoutMs: 12000,
      placement: "center",
      actions: [
        { id: "pwa-install", label: "Установить", primary: true, onClick: () => void runPwaInstallPrompt() },
        { id: "pwa-later", label: "Позже", onClick: () => markPwaInstallDismissed(localStorage, Date.now()) },
      ],
    });
  };

  const maybeOfferIosInstallToast = () => {
    if (!isIOS()) return;
    const isStandalone = isStandaloneDisplayMode();
    if (!shouldOfferPwaInstall({ storage: localStorage, now: Date.now(), isStandalone })) return;
    showToast("iOS: Поделиться → На экран Домой", {
      kind: "info",
      timeoutMs: 14000,
      placement: "center",
      actions: [
        { id: "pwa-ios-help", label: "Инструкция", primary: true, onClick: () => setPage("help") },
        { id: "pwa-ios-later", label: "Позже", onClick: () => markPwaInstallDismissed(localStorage, Date.now()) },
      ],
    });
  };

  const installEventListeners = () => {
    if (listenersInstalled) return;
    listenersInstalled = true;
    try {
      window.addEventListener("beforeinstallprompt", (e) => {
        if (!isBeforeInstallPromptEvent(e)) return;
        e.preventDefault();
        deferredPwaInstall = e;
        maybeOfferPwaInstallToast();
      });
      window.addEventListener("appinstalled", () => {
        deferredPwaInstall = null;
        clearPwaInstallDismissed(localStorage);
        showToast("Приложение установлено", { kind: "success" });
      });
    } catch {
      // ignore
    }

    if (isIOS() && !isStandaloneDisplayMode()) {
      window.setTimeout(() => {
        if (pwaInstallOffered) return;
        maybeOfferIosInstallToast();
      }, 1800);
    }
  };

  return { installEventListeners };
}
