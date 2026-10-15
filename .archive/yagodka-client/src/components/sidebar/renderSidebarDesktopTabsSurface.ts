import { el } from "../../helpers/dom/el";
import { roomKey } from "../../helpers/chat/conversationKey";
import type { AppState, BoardEntry, FriendEntry, TargetRef } from "../../stores/types";
import { isRowMenuOpen, previewForConversation, roomRow } from "./renderSidebarHelpers";

export type SidebarDesktopDeferredTabKind = "boards" | "contacts";

export interface RenderSidebarDesktopTabsCtx {
  target: HTMLElement;
  kind: SidebarDesktopDeferredTabKind;
  state: AppState;
  boards: BoardEntry[];
  sel: AppState["selected"] | null;
  drafts: Record<string, string>;
  archivedSet: Set<string>;
  hasSidebarQuery: boolean;
  boardArchiveOpen: boolean;
  boardArchiveCount: number;
  archiveOpen: boolean;
  pinnedBoardRows: HTMLElement[];
  pinnedContactEntries: FriendEntry[];
  unknownAttnRows: HTMLElement[];
  activeContacts: FriendEntry[];
  archivedContacts: FriendEntry[];
  matchesRoom: (entry: { id: string; name?: string | null; handle?: string | null }) => boolean;
  computeRoomUnread: (key: string) => number;
  lastTsForKey: (key: string) => number;
  isMuted: (id: string) => boolean;
  buildSidebarArchiveHint: () => HTMLElement;
  buildSelfIdContactCard: () => HTMLElement | null;
  buildChatlist: (
    fixedRows: HTMLElement[],
    rows: HTMLElement[],
    emptyLabel?: string,
    opts?: { virtual?: boolean }
  ) => HTMLElement;
  markCompactAvatarRows: (rows: Array<HTMLElement | null | undefined>) => HTMLElement[];
  buildContactRows: (items: FriendEntry[], opts?: { sort?: boolean }) => HTMLElement[];
  buildTopPeerContactRows: (items: FriendEntry[]) => { ids: Set<string>; rows: HTMLElement[] };
  onSelect: (target: TargetRef) => void;
  mountDesktop: (children: HTMLElement[]) => void;
}

function renderBoardsSurface(ctx: RenderSidebarDesktopTabsCtx) {
  const {
    state,
    boards,
    sel,
    drafts,
    archivedSet,
    hasSidebarQuery,
    boardArchiveOpen,
    boardArchiveCount,
    pinnedBoardRows,
    matchesRoom,
    computeRoomUnread,
    lastTsForKey,
    isMuted,
    buildSidebarArchiveHint,
    buildChatlist,
    onSelect,
    mountDesktop,
  } = ctx;

  const restBoards = boards.filter((b) => !ctx.state.pinned?.includes(roomKey(b.id)));
  const boardItems: Array<{ sortTs: number; row: HTMLElement }> = [];
  const archivedItems: Array<{ sortTs: number; row: HTMLElement }> = [];
  for (const b of restBoards) {
    if (!matchesRoom(b)) continue;
    const key = roomKey(b.id);
    const meta = previewForConversation(state, key, "room", drafts[key]);
    const unread = computeRoomUnread(key);
    const item = {
      sortTs: lastTsForKey(key),
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
    if (!hasSidebarQuery && archivedSet.has(key)) archivedItems.push(item);
    else boardItems.push(item);
  }

  boardItems.sort((a, b) => b.sortTs - a.sortTs);
  archivedItems.sort((a, b) => b.sortTs - a.sortTs);
  const boardRows = boardItems.map((item) => item.row);
  const archivedRows = archivedItems.map((item) => item.row);

  const fixedRows: HTMLElement[] = [];
  if (pinnedBoardRows.length) fixedRows.push(...pinnedBoardRows);
  fixedRows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Каналы"]));

  const archiveBlock = boardArchiveOpen
    ? [
        el("div", { class: "pane-section pane-section-archive" }, [`Архив (${boardArchiveCount})`]),
        buildSidebarArchiveHint(),
        ...archivedRows,
      ]
    : [];
  const rows = archiveBlock.length ? [...archiveBlock, ...boardRows] : boardRows;
  const boardList = buildChatlist(fixedRows, rows, hasSidebarQuery ? "(ничего не найдено)" : "(пока нет каналов)", {
    virtual: !boardArchiveOpen,
  });
  mountDesktop([boardList]);
}

function renderContactsSurface(ctx: RenderSidebarDesktopTabsCtx) {
  const {
    hasSidebarQuery,
    archiveOpen,
    pinnedContactEntries,
    unknownAttnRows,
    activeContacts,
    buildSelfIdContactCard,
    buildChatlist,
    markCompactAvatarRows,
    buildContactRows,
    buildTopPeerContactRows,
    mountDesktop,
  } = ctx;

  const pinnedContactRowsCompact = buildContactRows(pinnedContactEntries, { sort: false });
  const contactRowsAll = buildContactRows(activeContacts);
  const { ids: topPeerIds, rows: topPeerRows } = buildTopPeerContactRows(activeContacts);
  const activeContactRows = buildContactRows(activeContacts.filter((friend) => !topPeerIds.has(friend.id)));
  const archiveBlock: HTMLElement[] = [];

  if (hasSidebarQuery) {
    const allRows = markCompactAvatarRows([...unknownAttnRows, ...contactRowsAll]);
    const fixedRows: HTMLElement[] = [];
    if (pinnedContactRowsCompact.length) fixedRows.push(...pinnedContactRowsCompact);
    if (allRows.length) fixedRows.push(el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]));
    const contactList = buildChatlist(fixedRows, allRows, "(ничего не найдено)");
    mountDesktop([contactList]);
    return;
  }

  const compactUnknownAttnRows = markCompactAvatarRows(unknownAttnRows);
  const fixedRows: HTMLElement[] = [];
  if (pinnedContactRowsCompact.length) fixedRows.push(...pinnedContactRowsCompact);
  if (compactUnknownAttnRows.length) fixedRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...compactUnknownAttnRows);
  if (topPeerRows.length) fixedRows.push(el("div", { class: "pane-section" }, ["Топ"]), ...topPeerRows);
  if (!pinnedContactRowsCompact.length && !compactUnknownAttnRows.length && !topPeerRows.length && !activeContactRows.length) {
    const selfCard = buildSelfIdContactCard();
    if (selfCard) fixedRows.push(selfCard);
  }
  if (activeContactRows.length && !archiveBlock.length) fixedRows.push(el("div", { class: "pane-section" }, ["Контакты"]));
  const contactRows = (() => {
    if (!archiveBlock.length) return activeContactRows;
    const rows: HTMLElement[] = [...archiveBlock];
    if (activeContactRows.length) rows.push(el("div", { class: "pane-section" }, ["Контакты"]), ...activeContactRows);
    return rows;
  })();
  const contactList = buildChatlist(fixedRows, contactRows, undefined, { virtual: !archiveOpen });
  mountDesktop([contactList]);
}

export function renderSidebarDesktopTabsSurface(ctx: RenderSidebarDesktopTabsCtx) {
  if (ctx.kind === "boards") {
    renderBoardsSurface(ctx);
    return;
  }
  renderContactsSurface(ctx);
}
