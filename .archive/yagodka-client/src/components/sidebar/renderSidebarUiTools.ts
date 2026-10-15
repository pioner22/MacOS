import { el } from "../../helpers/dom/el";
import { dmKey } from "../../helpers/chat/conversationKey";
import { copyText } from "../../helpers/dom/copyText";
import { focusElement } from "../../helpers/ui/focus";
import type { AppState, FriendEntry, MobileSidebarTab, TargetRef } from "../../stores/types";
import {
  avatar,
  displayNameForFriend,
  friendRow,
  isRowMenuOpen,
  previewForConversation,
  roomRow,
  type SidebarRowMeta,
} from "./renderSidebarHelpers";

type HeaderToolbarTab = "contacts" | "boards" | "groups" | "menu";

const SIDEBAR_TAB_META: Partial<Record<MobileSidebarTab, { icon: string }>> = {
  contacts: { icon: "contacts" },
  groups: { icon: "groups" },
  boards: { icon: "boards" },
  menu: { icon: "menu" },
};

export interface SidebarRenderToolsDeps {
  body: HTMLElement;
  state: AppState;
  selected: TargetRef | null;
  drafts: Record<string, string>;
  attnSet: Set<string>;
  sidebarQueryRaw: string;
  disableSearchWhileTyping: boolean;
  onSetMobileSidebarTab: (tab: MobileSidebarTab) => void;
  onSetSidebarFolderId: (folderId: string) => void;
  onSetSidebarQuery: (query: string) => void;
  onOpenUser: (id: string) => void;
  onSelect: (target: TargetRef) => void;
  onOpenSidebarToolsMenu: (x: number, y: number) => void;
  onCreateGroup: () => void;
  onCreateBoard: () => void;
  onToggleSidebarArchive: () => void;
}

export interface SidebarRenderTools {
  toggleClass: (node: HTMLElement | null | undefined, cls: string, enabled: boolean) => void;
  markCompactAvatarRows: (rows: Array<HTMLElement | null | undefined>) => HTMLElement[];
  dialogPriority: (opts: { hasDraft: boolean; unread?: number; attention?: boolean; mention?: boolean }) => number;
  buildSidebarHeaderToolbar: (activeTab: HeaderToolbarTab) => HTMLElement;
  buildSidebarTabButton: (tab: MobileSidebarTab, activeTab: MobileSidebarTab, label: string) => HTMLButtonElement;
  buildContactRows: (items: FriendEntry[], opts?: { sort?: boolean }) => HTMLElement[];
  buildTopPeerContactRows: (items: FriendEntry[]) => { ids: Set<string>; rows: HTMLElement[] };
  bindHeaderScroll: (header: HTMLElement | null) => void;
  buildFolderTabs: (activeId: string, folders: any[]) => HTMLElement | null;
  buildSidebarSearchBar: (placeholder: string, opts?: { action?: HTMLElement }) => HTMLElement;
  buildSidebarArchiveToggle: (count: number, active: boolean) => HTMLElement;
  buildSidebarArchiveHint: () => HTMLElement;
  buildSidebarArchiveEmpty: (label: string) => HTMLElement;
  buildSelfIdContactCard: () => HTMLElement | null;
  buildChatlist: (
    fixedRows: HTMLElement[],
    rows: HTMLElement[],
    emptyLabel?: string,
    opts?: { virtual?: boolean }
  ) => HTMLElement;
  clearVirtualChatlist: () => void;
}

const VIRTUAL_CHATLIST_MIN_ROWS = 80;
const VIRTUAL_CHATLIST_OVERSCAN = 6;

function lastSeenTs(friend: FriendEntry): number {
  const raw = (friend as any).last_seen_at;
  if (!raw) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (raw instanceof Date) {
    const ts = raw.getTime();
    return Number.isFinite(ts) ? ts : 0;
  }
  const ts = Date.parse(String(raw));
  return Number.isFinite(ts) ? ts : 0;
}

