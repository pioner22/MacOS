import { conversationKey } from "../../../helpers/chat/conversationKey";
import {
  clampChatSearchPos,
  computeChatSearchCounts,
  computeChatSearchHits,
  createChatSearchCounts,
  stepChatSearchPos,
  type ChatSearchFilter,
} from "../../../helpers/chat/chatSearch";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface ChatSearchUiFeatureDeps {
  store: Store<AppState>;
  chatRoot: HTMLElement;
  showToast: (message: string, opts?: { kind?: "info" | "success" | "warn" | "error" }) => void;
  scheduleFocusComposer: () => void;
  jumpToChatMsgIdx: (idx: number) => void;
  scrollToChatMsgIdx: (idx: number) => void;
  ensureIndexVisible: (key: string, total: number, idx: number, searchActive: boolean) => void;
  getSearchableMessages: (st: AppState) => any[];
}

export interface ChatSearchUiFeature {
  focusChatSearch: (selectAll?: boolean) => void;
  setChatSearchDate: (value: string) => void;
  closeChatSearch: () => void;
  openChatSearch: () => void;
  setChatSearchQuery: (query: string) => void;
  setChatSearchFilter: (next: ChatSearchFilter) => void;
  toggleChatSearchResults: (force?: boolean) => void;
  handleSearchResultClick: (button: HTMLElement) => boolean;
  setChatSearchPos: (pos: number) => void;
  stepChatSearch: (dir: 1 | -1) => void;
}

