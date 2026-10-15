import { el } from "../../helpers/dom/el";
import { roomKey } from "../../helpers/chat/conversationKey";
import type { AppState, GroupEntry, TargetRef } from "../../stores/types";
import { isRowMenuOpen, previewForConversation, roomRow } from "./renderSidebarHelpers";

type SidebarDialogKind = "groups";
type SidebarDialogItem = { sortTs: number; priority: number; label: string; row: HTMLElement };

export interface RenderSidebarDesktopDialogCtx {
  kind: SidebarDialogKind;
  state: AppState;
  groups: GroupEntry[];
  sel: AppState["selected"] | null;
  drafts: Record<string, string>;
  pinnedKeys: string[];
  pinnedSet: Set<string>;
  archivedSet: Set<string>;
  pinnedDialogRowByKey: Map<string, HTMLElement>;
  hasSidebarQuery: boolean;
  groupArchiveOpen: boolean;
  groupArchiveCount: number;
  matchesRoom: (entry: { id: string; name?: string | null; handle?: string | null }) => boolean;
  isMuted: (id: string) => boolean;
  lastTsForKey: (key: string) => number;
  mentionForKey: (key: string) => boolean;
  computeRoomUnread: (key: string) => number;
  passesChatFilter: (opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }) => boolean;
  dialogPriority: (opts: { hasDraft: boolean; unread?: number; attention?: boolean; mention?: boolean }) => number;
  buildSidebarArchiveHint: () => HTMLElement;
  buildSidebarArchiveEmpty: (label: string) => HTMLElement;
  buildChatlist: (
    fixedRows: HTMLElement[],
    rows: HTMLElement[],
    emptyLabel?: string,
    opts?: { virtual?: boolean }
  ) => HTMLElement;
  onSelect: (target: TargetRef) => void;
  mountDesktop: (children: HTMLElement[]) => void;
}

const sortSidebarItems = (a: SidebarDialogItem, b: SidebarDialogItem) =>
  b.sortTs - a.sortTs || b.priority - a.priority || a.label.localeCompare(b.label, "ru", { sensitivity: "base" });

function renderDesktopGroupsSurface(ctx: RenderSidebarDesktopDialogCtx) {
  const {
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
  } = ctx;

  const groupItems: SidebarDialogItem[] = [];
  const archivedItems: SidebarDialogItem[] = [];
  for (const g of groups.filter((x) => !pinnedSet.has(roomKey(x.id)))) {
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

  groupItems.sort(sortSidebarItems);
  archivedItems.sort(sortSidebarItems);
  const archivedRows = archivedItems.map((x) => x.row);
  const pinnedGroupRows = pinnedKeys
    .filter((key) => key.startsWith("room:"))
    .map((key) => pinnedDialogRowByKey.get(key))
    .filter(Boolean) as HTMLElement[];
  const visibleRows = [...pinnedGroupRows, ...groupItems.map((x) => x.row)];

  const rows: HTMLElement[] = [];
  if (groupArchiveOpen) {
    rows.push(
      el("div", { class: "pane-section pane-section-archive" }, [`Архив (${groupArchiveCount})`]),
      buildSidebarArchiveHint(),
      ...(archivedRows.length ? archivedRows : [buildSidebarArchiveEmpty("По текущему фильтру в архиве нет групп.")])
    );
  }
  if (visibleRows.length) {
    rows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Группы"]), ...visibleRows);
  }
  const groupList = buildChatlist([], rows, hasSidebarQuery ? "(ничего не найдено)" : "(пока нет групп)", {
    virtual: !groupArchiveOpen,
  });
  mountDesktop([groupList]);
}

export function renderSidebarDesktopDialogSurface(ctx: RenderSidebarDesktopDialogCtx) {
  renderDesktopGroupsSurface(ctx);
}
