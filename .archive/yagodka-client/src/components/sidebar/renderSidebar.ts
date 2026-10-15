import { el } from "../../helpers/dom/el";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { isIOS, isStandaloneDisplayMode } from "../../helpers/ui/iosInputAssistant";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { ActionModalPayload, AppState, FriendEntry, MobileSidebarTab, PageKind, TargetRef } from "../../stores/types";
import {
  attentionHintForPeer,
  friendRow,
  isRowMenuOpen,
  previewForConversation,
  roomRow,
} from "./renderSidebarHelpers";
import { buildSidebarProjection } from "./sidebarProjection";
import { renderSidebarDesktopDialogSurface } from "./renderSidebarDesktopDialogSurface";
import { clearDeferredSidebarMenu, renderSidebarMenuDeferred } from "./renderSidebarMenuRuntime";
import { clearDeferredSidebarDesktopTabs, renderSidebarDesktopTabsDeferred } from "./renderSidebarDesktopTabsRuntime";
import { clearDeferredSidebarMobile, renderSidebarMobileDeferred } from "./renderSidebarMobileRuntime";
import { clearDeferredSidebarStandalone, renderSidebarStandaloneDeferred } from "./renderSidebarStandaloneRuntime";
import { createSidebarRenderTools } from "./renderSidebarUiTools";
import { preserveSidebarScrollDuring } from "./sidebarScrollStability";

type SidebarRenderSurface = "contacts" | "groups" | "boards" | "menu";

function normalizeSidebarRenderSurface(tab: MobileSidebarTab): SidebarRenderSurface {
  return tab === "groups" || tab === "boards" || tab === "menu" ? tab : "contacts";
}

function resolveSidebarRenderSurface(tab: MobileSidebarTab, isMobile: boolean): SidebarRenderSurface {
  const surface = normalizeSidebarRenderSurface(tab);
  return !isMobile && surface === "menu" ? "contacts" : surface;
}