export function createChatSearchUiFeature(deps: ChatSearchUiFeatureDeps): ChatSearchUiFeature {
  const {
    store,
    chatRoot,
    showToast,
    scheduleFocusComposer,
    jumpToChatMsgIdx,
    scrollToChatMsgIdx,
    ensureIndexVisible,
    getSearchableMessages,
  } = deps;

  const parseChatSearchDate = (value: string): { start: number; end: number } | null => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const [yearRaw, monthRaw, dayRaw] = raw.split("-");
    const year = Number.parseInt(yearRaw, 10);
    const month = Number.parseInt(monthRaw, 10);
    const day = Number.parseInt(dayRaw, 10);
    if (!year || !month || !day) return null;
    const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000;
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime() / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  };

  const focusChatSearch = (selectAll = false) => {
    const input = chatRoot.querySelector("#chat-search-input") as HTMLInputElement | null;
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch {
      try {
        input.focus();
      } catch {
        // ignore
      }
    }
    if (selectAll) {
      try {
        input.select();
      } catch {
        // ignore
      }
    }
  };

  const normalizeChatSearchFilter = (
    filter: ChatSearchFilter,
    counts: ReturnType<typeof createChatSearchCounts>
  ): ChatSearchFilter => {
    if (filter === "all") return "all";
    return counts[filter] > 0 ? filter : "all";
  };

  const setChatSearchDate = (value: string) => {
    const v = String(value ?? "");
    store.set((prev) => ({ ...prev, chatSearchDate: v }));
    const range = parseChatSearchDate(v);
    if (!range) return;
    const st = store.get();
    if (!st.selected) return;
    const key = conversationKey(st.selected);
    if (!key) return;
    const msgs = st.conversations[key] || [];
    if (!Array.isArray(msgs) || !msgs.length) {
      showToast("Сообщения пока не загружены", { kind: "info" });
      return;
    }
    const idx = msgs.findIndex((m: any) => {
      const ts = Number(m?.ts ?? 0);
      return ts >= range.start && ts < range.end;
    });
    if (idx < 0) {
      showToast("Сообщений за эту дату нет", { kind: "info" });
      return;
    }
    const searchActive = Boolean(st.chatSearchOpen && st.chatSearchQuery.trim());
    ensureIndexVisible(key, msgs.length, idx, searchActive);
    jumpToChatMsgIdx(idx);
  };

  const closeChatSearch = () => {
    store.set((prev) => ({
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
    queueMicrotask(() => scheduleFocusComposer());
  };

  const openChatSearch = () => {
    const st = store.get();
    if (st.page !== "main") return;
    if (st.modal) return;
    if (!st.selected) return;
    store.set((prev) => ({ ...prev, chatSearchOpen: true, chatSearchResultsOpen: false }));
    queueMicrotask(() => focusChatSearch(true));
  };

  const setChatSearchQuery = (query: string) => {
    const q = String(query ?? "");
    const trimmed = q.trim();
    store.set((prev) => {
      if (!prev.selected) {
        return {
          ...prev,
          chatSearchQuery: q,
          chatSearchResultsOpen: trimmed ? prev.chatSearchResultsOpen : false,
          chatSearchFilter: "all",
          chatSearchHits: [],
          chatSearchPos: 0,
          chatSearchCounts: createChatSearchCounts(),
        };
      }
      const messages = getSearchableMessages(prev);
      const counts = computeChatSearchCounts(messages, q);
      const nextFilter = normalizeChatSearchFilter(prev.chatSearchFilter, counts);
      const hits = computeChatSearchHits(messages, q, nextFilter);
      return {
        ...prev,
        chatSearchQuery: q,
        chatSearchResultsOpen: trimmed ? prev.chatSearchResultsOpen : false,
        chatSearchFilter: nextFilter,
        chatSearchHits: hits,
        chatSearchPos: 0,
        chatSearchCounts: counts,
      };
    });
    const st = store.get();
    if (st.chatSearchHits.length) {
      scrollToChatMsgIdx(st.chatSearchHits[st.chatSearchPos] ?? st.chatSearchHits[0]);
    }
  };

  const setChatSearchFilter = (next: ChatSearchFilter) => {
    const st = store.get();
    if (!st.selected) return;
    const messages = getSearchableMessages(st);
    const counts = computeChatSearchCounts(messages, st.chatSearchQuery || "");
    const normalized = normalizeChatSearchFilter(next, counts);
    const hits = computeChatSearchHits(messages, st.chatSearchQuery || "", normalized);
    store.set((prev) => ({
      ...prev,
      chatSearchFilter: normalized,
      chatSearchHits: hits,
      chatSearchPos: 0,
      chatSearchCounts: counts,
    }));
    if (hits.length) scrollToChatMsgIdx(hits[0]);
    focusChatSearch(false);
  };

  const toggleChatSearchResults = (force?: boolean) => {
    const st = store.get();
    if (!st.chatSearchOpen) return;
    if (!String(st.chatSearchQuery || "").trim()) {
      store.set({ chatSearchResultsOpen: false });
      return;
    }
    const next = force === undefined ? !st.chatSearchResultsOpen : Boolean(force);
    store.set({ chatSearchResultsOpen: next });
  };

  const handleSearchResultClick = (button: HTMLElement): boolean => {
    const st = store.get();
    const msgIdx = Number(button.getAttribute("data-msg-idx"));
    if (!Number.isFinite(msgIdx)) return false;
    let pos = Number(button.getAttribute("data-hit-pos"));
    if (!Number.isFinite(pos)) {
      pos = st.chatSearchHits.indexOf(msgIdx);
    }
    if (!Number.isFinite(pos) || pos < 0) return false;
    setChatSearchPos(pos);
    store.set({ chatSearchResultsOpen: false });
    jumpToChatMsgIdx(msgIdx);
    focusChatSearch(false);
    return true;
  };

  const setChatSearchPos = (pos: number) => {
    const st = store.get();
    if (!st.chatSearchOpen) return;
    if (!st.chatSearchHits.length) return;
    const nextPos = clampChatSearchPos(st.chatSearchHits, pos);
    store.set({ chatSearchPos: nextPos });
  };

  const stepChatSearch = (dir: 1 | -1) => {
    const st = store.get();
    if (!st.chatSearchOpen) return;
    if (!st.chatSearchHits.length) return;
    const nextPos = stepChatSearchPos(st.chatSearchHits, st.chatSearchPos, dir);
    store.set({ chatSearchPos: nextPos });
    const idx = store.get().chatSearchHits[nextPos];
    if (typeof idx === "number") scrollToChatMsgIdx(idx);
    focusChatSearch(false);
  };

  return {
    focusChatSearch,
    setChatSearchDate,
    closeChatSearch,
    openChatSearch,
    setChatSearchQuery,
    setChatSearchFilter,
    toggleChatSearchResults,
    handleSearchResultClick,
    setChatSearchPos,
    stepChatSearch,
  };
}
