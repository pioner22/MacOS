import { createChatSearchCounts, type ChatSearchFilter } from "../../helpers/chat/chatSearch";
import type { ChatSearchUiFeature, ChatSearchUiFeatureDeps } from "../features/search/chatSearchUiFeature";

type PendingChatSearchCall =
  | { kind: "setChatSearchDate"; args: [string] }
  | { kind: "setChatSearchQuery"; args: [string] }
  | { kind: "setChatSearchFilter"; args: [ChatSearchFilter] }
  | { kind: "setChatSearchPos"; args: [number] }
  | { kind: "stepChatSearch"; args: [1 | -1] }
  | { kind: "focusChatSearch"; args: [boolean?] };

function invokeRuntimeCall(feature: ChatSearchUiFeature, call: PendingChatSearchCall): void {
  switch (call.kind) {
    case "setChatSearchDate":
      feature.setChatSearchDate(...call.args);
      break;
    case "setChatSearchQuery":
      feature.setChatSearchQuery(...call.args);
      break;
    case "setChatSearchFilter":
      feature.setChatSearchFilter(...call.args);
      break;
    case "setChatSearchPos":
      feature.setChatSearchPos(...call.args);
      break;
    case "stepChatSearch":
      feature.stepChatSearch(...call.args);
      break;
    case "focusChatSearch":
      feature.focusChatSearch(...call.args);
      break;
  }
}

export function createLazyChatSearchUiRuntime(deps: ChatSearchUiFeatureDeps): ChatSearchUiFeature {
  let featureImpl: ChatSearchUiFeature | null = null;
  let featurePromise: Promise<ChatSearchUiFeature | null> | null = null;
  const pendingCalls: PendingChatSearchCall[] = [];

  function flushPendingCalls(feature: ChatSearchUiFeature): void {
    const queue = pendingCalls.splice(0);
    for (const call of queue) invokeRuntimeCall(feature, call);
  }

  function ensureFeatureLoaded(): Promise<ChatSearchUiFeature | null> {
    if (featureImpl) return Promise.resolve(featureImpl);
    if (!featurePromise) {
      featurePromise = import("../features/search/chatSearchUiFeature")
        .then(({ createChatSearchUiFeature }) => {
          const feature = createChatSearchUiFeature(deps);
          featureImpl = feature;
          flushPendingCalls(feature);
          featurePromise = null;
          return feature;
        })
        .catch(() => {
          featurePromise = null;
          return null;
        });
    }
    return featurePromise;
  }

  function queueRuntimeCall(call: PendingChatSearchCall): void {
    if (featureImpl) {
      invokeRuntimeCall(featureImpl, call);
      return;
    }
    pendingCalls.push(call);
    void ensureFeatureLoaded();
  }

  return {
    focusChatSearch(selectAll = false) {
      queueRuntimeCall({ kind: "focusChatSearch", args: [selectAll] });
    },
    setChatSearchDate(value) {
      const nextValue = String(value ?? "");
      deps.store.set({ chatSearchDate: nextValue });
      queueRuntimeCall({ kind: "setChatSearchDate", args: [nextValue] });
    },
    closeChatSearch() {
      deps.store.set((prev) => ({
        ...prev,
        chatSearchOpen: false,
        chatSearchResultsOpen: false,
        chatSearchQuery: "",
        chatSearchDate: "",
        chatSearchFilter: "all",
        chatSearchHits: [],
        chatSearchPos: 0,
        chatSearchCounts: createChatSearchCounts(),
      }));
      queueMicrotask(() => deps.scheduleFocusComposer());
    },
    openChatSearch() {
      const st = deps.store.get();
      if (st.page !== "main" || st.modal || !st.selected) return;
      deps.store.set((prev) => ({ ...prev, chatSearchOpen: true, chatSearchResultsOpen: false }));
      queueRuntimeCall({ kind: "focusChatSearch", args: [true] });
    },
    setChatSearchQuery(query) {
      const nextQuery = String(query ?? "");
      const trimmed = nextQuery.trim();
      deps.store.set((prev) => ({
        ...prev,
        chatSearchQuery: nextQuery,
        chatSearchResultsOpen: trimmed ? prev.chatSearchResultsOpen : false,
      }));
      queueRuntimeCall({ kind: "setChatSearchQuery", args: [nextQuery] });
    },
    setChatSearchFilter(next) {
      deps.store.set((prev) => ({ ...prev, chatSearchFilter: next, chatSearchPos: 0 }));
      queueRuntimeCall({ kind: "setChatSearchFilter", args: [next] });
    },
    toggleChatSearchResults(force) {
      const st = deps.store.get();
      if (!st.chatSearchOpen) return;
      if (!String(st.chatSearchQuery || "").trim()) {
        deps.store.set({ chatSearchResultsOpen: false });
        return;
      }
      const next = force === undefined ? !st.chatSearchResultsOpen : Boolean(force);
      deps.store.set({ chatSearchResultsOpen: next });
    },
    handleSearchResultClick(button) {
      if (featureImpl) return featureImpl.handleSearchResultClick(button);
      void ensureFeatureLoaded();
      return false;
    },
    setChatSearchPos(pos) {
      deps.store.set({ chatSearchPos: pos });
      queueRuntimeCall({ kind: "setChatSearchPos", args: [pos] });
    },
    stepChatSearch(dir) {
      queueRuntimeCall({ kind: "stepChatSearch", args: [dir] });
    },
  };
}
