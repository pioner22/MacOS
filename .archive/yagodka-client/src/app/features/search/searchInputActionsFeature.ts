import { deriveServerSearchQuery } from "../../../helpers/search/serverSearchQuery";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

const SEARCH_DEBOUNCE_MS = 180;

export interface SearchInputActionsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  markUserInput: () => void;
}

export interface SearchInputActionsFeature {
  onSearchQueryChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  dispose: () => void;
}

export function createSearchInputActionsFeature(
  deps: SearchInputActionsFeatureDeps
): SearchInputActionsFeature {
  const { store, send, markUserInput } = deps;

  let searchDebounceTimer: number | null = null;
  let lastSearchIssued = "";

  const clearDebounce = () => {
    if (searchDebounceTimer === null) return;
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  };

  const onSearchQueryChange = (query: string) => {
    if (store.get().searchQuery === query) return;
    markUserInput();
    store.set({ searchQuery: query });

    clearDebounce();

    const st = store.get();
    if (!st.authed || st.conn !== "connected" || st.page !== "search") return;

    const q = query.trim();
    if (!q) {
      lastSearchIssued = "";
      store.set({ searchResults: [] });
      return;
    }

    const derived = deriveServerSearchQuery(q);
    if (!derived) {
      store.set({ searchResults: [] });
      return;
    }

    searchDebounceTimer = window.setTimeout(() => {
      searchDebounceTimer = null;
      const q2 = store.get().searchQuery.trim();
      if (!q2) return;
      const st2 = store.get();
      if (!st2.authed || st2.conn !== "connected" || st2.page !== "search") return;
      const d2 = deriveServerSearchQuery(q2);
      if (!d2) return;
      if (d2.query === lastSearchIssued) return;
      lastSearchIssued = d2.query;
      store.set({ searchResults: [] });
      send({ type: "search", query: d2.query });
    }, SEARCH_DEBOUNCE_MS);
  };

  const onSearchSubmit = (query: string) => {
    const q = query.trim();
    markUserInput();
    store.set({ searchQuery: q, searchResults: [] });
    if (!q) return;
    const derived = deriveServerSearchQuery(q);
    if (!derived) return;
    lastSearchIssued = derived.query;
    send({ type: "search", query: derived.query });
  };

  const dispose = () => {
    clearDebounce();
  };

  return {
    onSearchQueryChange,
    onSearchSubmit,
    dispose,
  };
}
