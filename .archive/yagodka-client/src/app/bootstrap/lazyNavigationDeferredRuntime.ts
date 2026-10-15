import type { TargetRef } from "../../stores/types";
import type { ProfileActionsFeature, ProfileActionsFeatureDeps } from "../features/profile/profileActionsFeature";
import type { NotifyActionsFeature, NotifyActionsFeatureDeps } from "../features/pwa/notifyActionsFeature";
import type { SearchHistoryActionsFeature, SearchHistoryActionsFeatureDeps } from "../features/search/searchHistoryActionsFeature";
import type { SearchInputActionsFeature, SearchInputActionsFeatureDeps } from "../features/search/searchInputActionsFeature";
import type { HotkeyActionsFeatureDeps } from "../features/hotkeys/hotkeyActionsFeature";
import type { HotkeyAdapterActionsFeatureDeps } from "../features/hotkeys/hotkeyAdapterActionsFeature";
import type { HotkeysFeatureDeps } from "../features/hotkeys/hotkeysFeature";
import type { SidebarChatContextInteractionsFeatureDeps } from "../features/navigation/sidebarChatContextInteractionsFeature";
import { scheduleDeferredTask } from "./scheduleDeferredTask";
import { recoverFromLazyImportError } from "./lazyImportRecovery";

type SearchHistoryItem = { target: TargetRef; idx: number };

type DeferredNavigationRuntime = Pick<
  ProfileActionsFeature,
  | "onProfileDraftChange"
  | "onSearchServerForward"
  | "onProfileSave"
  | "onProfileRefresh"
  | "onProfileCopyId"
  | "onProfileShareId"
  | "onSessionsRefresh"
  | "onSessionsLogoutOthers"
  | "onProfileAvatarSelect"
  | "onProfileAvatarClear"
> &
  NotifyActionsFeature &
  Pick<SearchInputActionsFeature, "onSearchQueryChange" | "onSearchSubmit"> &
  Pick<SearchHistoryActionsFeature, "onSearchPinToggle" | "onSearchHistoryDelete"> & {
    onSearchHistoryForward: (items: SearchHistoryItem[]) => void;
  };

type LazyNavigationDeferredRuntimeDeps = {
  hotkeyActions: HotkeyActionsFeatureDeps;
  hotkeyAdapterActions: Omit<HotkeyAdapterActionsFeatureDeps, "onHotkey">;
  hotkeys: Pick<HotkeysFeatureDeps, "store" | "hotkeysRoot">;
  sidebarChatContextInteractions: SidebarChatContextInteractionsFeatureDeps;
  profileActions: ProfileActionsFeatureDeps;
  searchInputActions: SearchInputActionsFeatureDeps;
  searchHistoryActions: SearchHistoryActionsFeatureDeps;
  notifyActions: NotifyActionsFeatureDeps;
  tryAppendSearchShareTextToSelected: (text: string) => boolean | Promise<boolean>;
  copyText: (text: string) => boolean | Promise<boolean>;
};

