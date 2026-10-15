import { el } from "../../helpers/dom/el";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { buildAppShellProjection } from "../../helpers/navigation/appShellProjection";
import type { AppState, BoardEntry, FriendEntry, GroupEntry, MobileSidebarTab, PageKind, TargetRef } from "../../stores/types";
import {
  attentionHintForPeer,
  friendRow,
  isRowMenuOpen,
  previewForConversation,
  roomRow,
} from "./renderSidebarHelpers";
import { preserveSidebarScrollDuring } from "./sidebarScrollStability";

export type RenderSidebarStandaloneCtx = {
  target: HTMLElement;
  body: HTMLElement;
  state: AppState;
  mobileTab: MobileSidebarTab;
  isMobile: boolean;
  mobileUi: boolean;
  forceResetScroll: boolean;
  hasSidebarQuery: boolean;
  archiveToggle: HTMLElement | null;
  groupArchiveToggle: HTMLElement | null;
  boardArchiveToggle: HTMLElement | null;
  groupArchiveOpen: boolean;
  boardArchiveOpen: boolean;
  archiveOpen: boolean;
  groupArchiveCount: number;
  boardArchiveCount: number;
  pinnedKeys: string[];
  pinnedSet: Set<string>;
  archivedSet: Set<string>;
  groups: GroupEntry[];
  boards: BoardEntry[];
  sel: AppState["selected"] | null;
  drafts: Record<string, string>;
  matchesQuery: (raw: string) => boolean;
  matchesFriend: (f: FriendEntry) => boolean;
  matchesRoom: (entry: { id: string; name?: string | null; handle?: string | null }) => boolean;
  isMuted: (id: string) => boolean;
  lastTsForKey: (key: string) => number;
  attnSet: Set<string>;
  mentionForKey: (key: string) => boolean;
  computeRoomUnread: (key: string) => number;
  buildSidebarArchiveHint: () => HTMLElement;
  buildSidebarArchiveEmpty: (label: string) => HTMLElement;
  buildSidebarHeaderToolbar: (activeTab: "contacts" | "groups" | "boards" | "menu") => HTMLElement;
  buildSidebarTabButton: (tab: MobileSidebarTab, activeTab: MobileSidebarTab, label: string) => HTMLButtonElement;
  buildSidebarSearchBar: (placeholder: string, opts?: { action?: HTMLElement }) => HTMLElement;
  buildSelfIdContactCard: () => HTMLElement | null;
  buildChatlist: (
    fixedRows: HTMLElement[],
    rows: HTMLElement[],
    emptyLabel?: string,
    opts?: { virtual?: boolean }
  ) => HTMLElement;
  setBodyChatlistClass: (children: HTMLElement[]) => void;
  bindHeaderScroll: (header: HTMLElement | null) => void;
  toggleClass: (node: HTMLElement | null | undefined, cls: string, enabled: boolean) => void;
  markCompactAvatarRows: (rows: Array<HTMLElement | null | undefined>) => HTMLElement[];
  dialogPriority: (opts: { hasDraft: boolean; unread?: number; attention?: boolean; mention?: boolean }) => number;
  unknownAttnPeers: string[];
  contactCandidates: FriendEntry[];
  activeContacts: FriendEntry[];
  archivedContacts: FriendEntry[];
  buildContactRows: (items: FriendEntry[], opts?: { sort?: boolean }) => HTMLElement[];
  buildTopPeerContactRows: (items: FriendEntry[]) => { ids: Set<string>; rows: HTMLElement[] };
  onSelect: (t: TargetRef) => void;
  onOpenUser: (id: string) => void;
  onSetPage: (page: PageKind) => void;
  onCreateGroup: () => void;
  onCreateBoard: () => void;
  onAuthOpen: () => void;
  onAuthLogout: () => void;
} & Record<string, unknown>;

