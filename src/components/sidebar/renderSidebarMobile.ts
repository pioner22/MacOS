import { el } from "../../helpers/dom/el";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { buildAppShellProjection } from "../../helpers/navigation/appShellProjection";
import type { AppState, BoardEntry, FriendEntry, GroupEntry, MobileSidebarTab, PageKind, TargetRef } from "../../stores/types";
import { attentionHintForPeer, friendRow, isRowMenuOpen, previewForConversation, roomRow } from "./renderSidebarHelpers";
import { preserveSidebarScrollDuring } from "./sidebarScrollStability";

export type RenderSidebarMobileCtx = {
  target: HTMLElement;
  body: HTMLElement;
  sidebarDock?: HTMLElement | null;
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
  buildSelfIdContactCard: () => HTMLElement | null;
  buildSidebarTabButton: (tab: MobileSidebarTab, activeTab: MobileSidebarTab, label: string) => HTMLButtonElement;
  buildSidebarSearchBar: (placeholder: string, opts?: { action?: HTMLElement }) => HTMLElement;
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

export function renderSidebarMobile(ctx: RenderSidebarMobileCtx) {
  const {
    target,
    state,
    body,
    sidebarDock,
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

  const activeTab: MobileSidebarTab = mobileTab;
  const prevTab = String((target as any)._mobileSidebarPrevTab || "").trim();
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
  if ("dataset" in target) (target as HTMLElement).dataset.sidebarTab = activeTab;
  const tabContacts = buildSidebarTabButton("contacts", activeTab, "Контакты");
  const tabGroups = buildSidebarTabButton("groups", activeTab, "Группы");
  const tabBoards = buildSidebarTabButton("boards", activeTab, "Каналы");
  const tabMenu = buildSidebarTabButton("menu", activeTab, "Меню");
  const decorateBottomTab = (button: HTMLButtonElement, icon: string, label: string): HTMLButtonElement => {
    button.className = `${String(button.className || "").trim()} sidebar-tab-bottom`.trim();
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tab-icon", icon);
    return button;
  };
  const tabs = el("div", { class: "sidebar-tabs sidebar-tabs-mobile sidebar-tabs-bottom-nav", role: "tablist", "aria-label": "Раздел" }, [
    decorateBottomTab(tabContacts, "contacts", "Контакты"),
    decorateBottomTab(tabGroups, "groups", "Группы"),
    decorateBottomTab(tabBoards, "boards", "Каналы"),
    decorateBottomTab(tabMenu, "menu", "Меню"),
  ]);
  const searchBarAction =
    activeTab === "contacts"
      ? archiveToggle
      : activeTab === "groups"
        ? groupArchiveToggle
        : activeTab === "boards"
          ? boardArchiveToggle
          : null;
  const searchBar =
    activeTab === "menu"
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
  const bottomDock = sidebarDock || el("div", { class: "sidebar-bottom-dock" });
  bottomDock.className = Array.from(
    new Set(
      String(bottomDock.className || "")
        .split(/\s+/)
        .filter((name) => name && name !== "hidden" && name !== "sidebar-desktop-bottom")
        .concat("sidebar-mobile-bottom")
    )
  ).join(" ");
  bottomDock.removeAttribute("aria-hidden");
  bottomDock.setAttribute("role", "navigation");
  bottomDock.setAttribute("aria-label", "Разделы");
  bottomDock.replaceChildren(tabs);
  const menuTitle =
    activeTab === "menu"
      ? el("div", { class: "sidebar-mobile-title", role: "heading", "aria-level": "2" }, ["Меню"])
      : null;
  const topChildren = [
    ...(searchBar ? [searchBar] : []),
    ...(menuTitle ? [menuTitle] : []),
  ];
  const sticky = el("div", { class: "sidebar-mobile-sticky" }, topChildren);
  const passesChatFilter = (_opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }): boolean => true;
  const mountMobile = (children: HTMLElement[]) => {
    preserveSidebarScrollDuring(body, forceTopTab, () => {
      setBodyChatlistClass(children);
      body.replaceChildren(...children);
      target.replaceChildren(sticky, body, bottomDock);
      bindHeaderScroll(sticky);
      (target as any)._mobileSidebarPrevTab = activeTab;
    });
  };

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
    if (key.startsWith("room:")) {
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
      if (b) {
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
    }
  }

	    const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
	    const restGroups = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));

      if (activeTab === "groups") {
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
        const groupList = buildChatlist(
          [],
          rows,
          hasSidebarQuery ? "(ничего не найдено)" : "(пока нет групп)",
          { virtual: !groupArchiveOpen }
        );
        mountMobile([groupList]);
        return;
      }

	    if (activeTab === "boards") {
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
	      if (pinnedBoardRows.length) {
	        boardFixedRows.push(...pinnedBoardRows);
	      }
	      boardFixedRows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Каналы"]));
	      const archiveBlock = boardArchiveOpen
	        ? [
	            el("div", { class: "pane-section pane-section-archive" }, [`Архив (${boardArchiveCount})`]),
	            buildSidebarArchiveHint(),
	            ...archivedRows,
	          ]
	        : [];
	      const rows = archiveBlock.length ? [...archiveBlock, ...boardRows] : boardRows;
	      const boardList = buildChatlist(
	        boardFixedRows,
	        rows,
	        hasSidebarQuery ? "(ничего не найдено)" : "(пока нет каналов)",
	        { virtual: !boardArchiveOpen }
	      );
	      mountMobile([boardList]);
	      return;
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

  if (activeTab === "contacts") {
    const pinnedContactRowsCompact = buildContactRows(pinnedContactEntries, { sort: false });
    const contactRowsAll = buildContactRows(activeContacts);
    const { ids: topPeerIds, rows: topPeerRows } = buildTopPeerContactRows(activeContacts);
    const activeContactRows = buildContactRows(activeContacts.filter((f) => !topPeerIds.has(f.id)));
    const archiveBlock: HTMLElement[] = [];
    if (hasSidebarQuery) {
      const allRows = markCompactAvatarRows([...unknownAttnRows, ...contactRowsAll]);
      const contactFixedRows: HTMLElement[] = [];
      if (pinnedContactRowsCompact.length) {
        contactFixedRows.push(...pinnedContactRowsCompact);
      }
      if (allRows.length) {
        contactFixedRows.push(el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]));
      }
      const contactList = buildChatlist(contactFixedRows, allRows, "(ничего не найдено)");
      mountMobile([contactList]);
      return;
    }
    const compactUnknownAttnRows = markCompactAvatarRows(unknownAttnRows);
    const contactFixedRows: HTMLElement[] = [];
    if (pinnedContactRowsCompact.length) {
      contactFixedRows.push(...pinnedContactRowsCompact);
    }
    if (compactUnknownAttnRows.length) {
      contactFixedRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...compactUnknownAttnRows);
    }
    if (topPeerRows.length) {
      contactFixedRows.push(el("div", { class: "pane-section" }, ["Топ"]), ...topPeerRows);
    }
    if (!pinnedContactRowsCompact.length && !compactUnknownAttnRows.length && !topPeerRows.length && !activeContactRows.length) {
      const selfCard = buildSelfIdContactCard();
      if (selfCard) contactFixedRows.push(selfCard);
    }
    if (activeContactRows.length && !archiveBlock.length) {
      contactFixedRows.push(el("div", { class: "pane-section" }, ["Контакты"]));
    }
    const contactRows = (() => {
      if (!archiveBlock.length) return activeContactRows;
      const rows: HTMLElement[] = [...archiveBlock];
      if (activeContactRows.length) rows.push(el("div", { class: "pane-section" }, ["Контакты"]), ...activeContactRows);
      return rows;
    })();
    const contactList = buildChatlist(contactFixedRows, contactRows, undefined, { virtual: !archiveOpen });
    mountMobile([contactList]);
    return;
  }

  // Menu tab: действия и навигация.
  const profileRow = roomRow("☺", "Профиль и настройки", shell.profileAreaOpen, () => onSetPage("profile"), undefined, {
    sub: "Ваш ID, имя, фото, оформление",
    time: null,
    hasDraft: false,
  });
  toggleClass(profileRow, "row-settings", true);
  profileRow.setAttribute("title", "Настройки профиля и интерфейса");
  const searchRow = roomRow("🔍", "Поиск по истории", shell.isSearchPage, () => onSetPage("search"), undefined, {
    sub: "Сообщения, люди, медиа",
    time: null,
    hasDraft: false,
  });
  searchRow.setAttribute("title", "Глобальный поиск");
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
  const createRows: HTMLElement[] = [createGroupRow, createBoardRow];
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
    const logoutIcon = mobileUi ? "⏻" : "⎋";
    const logoutRow = roomRow(logoutIcon, mobileUi ? "Выход" : "Выход (F10)", false, () => onAuthLogout(), undefined, {
      sub: "Завершить сессию",
      time: null,
      hasDraft: false,
    });
    logoutRow.setAttribute("title", mobileUi ? "Выйти из аккаунта" : "Выйти из аккаунта (F10)");
    accountRows.push(logoutRow);
  }

  const tips = el("details", { class: "sidebar-tips" }, [
    el("summary", { class: "sidebar-tips-summary", title: "Короткие подсказки", "aria-label": "Подсказки" }, ["Подсказки"]),
    el("div", { class: "sidebar-tips-body" }, [
      el("div", { class: "sidebar-tip" }, ["ПКМ/долгий тап по контакту — меню действий."]),
      el("div", { class: "sidebar-tip" }, ["«Контакты» — люди и личные переписки, «Группы» — приглашённые пространства, «Каналы» — новости."]),
    ]),
  ]);

  mountMobile([
    tips,
    el("div", { class: "pane-section" }, ["Навигация"]),
    ...navRows,
    ...(accountRows.length ? [el("div", { class: "pane-section" }, ["Аккаунт"]), ...accountRows] : []),
    el("div", { class: "pane-section" }, ["Создание"]),
    ...createRows,
    el("div", { class: "pane-section" }, ["Справка"]),
    infoRow
  ]);
  return;

}
