import { conversationKey } from "../../../helpers/chat/conversationKey";
import { createChatSearchCounts } from "../../../helpers/chat/chatSearch";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";

export interface OpenChatFromSearchFeatureDeps {
  store: Store<AppState>;
  selectTarget: (target: TargetRef) => void;
  scrollToChatMsgIdx: (idx: number) => void;
}

export interface OpenChatFromSearchFeature {
  openChatFromSearch: (target: TargetRef, query: string, msgIdx?: number) => void;
}

export function createOpenChatFromSearchFeature(
  deps: OpenChatFromSearchFeatureDeps
): OpenChatFromSearchFeature {
  const { store, selectTarget, scrollToChatMsgIdx } = deps;

  const openChatFromSearch = (target: TargetRef, query: string, msgIdx?: number) => {
    const q = String(query || "").trim();
    selectTarget(target);
    const apply = () => {
      const st = store.get();
      if (!st.selected) return;
      if (conversationKey(st.selected) !== conversationKey(target)) return;
      store.set((prev) => ({
        ...prev,
        ...(q
          ? { chatSearchOpen: true, chatSearchResultsOpen: false, chatSearchQuery: q, chatSearchDate: "", chatSearchFilter: "all" }
          : {
              chatSearchOpen: false,
              chatSearchResultsOpen: false,
              chatSearchQuery: "",
              chatSearchDate: "",
              chatSearchFilter: "all",
              chatSearchHits: [],
              chatSearchPos: 0,
              chatSearchCounts: createChatSearchCounts(),
            }),
      }));
      if (Number.isFinite(msgIdx)) scrollToChatMsgIdx(Number(msgIdx));
    };
    queueMicrotask(apply);
    window.setTimeout(apply, 0);
    if (Number.isFinite(msgIdx)) {
      window.setTimeout(() => scrollToChatMsgIdx(Number(msgIdx)), 160);
    }
  };

  return { openChatFromSearch };
}