export function renderSidebarStandalone(ctx: RenderSidebarStandaloneCtx) {
  const {
    target,
    state,
    body,
    mobileTab,
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
    buildSelfIdContactCard,
    buildSidebarHeaderToolbar,
    buildSidebarTabButton,
    buildSidebarSearchBar,
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
  } = ctx;
  const shell = buildAppShellProjection(state);

  const showMenuTab = isMobile;
  const defaultTab: MobileSidebarTab = "contacts";
  let activeTab: MobileSidebarTab =
    mobileTab === "contacts" || mobileTab === "groups" || mobileTab === "boards" || (showMenuTab && mobileTab === "menu")
      ? mobileTab
      : defaultTab;
  if (!showMenuTab && activeTab === "menu") activeTab = defaultTab;
  if ("dataset" in target) (target as HTMLElement).dataset.sidebarTab = activeTab;
  const prevTab = String((target as any)._pwaSidebarPrevTab || "").trim();
  const didSwitchTab = Boolean(prevTab && prevTab !== activeTab);
  const forceTopTab = Boolean(forceResetScroll || !prevTab || didSwitchTab);
  if (forceTopTab && !forceResetScroll) {
    try {
      (target as HTMLElement).dataset.sidebarResetScroll = "1";
      body.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  }

  const tabContacts = buildSidebarTabButton("contacts", activeTab, "Контакты");
  const tabGroups = buildSidebarTabButton("groups", activeTab, "Группы");
  const tabBoards = buildSidebarTabButton("boards", activeTab, "Каналы");
  const tabMenu = showMenuTab ? buildSidebarTabButton("menu", activeTab, "Меню") : null;

  const tabs = el(
    "div",
    {
      class: showMenuTab
        ? "sidebar-tabs sidebar-tabs-desktop sidebar-tabs-pwa sidebar-tabs-standalone"
        : "sidebar-tabs sidebar-tabs-desktop sidebar-tabs-standalone",
      role: "tablist",
      "aria-label": "Раздел",
    },
    [tabContacts, tabGroups, tabBoards, ...(tabMenu ? [tabMenu] : [])]
  );
  const tabsList = [tabContacts, tabGroups, tabBoards, ...(tabMenu ? [tabMenu] : [])];
  tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const idx = tabsList.findIndex((b) => b === document.activeElement);
    const next = idx < 0 ? 0 : (idx + dir + tabsList.length) % tabsList.length;
    e.preventDefault();
    tabsList[next]?.focus();
  });

  const searchBarAction =
    activeTab === "contacts"
      ? archiveToggle
      : activeTab === "groups"
        ? groupArchiveToggle
        : activeTab === "boards"
          ? boardArchiveToggle
          : null;
  const searchBar =
    showMenuTab && activeTab === "menu"
      ? null
      : buildSidebarSearchBar(
          activeTab === "contacts"
            ? "Поиск контакта"
            : activeTab === "groups"
              ? "Поиск группы"
              : activeTab === "boards"
                ? "Поиск канала"
                : "Поиск",
          searchBarAction ? { action: searchBarAction } : undefined
        );
  const headerToolbar = buildSidebarHeaderToolbar(activeTab);
  const headerStack = el("div", { class: "sidebar-header-stack" }, [
    headerToolbar,
    ...(activeTab === "menu"
      ? [el("div", { class: "sidebar-header-title" }, ["Меню"])]
      : [...(searchBar ? [searchBar] : [])]),
  ]);
  const header = el("div", { class: "sidebar-header" }, [headerStack]);
  const passesChatFilter = (_opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }): boolean => true;

  const pinnedBoardRows: HTMLElement[] = [];
  const pinnedDialogRowByKey = new Map<string, HTMLElement>();
  const pinnedContactEntries: FriendEntry[] = [];
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

  const mountPwa = (children: HTMLElement[]) => {
    preserveSidebarScrollDuring(body, forceTopTab, () => {
      setBodyChatlistClass(children);
      body.replaceChildren(...children);
      const nodes: HTMLElement[] = [header, tabs, body];
      target.replaceChildren(...nodes);
      bindHeaderScroll(header);
      (target as any)._pwaSidebarPrevTab = activeTab;
    });
  };

  if (activeTab === "groups") {
    const restGroups = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));
    const groupItems: Array<{ sortTs: number; priority: number; label: string; row: HTMLElement }> = [];
    const archivedItems: Array<{ sortTs: number; priority: number; label: string; row: HTMLElement }> = [];

    for (const g of restGroups) {
      if (!matchesRoom(g)) continue;
      const k = roomKey(g.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      const unread = computeRoomUnread(k);
      const mention = mentionForKey(k);
      const label = String(g.name || g.id);
      if (!passesChatFilter({ kind: "group", unread, mention })) continue;
      const item = {
        sortTs: lastTsForKey(k),
        priority: dialogPriority({ hasDraft: meta.hasDraft, mention, unread }),
        label,
        row: roomRow(
          null,
          label,
          Boolean(sel && sel.kind === "group" && sel.id === g.id),
          () => onSelect({ kind: "group", id: g.id }),
          { kind: "group", id: g.id },
          meta,
          { mention, muted: isMuted(g.id), unread, menuOpen: isRowMenuOpen(state, "group", g.id) }
        ),
      };
      if (!hasSidebarQuery && archivedSet.has(k)) archivedItems.push(item);
      else groupItems.push(item);
    }

    const sortSidebarItems = (
      a: { sortTs: number; priority: number; label: string },
      b: { sortTs: number; priority: number; label: string }
    ) =>
      b.sortTs - a.sortTs ||
      b.priority - a.priority ||
      a.label.localeCompare(b.label, "ru", { sensitivity: "base" });
    groupItems.sort(sortSidebarItems);
    archivedItems.sort(sortSidebarItems);
    const groupRows = groupItems.map((x) => x.row);
    const archivedRows = archivedItems.map((x) => x.row);
    const pinnedGroupRows = pinnedKeys
      .filter((key) => key.startsWith("room:"))
      .map((key) => pinnedDialogRowByKey.get(key))
      .filter(Boolean) as HTMLElement[];

    const rows: HTMLElement[] = [];
    if (groupArchiveOpen) {
      rows.push(
        el("div", { class: "pane-section pane-section-archive" }, [`Архив (${groupArchiveCount})`]),
        buildSidebarArchiveHint(),
        ...(archivedRows.length ? archivedRows : [buildSidebarArchiveEmpty("По текущему фильтру в архиве нет групп.")])
      );
    }
    const visibleRows = [...pinnedGroupRows, ...groupRows];
    if (visibleRows.length) {
      rows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Группы"]), ...visibleRows);
    }
    const groupList = buildChatlist([], rows, hasSidebarQuery ? "(ничего не найдено)" : "(пока нет групп)", {
      virtual: !groupArchiveOpen,
    });
    mountPwa([groupList]);
    return;
  }

  if (activeTab === "boards") {
    const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
    const boardItems: Array<{ sortTs: number; row: HTMLElement }> = [];
    const archivedItems: Array<{ sortTs: number; row: HTMLElement }> = [];
    for (const b of restBoards) {
      if (!matchesRoom(b)) continue;
      const k = roomKey(b.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      const unread = computeRoomUnread(k);
      const item = {
        sortTs: lastTsForKey(k),
        row: roomRow(
          null,
          String(b.name || b.id),
          Boolean(sel && sel.kind === "board" && sel.id === b.id),
          () => onSelect({ kind: "board", id: b.id }),
          { kind: "board", id: b.id },
          meta,
          { muted: isMuted(b.id), unread, menuOpen: isRowMenuOpen(state, "board", b.id) }
        ),
      };
      if (!hasSidebarQuery && archivedSet.has(k)) archivedItems.push(item);
      else boardItems.push(item);
    }
    boardItems.sort((a, b) => b.sortTs - a.sortTs);
    archivedItems.sort((a, b) => b.sortTs - a.sortTs);
    const boardRows = boardItems.map((x) => x.row);
    const archivedRows = archivedItems.map((x) => x.row);

    const boardFixedRows: HTMLElement[] = [];
    if (pinnedBoardRows.length) boardFixedRows.push(...pinnedBoardRows);
    boardFixedRows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Каналы"]));
    const archiveBlock = boardArchiveOpen
      ? [
          el("div", { class: "pane-section pane-section-archive" }, [`Архив (${boardArchiveCount})`]),
          buildSidebarArchiveHint(),
          ...archivedRows,
        ]
      : [];
    const rows = archiveBlock.length ? [...archiveBlock, ...boardRows] : boardRows;
    const boardList = buildChatlist(boardFixedRows, rows, hasSidebarQuery ? "(ничего не найдено)" : "(пока нет каналов)", {
      virtual: !boardArchiveOpen,
    });
    mountPwa([boardList]);
    return;
  }

  if (activeTab === "contacts") {
    const pinnedContactRowsCompact = buildContactRows(pinnedContactEntries, { sort: false });
    const contactRowsAll = buildContactRows(activeContacts);
    const { ids: topPeerIds, rows: topPeerRows } = buildTopPeerContactRows(activeContacts);
    const activeContactRows = buildContactRows(activeContacts.filter((f) => !topPeerIds.has(f.id)));
    const archiveBlock: HTMLElement[] = [];

    if (hasSidebarQuery) {
      const unknownAttnRows = unknownAttnPeers
        .filter((id) => matchesQuery(id))
        .map((id) => {
          const k = dmKey(id);
          const meta = previewForConversation(state, k, "dm", drafts[k]);
          const hint = attentionHintForPeer(state, id);
          const meta2 = meta.sub ? meta : { ...meta, sub: hint };
          const pseudo: FriendEntry = { id, online: false, unread: 0 };
          return friendRow(state, pseudo, Boolean(sel && sel.kind === "dm" && sel.id === id), meta2, onSelect, onOpenUser, true);
        });
      const allRows = markCompactAvatarRows([...unknownAttnRows, ...contactRowsAll]);
      const contactFixedRows: HTMLElement[] = [];
      if (pinnedContactRowsCompact.length) contactFixedRows.push(...pinnedContactRowsCompact);
      if (allRows.length) contactFixedRows.push(el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]));
      const contactList = buildChatlist(contactFixedRows, allRows, "(ничего не найдено)");
      mountPwa([contactList]);
      return;
    }

    const unknownAttnRows = markCompactAvatarRows(
      unknownAttnPeers.map((id) => {
        const k = dmKey(id);
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        const hint = attentionHintForPeer(state, id);
        const meta2 = meta.sub ? meta : { ...meta, sub: hint };
        const pseudo: FriendEntry = { id, online: false, unread: 0 };
        return friendRow(state, pseudo, Boolean(sel && sel.kind === "dm" && sel.id === id), meta2, onSelect, onOpenUser, true);
      })
    );

    const contactFixedRows: HTMLElement[] = [];
    if (pinnedContactRowsCompact.length) contactFixedRows.push(...pinnedContactRowsCompact);
    if (unknownAttnRows.length) contactFixedRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...unknownAttnRows);
    if (topPeerRows.length) contactFixedRows.push(el("div", { class: "pane-section" }, ["Топ"]), ...topPeerRows);
    if (!pinnedContactRowsCompact.length && !unknownAttnRows.length && !topPeerRows.length && !activeContactRows.length) {
      const selfCard = buildSelfIdContactCard();
      if (selfCard) contactFixedRows.push(selfCard);
    }
    if (activeContactRows.length && !archiveBlock.length) contactFixedRows.push(el("div", { class: "pane-section" }, ["Контакты"]));
    const contactRows = (() => {
      if (!archiveBlock.length) return activeContactRows;
      const rows: HTMLElement[] = [...archiveBlock];
      if (activeContactRows.length) rows.push(el("div", { class: "pane-section" }, ["Контакты"]), ...activeContactRows);
      return rows;
    })();
    const contactList = buildChatlist(contactFixedRows, contactRows, undefined, { virtual: !archiveOpen });
    mountPwa([contactList]);
    return;
  }

  const profileRow = roomRow("☺", "Профиль и настройки", shell.profileAreaOpen, () => onSetPage("profile"), undefined, {
    sub: "Аккаунт, оформление, уведомления",
    time: null,
    hasDraft: false,
  });
  toggleClass(profileRow, "row-settings", true);
  profileRow.setAttribute("title", "Профиль, внешний вид и настройки уведомлений");
  const searchRow = roomRow("🔍", "Поиск по истории", shell.isSearchPage, () => onSetPage("search"), undefined, {
    sub: "История, файлы, диалоги",
    time: null,
    hasDraft: false,
  });
  searchRow.setAttribute("title", "Глобальный поиск по истории");
  const filesRow = roomRow("▦", "Медиа и файлы", shell.isFilesPage, () => onSetPage("files"), undefined, {
    sub: "Передачи, загрузки, вложения",
    time: null,
    hasDraft: false,
  });
  filesRow.setAttribute("title", "Передача файлов и история");
  const navRows: HTMLElement[] = [profileRow, searchRow, filesRow];

  const createGroupRow = roomRow("+", "Новая группа", shell.isGroupCreatePage, () => onCreateGroup(), undefined, {
    sub: "Группа с приглашёнными участниками",
    time: null,
    hasDraft: false,
  });
  createGroupRow.setAttribute("title", "Создать новую группу");
  const createBoardRow = roomRow("+", "Новый канал", shell.isBoardCreatePage, () => onCreateBoard(), undefined, {
    sub: "Новости и информация",
    time: null,
    hasDraft: false,
  });
  createBoardRow.setAttribute("title", "Создать новый канал");
  const infoRow = roomRow("?", "Справка и версия", shell.isHelpPage, () => onSetPage("help"), undefined, {
    sub: mobileUi ? "Версии и изменения" : "Помощь, версии и изменения",
    time: null,
    hasDraft: false,
  });
  infoRow.setAttribute("title", mobileUi ? "Справка и журнал обновлений" : "Подсказки по клавишам и журнал обновлений");

  const accountRows: HTMLElement[] = [];
  if (shell.canLogin) {
    const loginRow = roomRow("→", "Войти", false, () => onAuthOpen(), undefined, {
      sub: "Вход или регистрация",
      time: null,
      hasDraft: false,
    });
    loginRow.setAttribute("title", "Войти или зарегистрироваться");
    accountRows.push(loginRow);
  } else if (shell.canLogout) {
    const logoutRow = roomRow("⏻", "Выход", false, () => onAuthLogout(), undefined, {
      sub: "Завершить сессию",
      time: null,
      hasDraft: false,
    });
    logoutRow.setAttribute("title", "Выйти из аккаунта");
    accountRows.push(logoutRow);
  }

  mountPwa([
    el("div", { class: "pane-section" }, ["Навигация"]),
    ...navRows,
    ...(accountRows.length ? [el("div", { class: "pane-section" }, ["Аккаунт"]), ...accountRows] : []),
    el("div", { class: "pane-section" }, ["Создание"]),
    createGroupRow,
    createBoardRow,
    el("div", { class: "pane-section" }, ["Справка"]),
    infoRow,
  ]);
}