function formatLastSeenLabel(ts: number): string | null {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "был(а) только что";
  if (diff < hour) {
    const mins = Math.max(1, Math.floor(diff / minute));
    return `был(а) ${mins} мин назад`;
  }
  if (diff < day) {
    const hours = Math.max(1, Math.floor(diff / hour));
    return `был(а) ${hours} ч назад`;
  }
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;
  const label = date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  return `был(а) ${label}`;
}

export function createSidebarRenderTools(deps: SidebarRenderToolsDeps): SidebarRenderTools {
  const {
    body,
    state,
    selected,
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
  } = deps;

  const toggleClass = (node: HTMLElement | null | undefined, cls: string, enabled: boolean) => {
    if (!node) return;
    const list = node.classList;
    if (list && typeof list.toggle === "function") {
      list.toggle(cls, enabled);
      return;
    }
    const raw = String((node as any).className || "");
    const parts = raw.split(/\s+/).filter(Boolean);
    const has = parts.includes(cls);
    if (enabled && !has) parts.push(cls);
    if (!enabled && has) parts.splice(parts.indexOf(cls), 1);
    (node as any).className = parts.join(" ");
  };

  const markCompactAvatarRows = (rows: Array<HTMLElement | null | undefined>): HTMLElement[] => {
    const out: HTMLElement[] = [];
    for (const row of rows) {
      if (!row) continue;
      toggleClass(row, "row-avatar-compact", true);
      out.push(row);
    }
    return out;
  };

  const dialogPriority = (opts: { hasDraft: boolean; unread?: number; attention?: boolean; mention?: boolean }): number => {
    let score = 0;
    if (opts.mention) score += 4;
    if (opts.hasDraft) score += 3;
    if ((opts.unread || 0) > 0) score += 2;
    if (opts.attention) score += 1;
    return score;
  };

  const buildSidebarHeaderToolbar = (activeTab: HeaderToolbarTab): HTMLElement => {
    const menuBtn = el(
      "button",
      {
        class: activeTab === "menu" ? "btn sidebar-header-btn sidebar-header-btn-active" : "btn sidebar-header-btn",
        type: "button",
        title: "Меню",
        "aria-label": "Меню",
        "data-sidebar-action": "menu",
      },
      ["☰"]
    ) as HTMLButtonElement;
    menuBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onOpenSidebarToolsMenu === "function") {
        const rect = menuBtn.getBoundingClientRect();
        onOpenSidebarToolsMenu(rect.right, rect.bottom);
        return;
      }
      onSetMobileSidebarTab("menu");
    });

    const isBoardTab = activeTab === "boards";
    const createLabel = isBoardTab ? "Создать канал" : "Создать группу";
    const createBtn = el(
      "button",
      {
        class: "btn sidebar-header-btn sidebar-header-btn-primary",
        type: "button",
        title: createLabel,
        "aria-label": createLabel,
        "data-sidebar-action": isBoardTab ? "create-board" : "create-group",
      },
      ["+"]
    ) as HTMLButtonElement;
    createBtn.addEventListener("click", () => {
      if (isBoardTab) {
        onCreateBoard();
        return;
      }
      onCreateGroup();
    });

    return el("div", { class: "sidebar-header-toolbar" }, [menuBtn, createBtn]);
  };

  const buildSidebarTabButton = (tab: MobileSidebarTab, activeTab: MobileSidebarTab, label: string): HTMLButtonElement => {
    const btn = el(
      "button",
      {
        class: activeTab === tab ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === tab),
        title: label,
        "data-tab-icon": SIDEBAR_TAB_META[tab]?.icon || tab,
      },
      [label]
    ) as HTMLButtonElement;
    btn.addEventListener("click", () => onSetMobileSidebarTab(tab));
    return btn;
  };

  const contactStatusLabel = (friend: FriendEntry): string | null => {
    const parts: string[] = [];
    if (friend.online) {
      parts.push("в сети");
    } else {
      const seenLabel = formatLastSeenLabel(lastSeenTs(friend));
      if (seenLabel) parts.push(seenLabel);
    }
    const id = String(friend.id || "").trim();
    const rawHandle = String(friend.handle || state.profiles?.[id]?.handle || "").trim();
    const handle = rawHandle.replace(/^@/, "");
    if (handle) parts.push(`@${handle}`);
    return parts.length ? parts.join(" · ") : null;
  };

  const compareContactsByPresence = (a: FriendEntry, b: FriendEntry): number => {
    const aOnline = Boolean(a.online);
    const bOnline = Boolean(b.online);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    const aSeen = lastSeenTs(a);
    const bSeen = lastSeenTs(b);
    if (aSeen !== bSeen) return bSeen - aSeen;
    return displayNameForFriend(state, a).localeCompare(displayNameForFriend(state, b), "ru", { sensitivity: "base" });
  };

  const buildContactRows = (items: FriendEntry[], opts?: { sort?: boolean }): HTMLElement[] => {
    const ordered = items.slice();
    if (opts?.sort !== false) ordered.sort(compareContactsByPresence);
    return markCompactAvatarRows(
      ordered.map((friend) => {
        const id = String(friend.id || "").trim();
        const key = id ? dmKey(id) : "";
        const dialogMeta = key ? previewForConversation(state, key, "dm", drafts[key]) : null;
        const hasDialogState = Boolean(
          dialogMeta?.sub ||
            dialogMeta?.time ||
            dialogMeta?.hasDraft ||
            dialogMeta?.reactionEmoji ||
            Math.max(0, Number(friend.unread || 0) || 0) > 0 ||
            attnSet.has(friend.id)
        );
        const meta: SidebarRowMeta = {
          sub: hasDialogState ? dialogMeta?.sub || contactStatusLabel(friend) : contactStatusLabel(friend),
          time: hasDialogState ? dialogMeta?.time || null : null,
          hasDraft: hasDialogState ? Boolean(dialogMeta?.hasDraft) : false,
          reactionEmoji: hasDialogState ? dialogMeta?.reactionEmoji || null : null,
        };
        return friendRow(
          state,
          friend,
          Boolean(selected && selected.kind === "dm" && selected.id === friend.id),
          meta,
          onSelect,
          onOpenUser,
          attnSet.has(friend.id)
        );
      })
    );
  };

  const buildTopPeerContactRows = (items: FriendEntry[]): { ids: Set<string>; rows: HTMLElement[] } => {
    const topPeers = Array.isArray(state.topPeers) ? state.topPeers : [];
    if (!topPeers.length || !items.length) return { ids: new Set(), rows: [] };
    const byId = new Map<string, FriendEntry>();
    for (const friend of items) {
      const id = String(friend?.id || "").trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, friend);
    }
    const ids = new Set<string>();
    const entries: FriendEntry[] = [];
    for (const entry of topPeers) {
      const id = String((entry as any)?.id || "").trim();
      if (!id || ids.has(id)) continue;
      const friend = byId.get(id);
      if (!friend) continue;
      ids.add(id);
      entries.push(friend);
      if (entries.length >= 12) break;
    }
    return { ids, rows: entries.length ? buildContactRows(entries, { sort: false }) : [] };
  };

  const bindHeaderScroll = (header: HTMLElement | null) => {
    const prev = (body as any)._sidebarHeaderScrollHandler as (() => void) | undefined;
    if (prev) body.removeEventListener("scroll", prev);
    if (!header) {
      delete (body as any)._sidebarHeaderScrollHandler;
      return;
    }
    const handler = () => toggleClass(header, "sidebar-header-scrolled", (body as any).scrollTop > 0);
    (body as any)._sidebarHeaderScrollHandler = handler;
    body.addEventListener("scroll", handler, { passive: true });
    handler();
  };

  const buildFolderTabs = (activeId: string, folders: any[]): HTMLElement | null => {
    const list = Array.isArray(folders) ? folders : [];
    if (!list.length) return null;
    const normActive = String(activeId || "all").trim().toLowerCase() || "all";
    const makeBtn = (id: string, label: string) => {
      const active = normActive === id;
      const btn = el(
        "button",
        {
          class: active ? "sidebar-filter sidebar-filter-active" : "sidebar-filter",
          type: "button",
          role: "tab",
          "aria-selected": String(active),
          "aria-label": label,
          title: label,
        },
        [label]
      ) as HTMLButtonElement;
      btn.addEventListener("click", () => onSetSidebarFolderId(id));
      return btn;
    };

    const items: HTMLElement[] = [makeBtn("all", "Все")];
    for (const folder of list) {
      const id = String((folder as any)?.id || "").trim().toLowerCase();
      if (!id || id === "all" || id === "archive") continue;
      const title = String((folder as any)?.title || "").trim();
      if (!title) continue;
      const emoji = typeof (folder as any)?.emoji === "string" ? String((folder as any).emoji).trim() : "";
      const label = emoji ? `${emoji} ${title}` : title;
      items.push(makeBtn(id, label));
    }
    return el("div", { class: "sidebar-filters sidebar-folders", role: "tablist", "aria-label": "Папки" }, items);
  };

  const buildSidebarSearchBar = (placeholder: string, opts?: { action?: HTMLElement }): HTMLElement => {
    const input = el("input", {
      class: "sidebar-search-input",
      type: "search",
      placeholder,
      "aria-label": "Поиск",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "search",
    }) as HTMLInputElement;
    const searchIcon = el(
      "button",
      {
        class: "btn sidebar-search-icon sidebar-search-trigger",
        type: "button",
        title: "Поиск",
        "aria-label": "Открыть поиск",
      },
      [""]
    ) as HTMLButtonElement;
    input.value = sidebarQueryRaw;
    input.disabled = disableSearchWhileTyping;
    const clearBtn = el(
      "button",
      {
        class: "btn sidebar-search-clear",
        type: "button",
        title: "Очистить",
        "aria-label": "Очистить",
      },
      ["×"]
    ) as HTMLButtonElement;
    const updateClearState = () => toggleClass(clearBtn, "hidden", !input.value.trim());
    updateClearState();
    input.addEventListener("input", () => {
      onSetSidebarQuery(input.value);
      updateClearState();
    });
    input.addEventListener("search", () => {
      onSetSidebarQuery(input.value);
      updateClearState();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      input.value = "";
      onSetSidebarQuery("");
      updateClearState();
    });
    clearBtn.addEventListener("click", (event) => {
      event.preventDefault();
      input.value = "";
      onSetSidebarQuery("");
      updateClearState();
      focusElement(input);
    });
    searchIcon.addEventListener("click", (event) => {
      event.preventDefault();
      focusElement(input);
    });
    const children: HTMLElement[] = [searchIcon, input, clearBtn];
    if (opts?.action) children.push(opts.action);
    const cls = sidebarQueryRaw.trim() ? "sidebar-searchbar sidebar-searchbar-expanded" : "sidebar-searchbar";
    return el("div", { class: cls }, children);
  };

  const buildSidebarArchiveToggle = (count: number, active: boolean): HTMLElement => {
    const label = count > 0 ? `Архив (${count})` : "Архив";
    const btn = el(
      "button",
      {
        class: active ? "btn sidebar-archive-toggle sidebar-archive-toggle-active" : "btn sidebar-archive-toggle",
        type: "button",
        "aria-pressed": String(active),
        title: label,
      },
      [label]
    ) as HTMLButtonElement;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      onToggleSidebarArchive();
    });
    return btn;
  };

  const buildSidebarArchiveHint = (): HTMLElement =>
    el("div", { class: "sidebar-archive-hint" }, ["Чтобы вернуть из архива: ПКМ/долгое нажатие по строке → «Убрать из архива»."]);

  const buildSidebarArchiveEmpty = (label: string): HTMLElement => el("div", { class: "sidebar-archive-empty" }, [label]);

  const buildSelfIdContactCard = (): HTMLElement | null => {
    const id = String(state.selfId || state.authRememberedId || "").trim();
    if (!id) return null;
    const shareText = `Мой ID в Ягодке: ${id}`;
    const copyBtn = el("button", { class: "btn btn-primary sidebar-self-id-copy", type: "button" }, ["Скопировать ID"]) as HTMLButtonElement;
    const shareBtn = el("button", { class: "btn sidebar-self-id-share", type: "button" }, ["Поделиться"]) as HTMLButtonElement;
    const flash = (button: HTMLButtonElement, label: string) => {
      const prev = button.textContent || label;
      button.textContent = label;
      try {
        window.setTimeout(() => {
          button.textContent = prev;
        }, 1200);
      } catch {
        button.textContent = prev;
      }
    };
    copyBtn.addEventListener("click", (event) => {
      event.preventDefault();
      void copyText(id).then((ok) => flash(copyBtn, ok ? "Скопировано" : "Не скопировано"));
    });
    shareBtn.addEventListener("click", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          if (typeof navigator.share === "function") {
            await navigator.share({ title: "Мой ID в Ягодке", text: shareText });
            flash(shareBtn, "Отправлено");
            return;
          }
        } catch {
          // fallback to clipboard below
        }
        const ok = await copyText(id);
        flash(shareBtn, ok ? "ID скопирован" : "Не скопировано");
      })();
    });
    const idButton = el("button", { class: "sidebar-self-id-value", type: "button", title: "Скопировать ID" }, [id]) as HTMLButtonElement;
    idButton.addEventListener("click", (event) => {
      event.preventDefault();
      void copyText(id).then((ok) => flash(idButton, ok ? "Скопировано" : id));
    });
    return el("div", { class: "sidebar-self-id-card", role: "region", "aria-label": "Ваш ID" }, [
      el("div", { class: "sidebar-self-id-kicker" }, ["Ваш ID"]),
      idButton,
      el("div", { class: "sidebar-self-id-copyline" }, ["Отправьте этот ID человеку, чтобы он смог добавить вас в контакты."]),
      el("div", { class: "sidebar-self-id-actions" }, [copyBtn, shareBtn]),
    ]);
  };

  const wrapChatlist = (children: HTMLElement[]): HTMLElement => el("div", { class: "chatlist virtual-chatlist" }, children);

  const clearVirtualChatlist = () => {
    const prev = (body as any)._virtualChatlistCleanup as (() => void) | undefined;
    if (prev) prev();
    delete (body as any)._virtualChatlistCleanup;
  };

  const buildVirtualChatlistBlock = (rows: HTMLElement[]): HTMLElement => {
    const topSpacer = el("div", { class: "chatlist-virtual-spacer", "aria-hidden": "true" });
    const bottomSpacer = el("div", { class: "chatlist-virtual-spacer", "aria-hidden": "true" });
    const items = el("div", { class: "chatlist-virtual-items" });
    const block = el("div", { class: "chatlist-virtual-block" }, [topSpacer, items, bottomSpacer]);
    const runtime = {
      active: true,
      start: -1,
      end: -1,
      raf: 0 as number | 0,
      rowHeight: 0,
    };

    const measureRenderedRowHeight = (): number => {
      const first = items.firstElementChild as HTMLElement | null;
      if (!first) return 0;
      try {
        const rect = first.getBoundingClientRect();
        const height = Math.round(rect.height || 0);
        return height > 0 ? height : 0;
      } catch {
        return 0;
      }
    };

    const readRowHeight = (): number => {
      if (runtime.rowHeight > 0) return runtime.rowHeight;
      const measured = measureRenderedRowHeight();
      if (measured > 0) return measured;
      try {
        const raw = getComputedStyle(body).getPropertyValue("--row-min-h").trim();
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      } catch {
        // ignore
      }
      return 56;
    };

    const readBlockOffset = (): number => {
      try {
        const bodyRect = body.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        const offset = blockRect.top - bodyRect.top + body.scrollTop;
        if (Number.isFinite(offset)) return offset;
      } catch {
        // ignore
      }
      return block.offsetTop || 0;
    };

    const update = () => {
      if (!runtime.active) return;
      const rowHeight = readRowHeight();
      const viewportHeight = body.clientHeight || 0;
      const offset = readBlockOffset();
      const virtualScrollTop = Math.max(0, body.scrollTop - offset);
      let start = Math.max(0, Math.floor(virtualScrollTop / rowHeight) - VIRTUAL_CHATLIST_OVERSCAN);
      let end = Math.min(rows.length, Math.ceil((virtualScrollTop + viewportHeight) / rowHeight) + VIRTUAL_CHATLIST_OVERSCAN);
      if (start === runtime.start && end === runtime.end && runtime.rowHeight > 0) return;
      runtime.start = start;
      runtime.end = end;
      items.replaceChildren(...rows.slice(start, end));

      let effectiveHeight = rowHeight;
      const measured = measureRenderedRowHeight();
      if (measured > 0 && Math.abs(measured - rowHeight) > 1) {
        runtime.rowHeight = measured;
        effectiveHeight = measured;
        const nextStart = Math.max(0, Math.floor(virtualScrollTop / measured) - VIRTUAL_CHATLIST_OVERSCAN);
        const nextEnd = Math.min(rows.length, Math.ceil((virtualScrollTop + viewportHeight) / measured) + VIRTUAL_CHATLIST_OVERSCAN);
        if (nextStart !== start || nextEnd !== end) {
          start = nextStart;
          end = nextEnd;
          runtime.start = start;
          runtime.end = end;
          items.replaceChildren(...rows.slice(start, end));
        }
      } else if (measured > 0 && runtime.rowHeight === 0) {
        runtime.rowHeight = measured;
        effectiveHeight = measured;
      }

      topSpacer.style.height = `${start * effectiveHeight}px`;
      bottomSpacer.style.height = `${(rows.length - end) * effectiveHeight}px`;
    };

    const onScroll = () => {
      if (runtime.raf) return;
      try {
        runtime.raf = window.requestAnimationFrame(() => {
          runtime.raf = 0;
          update();
        });
      } catch {
        runtime.raf = 0;
        update();
      }
    };

    const onResize = () => {
      runtime.rowHeight = 0;
      onScroll();
    };

    body.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    try {
      window.requestAnimationFrame(update);
    } catch {
      update();
    }

    (body as any)._virtualChatlistCleanup = () => {
      runtime.active = false;
      body.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (!runtime.raf) return;
      try {
        window.cancelAnimationFrame(runtime.raf);
      } catch {
        // ignore
      }
    };

    return block;
  };

  const buildChatlist = (
    fixedRows: HTMLElement[],
    rows: HTMLElement[],
    emptyLabel?: string,
    opts?: { virtual?: boolean }
  ): HTMLElement => {
    const children: HTMLElement[] = [...fixedRows];
    if (!rows.length) {
      if (emptyLabel) children.push(el("div", { class: "pane-section" }, [emptyLabel]));
      return wrapChatlist(children);
    }
    const allowVirtual = opts?.virtual !== false;
    if (!allowVirtual || rows.length < VIRTUAL_CHATLIST_MIN_ROWS) {
      return wrapChatlist([...children, ...rows]);
    }
    children.push(buildVirtualChatlistBlock(rows));
    return wrapChatlist(children);
  };

  return {
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
  };
}