export function createLazyNavigationDeferredRuntime(
  deps: LazyNavigationDeferredRuntimeDeps
): DeferredNavigationRuntime & { startDeferredBoot: () => void } {
  let runtime: DeferredNavigationRuntime | null = null;
  let runtimePromise: Promise<DeferredNavigationRuntime | null> | null = null;
  let bootStarted = false;

  function ensureRuntimeLoaded(): Promise<DeferredNavigationRuntime | null> {
    if (runtime) return Promise.resolve(runtime);
    if (!runtimePromise) {
      runtimePromise = Promise.all([
        import("../features/hotkeys/hotkeyActionsFeature"),
        import("../features/hotkeys/hotkeyAdapterActionsFeature"),
        import("../features/hotkeys/hotkeysFeature"),
        import("../features/navigation/sidebarChatContextInteractionsFeature"),
        import("../features/profile/profileActionsFeature"),
        import("../features/search/searchInputActionsFeature"),
        import("../features/search/searchHistoryActionsFeature"),
        import("../features/search/searchShareFormatters"),
        import("../features/pwa/notifyActionsFeature"),
      ])
        .then(
          ([
            hotkeyActionsModule,
            hotkeyAdapterModule,
            hotkeysModule,
            sidebarInteractionsModule,
            profileActionsModule,
            searchInputModule,
            searchHistoryModule,
            searchShareModule,
            notifyActionsModule,
          ]) => {
            const hotkeyActionsFeature = hotkeyActionsModule.createHotkeyActionsFeature(deps.hotkeyActions);
            const hotkeyAdapterActionsFeature = hotkeyAdapterModule.createHotkeyAdapterActionsFeature({
              ...deps.hotkeyAdapterActions,
              onHotkey: hotkeyActionsFeature.handleHotkey,
            });
            const hotkeysFeature = hotkeysModule.createHotkeysFeature({
              ...deps.hotkeys,
              ...hotkeyAdapterActionsFeature,
            });
            hotkeysFeature.installEventListeners();

            sidebarInteractionsModule.installSidebarChatContextInteractionsFeature(deps.sidebarChatContextInteractions);

            const profileActionsFeature = profileActionsModule.createProfileActionsFeature({
              ...deps.profileActions,
              buildSearchServerShareText: (state, items) => searchShareModule.formatSearchServerShareText(state, items),
            });
            const searchInputActionsFeature = searchInputModule.createSearchInputActionsFeature(deps.searchInputActions);
            const searchHistoryActionsFeature = searchHistoryModule.createSearchHistoryActionsFeature(deps.searchHistoryActions);
            const notifyActionsFeature = notifyActionsModule.createNotifyActionsFeature(deps.notifyActions);

            runtime = {
              ...profileActionsFeature,
              ...notifyActionsFeature,
              onSearchQueryChange: searchInputActionsFeature.onSearchQueryChange,
              onSearchSubmit: searchInputActionsFeature.onSearchSubmit,
              onSearchPinToggle: searchHistoryActionsFeature.onSearchPinToggle,
              onSearchHistoryDelete: searchHistoryActionsFeature.onSearchHistoryDelete,
              onSearchHistoryForward: (items) => {
                const st = deps.profileActions.store.get();
                const list = Array.isArray(items) ? items : [];
                const text = searchShareModule.formatSearchHistoryShareText(st, list);
                if (!text) return;
                void (async () => {
                  if (await deps.tryAppendSearchShareTextToSelected(text)) return;
                  await deps.copyText(text);
                })();
              },
            };
            runtimePromise = null;
            return runtime;
          }
        )
        .catch((err) => {
          recoverFromLazyImportError(err, "navigation_deferred");
          runtimePromise = null;
          return null;
        });
    }
    return runtimePromise;
  }

  function startDeferredBoot(): void {
    if (bootStarted) return;
    bootStarted = true;
    scheduleDeferredTask(() => {
      void ensureRuntimeLoaded().catch(() => {});
    });
  }

  function callRuntime<K extends keyof DeferredNavigationRuntime>(
    key: K,
    args: Parameters<DeferredNavigationRuntime[K]>
  ): void {
    if (runtime) {
      const method = runtime[key];
      if (typeof method === "function") {
        (method as (...innerArgs: Parameters<DeferredNavigationRuntime[K]>) => void)(...args);
      }
      return;
    }
    startDeferredBoot();
    void ensureRuntimeLoaded().then((loadedRuntime) => {
      const method = loadedRuntime?.[key];
      if (typeof method === "function") {
        (method as (...innerArgs: Parameters<DeferredNavigationRuntime[K]>) => void)(...args);
      }
    });
  }

  return {
    startDeferredBoot,
    onProfileDraftChange(draft) {
      callRuntime("onProfileDraftChange", [draft]);
    },
    onSearchServerForward(items) {
      callRuntime("onSearchServerForward", [items]);
    },
    onProfileSave(draft) {
      callRuntime("onProfileSave", [draft]);
    },
    onProfileRefresh() {
      callRuntime("onProfileRefresh", []);
    },
    onProfileCopyId() {
      callRuntime("onProfileCopyId", []);
    },
    onProfileShareId() {
      callRuntime("onProfileShareId", []);
    },
    onSessionsRefresh() {
      callRuntime("onSessionsRefresh", []);
    },
    onSessionsLogoutOthers() {
      callRuntime("onSessionsLogoutOthers", []);
    },
    onProfileAvatarSelect(file) {
      callRuntime("onProfileAvatarSelect", [file]);
    },
    onProfileAvatarClear() {
      callRuntime("onProfileAvatarClear", []);
    },
    onPushEnable() {
      callRuntime("onPushEnable", []);
    },
    onPushDisable() {
      callRuntime("onPushDisable", []);
    },
    onNotifyInAppEnable() {
      callRuntime("onNotifyInAppEnable", []);
    },
    onNotifyInAppDisable() {
      callRuntime("onNotifyInAppDisable", []);
    },
    onNotifySoundEnable() {
      callRuntime("onNotifySoundEnable", []);
    },
    onNotifySoundDisable() {
      callRuntime("onNotifySoundDisable", []);
    },
    onForcePwaUpdate() {
      callRuntime("onForcePwaUpdate", []);
    },
    onSearchQueryChange(query) {
      callRuntime("onSearchQueryChange", [query]);
    },
    onSearchSubmit(query) {
      callRuntime("onSearchSubmit", [query]);
    },
    onSearchPinToggle(targets) {
      callRuntime("onSearchPinToggle", [targets]);
    },
    onSearchHistoryDelete(items, mode) {
      callRuntime("onSearchHistoryDelete", [items, mode]);
    },
    onSearchHistoryForward(items) {
      callRuntime("onSearchHistoryForward", [items]);
    },
  };
}
