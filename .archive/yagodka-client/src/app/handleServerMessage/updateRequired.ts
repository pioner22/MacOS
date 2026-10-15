import type { AppState } from "../../stores/types";
import { isServiceWorkerRuntimeAvailable } from "../../helpers/pwa/serviceWorkerRuntime";
import { createPwaUpdateState } from "../../helpers/pwa/updateState";
import { getCapacitorPlatform, isCapacitorNativeRuntime } from "../../helpers/runtime/nativeRuntime";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { splitBuildId } from "../../helpers/version/buildId";

type PatchFn = (p: Partial<AppState> | ((prev: AppState) => AppState)) => void;

function canPreemptModalForPwaUpdate(state: AppState): boolean {
  const kind = state.modal?.kind;
  return !kind || kind === "pwa_update" || kind === "auth" || kind === "welcome" || kind === "update";
}

export function handleUpdateRequiredMessage(t: string, msg: any, state: AppState, patch: PatchFn): boolean {
  if (t !== "update_required") return false;

  const latest = String(msg?.latest ?? "").trim();
  if (!latest) return true;

  const isAndroidNative = isCapacitorNativeRuntime() && getCapacitorPlatform() === "android";
  const latestAndroidVersionName = String(msg?.latest_android_version_name ?? "").trim();
  const latestAndroidVersionCodeRaw = Number(msg?.latest_android_version_code);
  const hasLatestAndroidVersionCode = Number.isFinite(latestAndroidVersionCodeRaw) && latestAndroidVersionCodeRaw > 0;
  const isAndroidAppUpdate =
    isAndroidNative && (Boolean(msg?.android_app_update) || Boolean(latestAndroidVersionName) || hasLatestAndroidVersionCode);
  const effectiveLatest = isAndroidAppUpdate ? latestAndroidVersionName || latest : latest;
  const latestVersion = splitBuildId(latest).version || latest;
  const hasSw = isServiceWorkerRuntimeAvailable();
  const latestAndroidVersion = latestAndroidVersionName || latestVersion || latest;

  if (hasSw && !isAndroidAppUpdate) {
    const shouldOpenPrompt = canPreemptModalForPwaUpdate(state);
    const promptMissing = shouldOpenPrompt && state.modal?.kind !== "pwa_update";
    const runtimeBuild = String((state as any).pwaUpdate?.buildId ?? "").trim();
    if (state.updateLatest !== latest || state.pwaUpdateAvailable !== true || runtimeBuild !== latest || promptMissing) {
      patch({
        updateLatest: latest,
        pwaUpdateAvailable: true,
        pwaUpdate: createPwaUpdateState("available", {
          buildId: latest,
          message: "Доступно обновление веб-клиента",
          detail: "Сервер сообщил о новой сборке. Нажмите «Обновить», когда будет удобно.",
          userDecision: "pending",
        }),
        status: "Доступно обновление веб-клиента. Нажмите «Обновить», когда будет удобно.",
        ...(shouldOpenPrompt ? { modal: { kind: "pwa_update" as const } } : {}),
      });
    }
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
        window.dispatchEvent(new CustomEvent("yagodka:pwa-build", { detail: { buildId: latest } }));
      }
    } catch {
      // ignore
    }
    try {
      void navigator.serviceWorker
        .getRegistration()
        .then(async (reg) => {
          let nextReg = reg ?? null;
          if (!nextReg) {
            try {
              nextReg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
            } catch {
              patch({ status: "Service Worker не зарегистрирован. Перезапустите приложение.", modal: { kind: "update" } });
              return;
            }
          }
          try {
            await nextReg.update();
          } catch {
            // ignore
          }
        })
        .catch(() => {});
    } catch {
      // ignore
    }
    return true;
  }

  if (state.updateDismissedLatest && state.updateDismissedLatest === effectiveLatest) return true;
  if (isAndroidNative) {
    patch({
      updateLatest: effectiveLatest,
      status: `Доступно обновление Android-приложения до v${latestAndroidVersion}. Нужно обновиться.`,
      modal: { kind: "update" },
    });
    return true;
  }

  const hint = isMobileLikeUi() ? "" : " (Ctrl+U — применить)";
  patch({ updateLatest: latest, status: `Доступно обновление до v${latest}${hint}`, modal: { kind: "update" } });
  return true;
}
