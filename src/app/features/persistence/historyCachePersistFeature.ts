import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface HistoryCachePersistFeatureDeps {
  store: Store<AppState>;
  isHistoryCacheLoadedFor: (userId: string) => boolean;
  scheduleSaveHistoryCache: (store: Store<AppState>) => void;
}

export function installHistoryCachePersistFeature(deps: HistoryCachePersistFeatureDeps): void {
  const { store, isHistoryCacheLoadedFor, scheduleSaveHistoryCache } = deps;

  let prevHistoryCacheUser = store.get().selfId;
  let prevHistoryCacheConversationsRef = store.get().conversations;
  let prevHistoryCacheCursorRef = store.get().historyCursor;
  let prevHistoryCacheHasMoreRef = store.get().historyHasMore;

  store.subscribe(() => {
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    if (!isHistoryCacheLoadedFor(st.selfId)) return;
    const changed =
      st.selfId !== prevHistoryCacheUser ||
      st.conversations !== prevHistoryCacheConversationsRef ||
      st.historyCursor !== prevHistoryCacheCursorRef ||
      st.historyHasMore !== prevHistoryCacheHasMoreRef;
    if (!changed) return;
    prevHistoryCacheUser = st.selfId;
    prevHistoryCacheConversationsRef = st.conversations;
    prevHistoryCacheCursorRef = st.historyCursor;
    prevHistoryCacheHasMoreRef = st.historyHasMore;
    scheduleSaveHistoryCache(store);
  });
}