export function renderSidebar(
  target: HTMLElement,
  state: AppState,
  onSelect: (t: TargetRef) => void,
  onOpenUser: (id: string) => void,
  onOpenAction: (payload: ActionModalPayload) => void,
  onSetPage: (page: PageKind) => void,
  onCreateGroup: () => void,
  onCreateBoard: () => void,
  onSetMobileSidebarTab: (tab: MobileSidebarTab) => void,
  onSetSidebarFolderId: (folderId: string) => void,
  onSetSidebarQuery: (query: string) => void,
  onAuthOpen: () => void,
  onAuthLogout: () => void,
  onOpenSidebarToolsMenu: (x: number, y: number) => void,
  onToggleSidebarArchive: () => void = () => {},
  sidebarDock?: HTMLElement | null
) {
  const isMobile =
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 600px)").matches : false;
  const standaloneDisplay = isStandaloneDisplayMode();
  const mobileUi = isMobileLikeUi();
  const disableSearchWhileTyping = (() => {
    try {
      if (!isIOS()) return false;
      const ae = document.activeElement as any;
      const mode = typeof ae?.getAttribute === "function" ? String(ae.getAttribute("data-ios-assistant") || "") : "";
      return mode === "composer";
    } catch {
      return false;
    }
  })();
  const projection = buildSidebarProjection(state);
  const hostState = target as any;
  const prevRender = hostState.__sidebarRenderState as
    | {
        page: string;
        selectedKind: string;
        selectedId: string;
        mobileTab: string;
        sidebarQuery: string;
        sidebarArchiveOpen: boolean;
        conn: string;
        authed: boolean;
        selfId: string;
        isMobile: boolean;
        mobileUi: boolean;
        disableSearchWhileTyping: boolean;
        avatarsRev: number;
        friendsRef: AppState["friends"];
        groupsRef: AppState["groups"];
        boardsRef: AppState["boards"];
        profilesRef: AppState["profiles"];
        conversationsRef: AppState["conversations"] | null;
        pinnedRef: AppState["pinned"];
        archivedRef: AppState["archived"];
        mutedRef: AppState["muted"];
        pendingInRef: AppState["pendingIn"];
        pendingOutRef: AppState["pendingOut"];
        pendingGroupInvitesRef: AppState["pendingGroupInvites"];
        pendingGroupJoinRequestsRef: AppState["pendingGroupJoinRequests"];
        pendingBoardInvitesRef: AppState["pendingBoardInvites"];
        fileOffersInRef: AppState["fileOffersIn"];
      }
    | null;
  const selectedKind = projection.selectedKind;
  const selectedId = projection.selectedId;
  const sidebarQueryRaw = projection.sidebarQueryRaw;
  const sidebarRenderSurface = resolveSidebarRenderSurface(projection.mobileTab, isMobile);
  const conversationsRefForRender = sidebarRenderSurface === "contacts" || sidebarRenderSurface === "menu" ? null : state.conversations;
  const renderState = {
    page: state.page,
    selectedKind,
    selectedId,
    mobileTab: projection.mobileTab,
    sidebarQuery: sidebarQueryRaw,
    sidebarArchiveOpen: projection.sidebarArchiveOpen,
    conn: String(state.conn || ""),
    authed: Boolean(state.authed),
    selfId: String(state.selfId || ""),
    isMobile,
    mobileUi,
    disableSearchWhileTyping,
    avatarsRev: Math.max(0, Math.trunc(Number((state as any).avatarsRev || 0) || 0)),
    friendsRef: state.friends,
    groupsRef: state.groups,
    boardsRef: state.boards,
    profilesRef: state.profiles,
    conversationsRef: conversationsRefForRender,
    pinnedRef: state.pinned,
    archivedRef: state.archived,
    mutedRef: state.muted,
    pendingInRef: state.pendingIn,
    pendingOutRef: state.pendingOut,
    pendingGroupInvitesRef: state.pendingGroupInvites,
    pendingGroupJoinRequestsRef: state.pendingGroupJoinRequests,
    pendingBoardInvitesRef: state.pendingBoardInvites,
    fileOffersInRef: state.fileOffersIn,
  };
  const canSkipRender =
    prevRender &&
    prevRender.page === renderState.page &&
    prevRender.selectedKind === renderState.selectedKind &&
    prevRender.selectedId === renderState.selectedId &&
    prevRender.mobileTab === renderState.mobileTab &&
    prevRender.sidebarQuery === renderState.sidebarQuery &&
    prevRender.sidebarArchiveOpen === renderState.sidebarArchiveOpen &&
    prevRender.conn === renderState.conn &&
    prevRender.authed === renderState.authed &&
    prevRender.selfId === renderState.selfId &&
    prevRender.isMobile === renderState.isMobile &&
    prevRender.mobileUi === renderState.mobileUi &&
    prevRender.disableSearchWhileTyping === renderState.disableSearchWhileTyping &&
    prevRender.avatarsRev === renderState.avatarsRev &&
    prevRender.friendsRef === renderState.friendsRef &&
    prevRender.groupsRef === renderState.groupsRef &&
    prevRender.boardsRef === renderState.boardsRef &&
    prevRender.profilesRef === renderState.profilesRef &&
    prevRender.conversationsRef === renderState.conversationsRef &&
    prevRender.pinnedRef === renderState.pinnedRef &&
    prevRender.archivedRef === renderState.archivedRef &&
    prevRender.mutedRef === renderState.mutedRef &&
    prevRender.pendingInRef === renderState.pendingInRef &&
    prevRender.pendingOutRef === renderState.pendingOutRef &&
    prevRender.pendingGroupInvitesRef === renderState.pendingGroupInvitesRef &&
    prevRender.pendingGroupJoinRequestsRef === renderState.pendingGroupJoinRequestsRef &&
    prevRender.pendingBoardInvitesRef === renderState.pendingBoardInvitesRef &&
    prevRender.fileOffersInRef === renderState.fileOffersInRef;
  if (canSkipRender) return;
  hostState.__sidebarRenderState = renderState;

  const computeRoomUnread = projection.computeRoomUnread;
  const lastTsForKey = projection.lastTsForKey;
  const drafts = projection.drafts;
  const pinnedKeys = projection.pinnedKeys;
  const pinnedSet = projection.pinnedSet;
  const attnSet = projection.attnSet;
  const isMuted = projection.isMuted;
  const mentionForKey = projection.mentionForKey;
  const unknownAttnPeers = projection.unknownAttnPeers;
  const boards = projection.boards;
  const groups = projection.groups;
  const sel = projection.selected;
  const hasSidebarQuery = projection.hasSidebarQuery;
  const body = (() => {
    const existing =
      typeof (target as HTMLElement | null)?.querySelector === "function"
        ? ((target as HTMLElement).querySelector(".sidebar-body") as HTMLElement | null)
        : null;
    if (existing) return existing;
    const cached = (target as any)._sidebarBody as HTMLElement | null | undefined;
    if (cached) return cached;
    return el("div", { class: "sidebar-body" });
  })();
  if (!(target as any)._sidebarBody) (target as any)._sidebarBody = body;
  const {
    toggleClass,
    markCompactAvatarRows,
    dialogPriority,
    buildSidebarHeaderToolbar,
    buildSidebarTabButton,
    buildContactRows,
    buildTopPeerContactRows,
    bindHeaderScroll,
    buildFolderTabs,
    buildSidebarSearchBar,
    buildSidebarArchiveToggle,
    buildSidebarArchiveHint,
    buildSidebarArchiveEmpty,
    buildSelfIdContactCard,
    buildChatlist,
    clearVirtualChatlist,
  } = createSidebarRenderTools({
    body,
    state,
    selected: sel,
    drafts,
    attnSet,
    sidebarQueryRaw,
    disableSearchWhileTyping,
    onSetMobileSidebarTab,
    onSetSidebarFolderId,
    onSetSidebarQuery,
    onOpenUser,
    onSelect,
    onOpenSidebarToolsMenu,
    onCreateGroup,
    onCreateBoard,
    onToggleSidebarArchive,
  });
  toggleClass(body, "sidebar-mobile-body", isMobile);
  const setBodyChatlistClass = (children: HTMLElement[]) => {
    const hasChatlist = children.some((child) => Boolean(child?.classList?.contains("chatlist")));
    toggleClass(body, "sidebar-body-chatlist", hasChatlist);
  };
  if (sidebarDock) {
    toggleClass(sidebarDock, "hidden", true);
    toggleClass(sidebarDock, "sidebar-desktop-bottom", false);
    toggleClass(sidebarDock, "sidebar-mobile-bottom", false);
    sidebarDock.replaceChildren();
  }
  const prevPage = String((target as any)._sidebarPrevPage || "").trim();
  const pageChanged = Boolean(prevPage && prevPage !== state.page);
  if (pageChanged && state.page === "main") {
    try {
      (target as HTMLElement).dataset.sidebarResetScroll = "1";
      body.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  }
  const currentSelectedKey = projection.currentSelectedKey;
  const prevSelectedKey = String((target as any)._sidebarPrevSelectedKey || "").trim();
  const shouldResetOnReturn = Boolean(
    (isMobile || standaloneDisplay) && prevSelectedKey && !currentSelectedKey && state.page === "main"
  );
  if (shouldResetOnReturn) {
    try {
      (target as HTMLElement).dataset.sidebarResetScroll = "1";
      body.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  }
  (target as any)._sidebarPrevPage = state.page;
  (target as any)._sidebarPrevSelectedKey = currentSelectedKey;
  const forceResetScroll = (() => {
    try {
      return (
        (target as HTMLElement).dataset.sidebarResetScroll === "1" ||
        body.dataset.sidebarResetScroll === "1"
      );
    } catch {
      return false;
    }
  })();
  const matchesQuery = projection.matchesQuery;
  const matchesFriend = projection.matchesFriend;
  const matchesRoom = projection.matchesRoom;
  const archivedKeys = projection.archivedKeys;
  const archivedSet = projection.archivedSet;

  const groupArchiveCount = projection.groupArchiveCount;
  const groupArchiveVisible = projection.groupArchiveVisible;
  const groupArchiveOpen = projection.groupArchiveOpen;
  const groupArchiveToggle = groupArchiveVisible ? buildSidebarArchiveToggle(groupArchiveCount, groupArchiveOpen) : null;

  const boardArchiveCount = projection.boardArchiveCount;
  const boardArchiveVisible = projection.boardArchiveVisible;
  const boardArchiveOpen = projection.boardArchiveOpen;
  const boardArchiveToggle = boardArchiveVisible ? buildSidebarArchiveToggle(boardArchiveCount, boardArchiveOpen) : null;

  const contactCandidates = projection.contactCandidates;
  const activeContacts = projection.activeContacts;
  const archivedContacts: FriendEntry[] = projection.archivedContacts;
  const archiveOpen = false;
  const archiveToggle = null;
  clearVirtualChatlist();


  if (isMobile) {
    clearDeferredSidebarDesktopTabs(target);
    clearDeferredSidebarMenu(target);
    clearDeferredSidebarStandalone(target);
    renderSidebarMobileDeferred({
      target, state, body, sidebarDock, mobileTab: projection.mobileTab, isMobile, mobileUi,
      forceResetScroll, hasSidebarQuery,
      archiveToggle, groupArchiveToggle, boardArchiveToggle, groupArchiveOpen, boardArchiveOpen, archiveOpen,
      groupArchiveCount, boardArchiveCount, buildSidebarArchiveHint, buildSidebarArchiveEmpty,
      pinnedKeys, pinnedSet, archivedSet, groups, boards, sel, drafts,
      matchesQuery, matchesFriend, matchesRoom, isMuted, lastTsForKey, attnSet, mentionForKey, computeRoomUnread,
      buildSidebarTabButton, buildSidebarSearchBar, buildChatlist,
      setBodyChatlistClass, bindHeaderScroll, toggleClass, markCompactAvatarRows, dialogPriority,
      buildSelfIdContactCard,
      unknownAttnPeers, contactCandidates, activeContacts, archivedContacts, buildContactRows, buildTopPeerContactRows,
      onSelect, onOpenUser, onSetPage, onCreateGroup, onCreateBoard, onAuthOpen, onAuthLogout,
    });
    return;
  }
  clearDeferredSidebarMobile(target);

  if ("dataset" in target) delete (target as HTMLElement).dataset.sidebarTab;

  // PWA (standalone/fullscreen): tabs should behave like mobile (separate views),
  // not just as "scroll-to" shortcuts.
  if (standaloneDisplay) {
    clearDeferredSidebarDesktopTabs(target);
    clearDeferredSidebarMenu(target);
    renderSidebarStandaloneDeferred({
      target,
      state,
      body,
      mobileTab: projection.mobileTab,
      isMobile,
      mobileUi,
      forceResetScroll,
      hasSidebarQuery,
      archiveToggle,
      groupArchiveToggle,
      boardArchiveToggle,
      groupArchiveOpen,
      boardArchiveOpen,
      archiveOpen,
      groupArchiveCount,
      boardArchiveCount,
      pinnedKeys,
      pinnedSet,
      archivedSet,
      groups,
      boards,
      sel,
      drafts,
      matchesQuery,
      matchesFriend,
      matchesRoom,
      isMuted,
      lastTsForKey,
      attnSet,
      mentionForKey,
      computeRoomUnread,
      buildSidebarArchiveHint,
      buildSidebarArchiveEmpty,
      buildSidebarHeaderToolbar,
      buildSidebarTabButton,
      buildSidebarSearchBar,
      buildSelfIdContactCard,
      buildChatlist,
      setBodyChatlistClass,
      bindHeaderScroll,
      toggleClass,
      markCompactAvatarRows,
      dialogPriority,
      unknownAttnPeers,
      contactCandidates,
      activeContacts,
      archivedContacts,
      buildContactRows,
      buildTopPeerContactRows,
      onSelect,
      onOpenUser,
      onSetPage,
      onCreateGroup,
      onCreateBoard,
      onAuthOpen,
      onAuthLogout,
    });
    return;
  }
  clearDeferredSidebarStandalone(target);

  // Desktop (browser): compact tabs, меню через кнопку в шапке.
  type DesktopTab = "contacts" | "groups" | "boards" | "menu";
  const allowMenuTab = false;
  const showMenuTab = false;
  const defaultDesktopTab: DesktopTab = "contacts";
  const rawDesktopTab = projection.mobileTab;
  let activeDesktopTab: DesktopTab =
    rawDesktopTab === "contacts" ||
    rawDesktopTab === "groups" ||
    rawDesktopTab === "boards" ||
    rawDesktopTab === "menu"
      ? rawDesktopTab
      : defaultDesktopTab;
  if (!allowMenuTab && activeDesktopTab === "menu") activeDesktopTab = defaultDesktopTab;
  if ("dataset" in target) (target as HTMLElement).dataset.sidebarTab = activeDesktopTab;
  const desktopMenuDockRow = showMenuTab
    ? (() => {
        const row = roomRow("☰", "Меню", activeDesktopTab === "menu", () => onSetMobileSidebarTab("menu"));
        row.setAttribute("title", "Меню");
        return row;
      })()
    : null;
  const shouldShowDesktopDock = Boolean(sidebarDock && desktopMenuDockRow);
  if (sidebarDock) {
    toggleClass(sidebarDock, "hidden", !desktopMenuDockRow);
    toggleClass(sidebarDock, "sidebar-desktop-bottom", Boolean(desktopMenuDockRow));
    if (desktopMenuDockRow) sidebarDock.replaceChildren(desktopMenuDockRow);
  }

  const desktopTabContacts = buildSidebarTabButton("contacts", activeDesktopTab, "Контакты");
  const desktopTabGroups = buildSidebarTabButton("groups", activeDesktopTab, "Группы");
  const desktopTabBoards = buildSidebarTabButton("boards", activeDesktopTab, "Каналы");
  const desktopTabMenu = showMenuTab ? buildSidebarTabButton("menu", activeDesktopTab, "Меню") : null;

  const desktopTabs = el("div", { class: "sidebar-tabs sidebar-tabs-desktop", role: "tablist", "aria-label": "Раздел" }, [
    desktopTabContacts,
    desktopTabGroups,
    desktopTabBoards,
    ...(desktopTabMenu ? [desktopTabMenu] : []),
  ]);
  const desktopTabsList = [desktopTabContacts, desktopTabGroups, desktopTabBoards, ...(desktopTabMenu ? [desktopTabMenu] : [])];
  desktopTabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const idx = desktopTabsList.findIndex((b) => b === document.activeElement);
    const next = idx < 0 ? 0 : (idx + dir + desktopTabsList.length) % desktopTabsList.length;
    e.preventDefault();
    desktopTabsList[next]?.focus();
  });

  const searchBarAction =
    activeDesktopTab === "contacts"
      ? archiveToggle
      : activeDesktopTab === "groups"
          ? groupArchiveToggle
          : activeDesktopTab === "boards"
            ? boardArchiveToggle
            : null;
  const searchBar = buildSidebarSearchBar(
    activeDesktopTab === "contacts"
      ? "Поиск контакта"
      : activeDesktopTab === "groups"
          ? "Поиск группы"
          : activeDesktopTab === "boards"
            ? "Поиск канала"
            : "Поиск",
    searchBarAction ? { action: searchBarAction } : undefined
  );
  const headerToolbar = buildSidebarHeaderToolbar(activeDesktopTab);
  const headerStack = el("div", { class: "sidebar-header-stack" }, [
    headerToolbar,
    desktopTabs,
    ...(activeDesktopTab === "menu"
      ? [el("div", { class: "sidebar-header-title" }, ["Меню"])]
      : [searchBar]),
  ]);
  const header = el("div", { class: "sidebar-header" }, [headerStack]);
  const passesChatFilter = (_opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }): boolean => true;

  const pinnedBoardRows: HTMLElement[] = [];
  const pinnedContactEntries: FriendEntry[] = [];
  const pinnedDialogRowByKey = new Map<string, HTMLElement>();
  for (const key of pinnedKeys) {
    if (key.startsWith("dm:")) {
      const id = key.slice(3);
      const f = state.friends.find((x) => x.id === id);
      if (!f) continue;
      if (!matchesFriend(f)) continue;
      pinnedContactEntries.push(f);
      continue;
    }
    if (!key.startsWith("room:")) continue;
    const id = key.slice(5);
    const g = groups.find((x) => x.id === id);
    if (g) {
      if (!matchesRoom(g)) continue;
      const k = roomKey(g.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      const unread = computeRoomUnread(k);
      const mention = mentionForKey(k);
      if (!passesChatFilter({ kind: "group", unread, mention })) continue;
      const row = roomRow(
        null,
        String(g.name || g.id),
        Boolean(sel && sel.kind === "group" && sel.id === g.id),
        () => onSelect({ kind: "group", id: g.id }),
        { kind: "group", id: g.id },
        meta,
        { mention, muted: isMuted(g.id), unread, pinned: true, menuOpen: isRowMenuOpen(state, "group", g.id) }
      );
      pinnedDialogRowByKey.set(key, row);
      continue;
    }
    const b = boards.find((x) => x.id === id);
    if (!b) continue;
    if (!matchesRoom(b)) continue;
    const k = roomKey(b.id);
    const meta = previewForConversation(state, k, "room", drafts[k]);
    const unread = computeRoomUnread(k);
    pinnedBoardRows.push(
      roomRow(
        null,
        String(b.name || b.id),
        Boolean(sel && sel.kind === "board" && sel.id === b.id),
        () => onSelect({ kind: "board", id: b.id }),
        { kind: "board", id: b.id },
        meta,
        { muted: isMuted(b.id), unread, pinned: true, menuOpen: isRowMenuOpen(state, "board", b.id) }
      )
    );
  }

  const unknownAttnRows = unknownAttnPeers
    .filter((id) => (hasSidebarQuery ? matchesQuery(id) : true))
    .map((id) => {
      const k = dmKey(id);
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      const hint = attentionHintForPeer(state, id);
      const meta2 = meta.sub ? meta : { ...meta, sub: hint };
      const pseudo: FriendEntry = { id, online: false, unread: 0 };
      return friendRow(state, pseudo, Boolean(sel && sel.kind === "dm" && sel.id === id), meta2, onSelect, onOpenUser, true);
    });

  // Keep per-tab scroll positions to avoid "random" scroll jumps on tab switch.
  const prevTab = String((target as any)._desktopSidebarPrevTab || "").trim();
  const didSwitchTab = Boolean(prevTab && prevTab !== activeDesktopTab);
  const forceTopTab = Boolean(forceResetScroll || !prevTab || didSwitchTab);
  if (forceTopTab && !forceResetScroll) {
    try {
      (target as HTMLElement).dataset.sidebarResetScroll = "1";
      body.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  }

  const mountDesktop = (children: HTMLElement[]) => {
    preserveSidebarScrollDuring(body, forceTopTab, () => {
      setBodyChatlistClass(children);
      body.replaceChildren(...children);
      const nodes: HTMLElement[] = [header, body];
      if (shouldShowDesktopDock && sidebarDock) nodes.push(sidebarDock);
      target.replaceChildren(...nodes);
      bindHeaderScroll(header);
      (target as any)._desktopSidebarPrevTab = activeDesktopTab;
    });
  };

  if (activeDesktopTab === "menu") {
    clearDeferredSidebarDesktopTabs(target);
    renderSidebarMenuDeferred({
      target,
      state,
      mobileUi,
      onSetPage,
      onCreateGroup,
      onCreateBoard,
      onAuthOpen,
      onAuthLogout,
      mountDesktop,
    });
    return;
  }
  clearDeferredSidebarMenu(target);

  if (activeDesktopTab === "groups") {
    clearDeferredSidebarDesktopTabs(target);
    renderSidebarDesktopDialogSurface({
      kind: "groups",
      state,
      groups,
      sel,
      drafts,
      pinnedKeys,
      pinnedSet,
      archivedSet,
      pinnedDialogRowByKey,
      hasSidebarQuery,
      groupArchiveOpen,
      groupArchiveCount,
      matchesRoom,
      isMuted,
      lastTsForKey,
      mentionForKey,
      computeRoomUnread,
      passesChatFilter,
      dialogPriority,
      buildSidebarArchiveHint,
      buildSidebarArchiveEmpty,
      buildChatlist,
      onSelect,
      mountDesktop,
    });
    return;
  }

  renderSidebarDesktopTabsDeferred({
    target,
    kind: activeDesktopTab === "boards" ? "boards" : "contacts",
    state,
    boards,
    sel,
    drafts,
    archivedSet,
    hasSidebarQuery,
    boardArchiveOpen,
    boardArchiveCount,
    archiveOpen,
    pinnedBoardRows,
    pinnedContactEntries,
    unknownAttnRows,
    activeContacts,
    archivedContacts,
    matchesRoom,
    computeRoomUnread,
    lastTsForKey,
    isMuted,
    buildSidebarArchiveHint,
    buildChatlist,
    markCompactAvatarRows,
    buildSelfIdContactCard,
    buildContactRows,
    buildTopPeerContactRows,
    onSelect,
    mountDesktop,
  });
}
