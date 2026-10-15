import { clampChatSearchPos, computeChatSearchCounts, computeChatSearchHits, type ChatSearchCounts, type ChatSearchFilter, type ChatSearchableMessage } from "../../../helpers/chat/chatSearch";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface ChatSearchSyncFeatureDeps {
  store: Store<AppState>;
  searchableMessagesForSelected: (st: AppState) => ChatSearchableMessage[];
  normalizeChatSearchFilter: (filter: ChatSearchFilter, counts: ChatSearchCounts) => ChatSearchFilter;
  sameChatSearchCounts: (a: ChatSearchCounts, b: ChatSearchCounts) => boolean;
  sameNumberArray: (a: number[], b: number[]) => boolean;
}

export interface ChatSearchSyncFeature {
  maybeSyncChatSearchState: () => boolean;
}

export function createChatSearchSyncFeature(deps: ChatSearchSyncFeatureDeps): ChatSearchSyncFeature {
  const { store, searchableMessagesForSelected, normalizeChatSearchFilter, sameChatSearchCounts, sameNumberArray } = deps;

  const maybeSyncChatSearchState = (): boolean => {
    const st = store.get();
    if (!(st.page === "main" && st.chatSearchOpen && st.selected)) return false;

    const q = st.chatSearchQuery || "";
    const messages = searchableMessagesForSelected(st);
    const counts = computeChatSearchCounts(messages, q);
    const nextFilter = normalizeChatSearchFilter(st.chatSearchFilter, counts);
    const hits = q.trim() ? computeChatSearchHits(messages, q, nextFilter) : [];
    const nextPos = clampChatSearchPos(hits, st.chatSearchPos);

    const hitsChanged = !sameNumberArray(hits, st.chatSearchHits);
    const posChanged = nextPos !== st.chatSearchPos;
    const countsChanged = !sameChatSearchCounts(counts, st.chatSearchCounts);
    const filterChanged = nextFilter !== st.chatSearchFilter;
    const shouldClear = !q.trim() && (st.chatSearchHits.length > 0 || st.chatSearchPos !== 0);

    if (!(hitsChanged || posChanged || countsChanged || filterChanged || shouldClear)) return false;

    store.set((prev) => ({
      ...prev,
      chatSearchFilter: nextFilter,
      chatSearchHits: hits,
      chatSearchPos: nextPos,
      chatSearchCounts: counts,
    }));
    return true;
  };

  return {
    maybeSyncChatSearchState,
  };
}
