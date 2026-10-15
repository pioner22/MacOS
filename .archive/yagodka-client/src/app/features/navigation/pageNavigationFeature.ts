import { createChatSearchCounts } from "../../../helpers/chat/chatSearch";
import {
  applyPageState,
  applyPageTargetState,
  applyRightPanelTarget,
} from "../../../helpers/navigation/viewState";
import { getActiveConversationTarget, isMainConversationSurface } from "../../../helpers/navigation/mainConversationState";
import { setMobileSidebarTabValue } from "../../../helpers/sidebar/sidebarState";
import type { Store } from "../../../stores/store";
import type { AppState, MobileSidebarTab, PageKind, TargetRef } from "../../../stores/types";

export interface PageNavigationFeatureDeps {
  store: Store<AppState>;
  footer: HTMLElement;
  mobileSidebarMq: MediaQueryList;
  floatingSidebarMq: MediaQueryList;
  resetGroupCreateMembers: () => void;
  resetBoardCreateMembers: () => void;
  closeEmojiPopover: () => void;
  closeMobileSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setFloatingSidebarOpen: (open: boolean) => void;
  send: (payload: any) => void;
}

export interface PageNavigationFeature {
  setPage: (page: PageKind) => void;
  openUserPage: (id: string) => void;
  openGroupPage: (id: string) => void;
  openBoardPage: (id: string) => void;
  openRightPanel: (target: TargetRef) => void;
  closeRightPanel: () => void;
  installFooterNav: () => void;
}

export function createPageNavigationFeature(deps: PageNavigationFeatureDeps): PageNavigationFeature {
  const {
    store,
    footer,
    mobileSidebarMq,
    floatingSidebarMq,
    resetGroupCreateMembers,
    resetBoardCreateMembers,
    closeEmojiPopover,
    closeMobileSidebar,
    setMobileSidebarOpen,
    setFloatingSidebarOpen,
    send,
  } = deps;

  let footerInstalled = false;

  const setPage = (page: PageKind) => {
    const prevPage = store.get().page;
    if (prevPage === "group_create" && page !== "group_create") resetGroupCreateMembers();
    if (prevPage === "board_create" && page !== "board_create") resetBoardCreateMembers();
    if (page !== "main") closeEmojiPopover();
    store.set((prev) => {
      const next = applyPageState(prev, page);
      const withTab = page !== "main" ? setMobileSidebarTabValue(next, "menu") : next;
      return {
        ...withTab,
        ...(page !== "main"
          ? {
              chatSearchOpen: false,
              chatSearchResultsOpen: false,
              chatSearchQuery: "",
              chatSearchDate: "",
              chatSearchFilter: "all",
              chatSearchHits: [],
              chatSearchPos: 0,
              chatSearchCounts: createChatSearchCounts(),
            }
          : {}),
      };
    });
    const st = store.get();
    const keepSidebar = Boolean(
      (mobileSidebarMq.matches || floatingSidebarMq.matches) && isMainConversationSurface(st) && !getActiveConversationTarget(st)
    );
    if (st.page !== "main" || !keepSidebar) {
      closeMobileSidebar();
    } else if (mobileSidebarMq.matches) {
      setMobileSidebarOpen(true);
    } else if (floatingSidebarMq.matches) {
      setFloatingSidebarOpen(true);
    }
  };

  const openUserPage = (id: string) => {
    const uid = String(id || "").trim();
    if (!uid) return;
    setPage("user");
    store.set((prev) => ({ ...applyPageTargetState(prev, { kind: "dm", id: uid }), status: `Профиль: ${uid}` }));
    const st = store.get();
    if (st.authed && st.conn === "connected") {
      send({ type: "profile_get", id: uid });
    }
  };

  const openGroupPage = (id: string) => {
    const gid = String(id || "").trim();
    if (!gid) return;
    setPage("group");
    store.set((prev) => ({ ...applyPageTargetState(prev, { kind: "group", id: gid }), status: `Чат: ${gid}` }));
    const st = store.get();
    if (st.authed && st.conn === "connected") {
      send({ type: "group_info", group_id: gid });
    }
  };

  const openBoardPage = (id: string) => {
    const bid = String(id || "").trim();
    if (!bid) return;
    setPage("board");
    store.set((prev) => ({ ...applyPageTargetState(prev, { kind: "board", id: bid }), status: `Доска: ${bid}` }));
    const st = store.get();
    if (st.authed && st.conn === "connected") {
      send({ type: "board_info", board_id: bid });
    }
  };

  const openRightPanel = (target: TargetRef) => {
    const kind = target.kind;
    const id = String(target.id || "").trim();
    if (!id) return;
    store.set((prev) => applyRightPanelTarget(prev, { kind, id }));
    const st = store.get();
    if (st.authed && st.conn === "connected") {
      if (kind === "dm") send({ type: "profile_get", id });
      else if (kind === "group") send({ type: "group_info", group_id: id });
      else if (kind === "board") send({ type: "board_info", board_id: id });
    }
  };

  const closeRightPanel = () => {
    store.set((prev) => applyRightPanelTarget(prev, null));
  };

  const onFooterClick = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action]") as HTMLButtonElement | null;
    if (!btn) return;
    const action = String(btn.dataset.action || "");
    if (action === "nav-main") {
      setPage("main");
    } else if (action === "nav-search") {
      setPage("search");
    } else if (action === "nav-profile") {
      setPage("profile");
    } else if (action === "nav-files") {
      setPage("files");
    }
  };

  const installFooterNav = () => {
    if (footerInstalled) return;
    footerInstalled = true;
    footer.addEventListener("click", onFooterClick);
  };

  return {
    setPage,
    openUserPage,
    openGroupPage,
    openBoardPage,
    openRightPanel,
    closeRightPanel,
    installFooterNav,
  };
}
