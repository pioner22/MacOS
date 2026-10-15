import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { el } from "../../helpers/dom/el";
import { deriveServerSearchQuery } from "../../helpers/search/serverSearchQuery";
import { avatar } from "../sidebar/renderSidebarHelpers";
import type {
  BoardEntry,
  ChatMessage,
  FriendEntry,
  GroupEntry,
  MessageHelperDraft,
  SearchResultEntry,
  TargetRef,
  TopPeerEntry,
  UserProfile,
} from "../../stores/types";

export interface ForwardModalActions {
  onSend: (targets: TargetRef[]) => void;
  onCancel: () => void;
}

export interface ForwardModalOrderMeta {
  pinnedKeys?: string[] | null;
  archivedKeys?: string[] | null;
  conversations?: Record<string, ChatMessage[]> | null;
  topPeers?: TopPeerEntry[] | null;
}

const FORWARD_SEARCH_LOADING_EVENT = "yagodka:forward-search-loading";
const FORWARD_SEARCH_RESULT_EVENT = "yagodka:forward-search-result";
const FORWARD_SEARCH_CLEAR_EVENT = "yagodka:forward-search-clear";

type RowEntry = {
  row: HTMLElement;
  input: HTMLInputElement;
  kind: TargetRef["kind"];
  id: string;
  title: string;
  sub: string | null;
  search: string;
};

function normalizeHandle(handle?: string | null): string {
  const raw = String(handle || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function displayNameForFriend(profiles: Record<string, UserProfile>, f: FriendEntry): string {
  const id = String(f.id || "").trim();
  if (!id) return "—";
  const profile = profiles[id];
  const display = profile?.display_name ? String(profile.display_name).trim() : "";
  const fallback = f.display_name ? String(f.display_name).trim() : "";
  return display || fallback || id;
}

function roomLabel(name: string | null | undefined, id: string): string {
  const base = String(name || "").trim();
  return base ? base : id;
}

function makeRow(kind: TargetRef["kind"], id: string, title: string, sub: string | null): RowEntry {
  const input = el("input", {
    type: "checkbox",
    "data-forward-kind": kind,
    "data-forward-title": title,
    ...(sub ? { "data-forward-sub": sub } : {}),
    value: id,
  }) as HTMLInputElement;
  input.tabIndex = -1;
  input.classList.add("forward-row-input");
  const av = avatar(kind, id);
  av.classList.add("forward-row-avatar");
  const mainChildren: Array<string | HTMLElement> = [el("span", { class: "forward-row-title" }, [title])];
  if (sub) mainChildren.push(el("span", { class: "forward-row-sub" }, [sub]));
  const main = el("span", { class: "forward-row-main" }, mainChildren);
  const check = el("span", { class: "forward-row-check", "aria-hidden": "true" }, ["✓"]);
  const row = el(
    "label",
    {
      class: "forward-row forward-row-target",
      tabindex: "0",
      role: "option",
      "data-forward-focus": "1",
      "data-forward-kind": kind,
      "data-forward-id": id,
      "aria-selected": "false",
    },
    [input, av, main, check]
  );
  const search = [title, sub || "", id].join(" ").toLowerCase();
  return { row, input, kind, id, title, sub, search };
}

function appendSection(
  root: HTMLElement,
  title: string,
  rows: RowEntry[],
  emptyLabel: string
): { section: HTMLElement; rows: RowEntry[] } {
  const section = el("div", { class: "forward-section" });
  const header = el("div", { class: "forward-section-title" }, [title]);
  const body = el("div", { class: "forward-section-body" });
  if (rows.length) {
    rows.forEach((row) => {
      body.append(row.row);
    });
  } else {
    body.append(el("div", { class: "forward-empty" }, [emptyLabel]));
  }
  section.append(header, body);
  root.append(section);
  return { section, rows };
}

function conversationLastTs(conversations: Record<string, ChatMessage[]>, key: string): number {
  const conv = conversations[key] || [];
  const last = conv.length ? conv[conv.length - 1] : null;
  const ts = Number((last as any)?.ts ?? 0);
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

function collectTopPeerTs(topPeers: TopPeerEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of topPeers) {
    const id = String((entry as any)?.id || "").trim();
    const ts = Number((entry as any)?.last_ts ?? 0);
    if (!id || !Number.isFinite(ts) || ts <= 0) continue;
    const prev = out.get(id) ?? 0;
    if (ts > prev) out.set(id, ts);
  }
  return out;
}

export function renderForwardModal(
  drafts: MessageHelperDraft[],
  friends: FriendEntry[],
  groups: GroupEntry[],
  boards: BoardEntry[],
  profiles: Record<string, UserProfile>,
  order: ForwardModalOrderMeta | null | undefined,
  recentTargets: TargetRef[] | null | undefined,
  message: string | undefined,
  actions: ForwardModalActions
): HTMLElement {
  const titleText = draftCountLabel(drafts);
  const box = el("div", {
    class: "modal modal-forward",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": titleText,
    tabindex: "-1",
  });
  const btnSend = el("button", { class: "btn btn-primary", type: "button", disabled: "disabled" }, ["Отправить"]);
  const btnCancel = el("button", { class: "btn btn-secondary", type: "button" }, ["Отмена"]);
  const queryInput = el("input", {
    class: "modal-input",
    type: "search",
    id: "forward-search",
    placeholder: "Поиск контакта, чата или доски",
  }) as HTMLInputElement;
  const selectionLine = el("div", { class: "modal-line forward-count", id: "forward-count" }, ["Выберите получателей"]);
  const safeDrafts = (drafts || []).filter(Boolean);
  const primaryDraft = safeDrafts[0];
  const draftCount = safeDrafts.length;
  const preview = primaryDraft ? String(primaryDraft.preview || primaryDraft.text || "Сообщение").trim() : "Сообщение";
  const previewLabel = draftCount > 1 ? `${draftCount} сообщений` : preview;
  const previewLine = el("div", { class: "modal-line forward-preview" }, [`Переслать: ${previewLabel}`]);
  const commentInput = el("textarea", {
    class: "modal-input forward-comment",
    id: "forward-comment",
    placeholder: "Добавить сообщение…",
    rows: "2",
  }) as HTMLTextAreaElement;
  const showSenderInput = el("input", { type: "checkbox", id: "forward-show-sender", checked: "checked" }) as HTMLInputElement;
  const showCaptionInput = el("input", { type: "checkbox", id: "forward-show-caption", checked: "checked" }) as HTMLInputElement;
  const hasCaption = safeDrafts.some((d) => {
    if (d.attachment?.kind !== "file") return false;
    const text = String(d.text || "").trim();
    return Boolean(text && !text.startsWith("[file]"));
  });
  showCaptionInput.toggleAttribute("disabled", !hasCaption);
  const options = el("div", { class: "forward-options" }, [
    el("label", { class: "forward-option" }, [showSenderInput, el("span", {}, ["Показывать отправителя"])]),
    el("label", { class: "forward-option" }, [showCaptionInput, el("span", {}, ["Показывать подпись"])]),
  ]);
  const warnLine = el("div", { class: "modal-warn" }, [message || ""]);

  const listWrap = el("div", { class: "forward-list", role: "listbox", "aria-label": "Получатели" });
  const chipsWrap = el("div", { class: "forward-chips hidden", id: "forward-chips" });

  const pinnedKeysRaw = Array.isArray(order?.pinnedKeys) ? (order?.pinnedKeys ?? []) : [];
  const archivedKeysRaw = Array.isArray(order?.archivedKeys) ? (order?.archivedKeys ?? []) : [];
  const conversations: Record<string, ChatMessage[]> =
    order?.conversations && typeof order.conversations === "object" ? (order.conversations as any) : {};
  const topPeers = Array.isArray(order?.topPeers) ? (order?.topPeers ?? []) : [];

  const pinnedIndex = new Map<string, number>();
  pinnedKeysRaw.forEach((raw, idx) => {
    const key = String(raw || "").trim();
    if (key) pinnedIndex.set(key, idx);
  });
  const archivedSet = new Set(archivedKeysRaw.map((k) => String(k || "").trim()).filter(Boolean));
  const topPeerTs = collectTopPeerTs(topPeers);

  type TargetItem = {
    kind: TargetRef["kind"];
    id: string;
    title: string;
    sub: string | null;
    sortTs: number;
    pinnedIdx: number | null;
    archived: boolean;
  };

  const items: TargetItem[] = [];

  (friends || []).forEach((f) => {
    const id = String(f?.id || "").trim();
    if (!id) return;
    const title = displayNameForFriend(profiles, f);
    const handle = normalizeHandle(f.handle);
    const sub = handle && handle !== title ? handle : title === id ? null : id;
    const key = dmKey(id);
    const sortTs = Math.max(conversationLastTs(conversations, key), topPeerTs.get(id) ?? 0);
    const pinnedIdx = pinnedIndex.get(key) ?? null;
    const archived = archivedSet.has(key);
    items.push({ kind: "dm", id, title, sub, sortTs, pinnedIdx, archived });
  });

  (groups || []).forEach((g) => {
    const id = String(g?.id || "").trim();
    if (!id) return;
    const title = roomLabel(g?.name, id);
    const handle = normalizeHandle(g?.handle);
    const sub = handle && handle !== title ? handle : title === id ? null : id;
    const key = roomKey(id);
    const sortTs = conversationLastTs(conversations, key);
    const pinnedIdx = pinnedIndex.get(key) ?? null;
    const archived = archivedSet.has(key);
    items.push({ kind: "group", id, title, sub, sortTs, pinnedIdx, archived });
  });

  (boards || []).forEach((b) => {
    const id = String(b?.id || "").trim();
    if (!id) return;
    const title = roomLabel(b?.name, id);
    const handle = normalizeHandle(b?.handle);
    const sub = handle && handle !== title ? handle : title === id ? null : id;
    const key = roomKey(id);
    const sortTs = conversationLastTs(conversations, key);
    const pinnedIdx = pinnedIndex.get(key) ?? null;
    const archived = archivedSet.has(key);
    items.push({ kind: "board", id, title, sub, sortTs, pinnedIdx, archived });
  });

  items.sort((a, b) => {
    if (a.pinnedIdx !== null && b.pinnedIdx !== null) return a.pinnedIdx - b.pinnedIdx;
    if (a.pinnedIdx !== null) return -1;
    if (b.pinnedIdx !== null) return 1;
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.sortTs !== b.sortTs) return b.sortTs - a.sortTs;
    const at = a.title.toLowerCase();
    const bt = b.title.toLowerCase();
    if (at < bt) return -1;
    if (at > bt) return 1;
    return a.id.localeCompare(b.id);
  });

  const rowByKey = new Map<string, RowEntry>();
  const allRows: RowEntry[] = items.map((it) => {
    const row = makeRow(it.kind, it.id, it.title, it.sub);
    const key = `${row.kind}:${row.id}`;
    if (!rowByKey.has(key)) rowByKey.set(key, row);
    return row;
  });
  const inputByKey = new Map<string, HTMLInputElement>();
  for (const row of allRows) inputByKey.set(`${row.kind}:${row.id}`, row.input);

  const recentTargetsSafe = Array.isArray(recentTargets) ? recentTargets : [];
  const recentKeySet = new Set<string>();
  const recentRows = recentTargetsSafe
    .map((t) => {
      const kind = t && (t.kind === "dm" || t.kind === "group" || t.kind === "board") ? t.kind : null;
      const id = t ? String(t.id || "").trim() : "";
      if (!kind || !id) return null;
      const key = `${kind}:${id}`;
      if (recentKeySet.has(key)) return null;
      recentKeySet.add(key);
      const row = rowByKey.get(key) || null;
      if (!row) return null;
      const main = row.row.querySelector(".forward-row-main")?.cloneNode(true) as HTMLElement | null;
      const av = avatar(kind, id);
      av.classList.add("forward-row-avatar");
      const check = el("span", { class: "forward-row-check", "aria-hidden": "true" }, ["✓"]);
      const btn = el("button", {
        class: "forward-row forward-row-recent",
        type: "button",
        "data-forward-focus": "1",
        "data-forward-kind": kind,
        "data-forward-id": id,
      }, [av, ...(main ? [main] : []), check]) as HTMLButtonElement;
      return btn;
    })
    .filter((x): x is HTMLButtonElement => Boolean(x))
    .slice(0, 10);

  const recentSection =
    recentRows.length
      ? (() => {
          const section = el("div", { class: "forward-section forward-section-recent" });
          const header = el("div", { class: "forward-section-title" }, ["Недавние"]);
          const body = el("div", { class: "forward-section-body" });
          recentRows.forEach((row) => body.append(row));
          section.append(header, body);
          listWrap.append(section);
          return section;
        })()
      : null;

  const remoteSection = el("div", { class: "forward-section forward-section-remote hidden", id: "forward-remote-section" });
  const remoteTitle = el("div", { class: "forward-section-title", id: "forward-remote-title" }, ["В сети"]);
  const remoteBody = el("div", { class: "forward-section-body", id: "forward-remote-body" });
  const remoteStatus = el("div", { class: "forward-empty forward-remote-status" }, [""]);
  remoteBody.append(remoteStatus);
  remoteSection.append(remoteTitle, remoteBody);
  listWrap.append(remoteSection);

  const sectionAll = appendSection(listWrap, "Чаты", allRows, "Нет чатов");
  const sections = [sectionAll];

  const noResults = el("div", { class: "forward-empty forward-empty-global hidden" }, ["Ничего не найдено"]);
  listWrap.append(noResults);

  const updateCount = () => {
    const selected = box.querySelectorAll<HTMLInputElement>("input[data-forward-kind]:checked");
    const count = selected.length;
    btnSend.toggleAttribute("disabled", count === 0);
    btnSend.textContent = count ? `Отправить (${count})` : "Отправить";
    selectionLine.textContent = count ? `Выбрано: ${count}` : "Выберите получателей";

    const chipItems = Array.from(selected)
      .map((input) => {
        const kind = String(input.getAttribute("data-forward-kind") || "").trim() as TargetRef["kind"];
        const id = String(input.value || "").trim();
        const key = `${kind}:${id}`;
        const row = rowByKey.get(key);
        const title = String(input.getAttribute("data-forward-title") || "").trim() || row?.title || id || "—";
        return { input, kind, id, title };
      })
      .filter((x) => x.id && (x.kind === "dm" || x.kind === "group" || x.kind === "board"));

    if (!chipItems.length) {
      chipsWrap.classList.add("hidden");
      chipsWrap.replaceChildren();
    } else {
      chipsWrap.classList.remove("hidden");
      chipsWrap.replaceChildren(
        ...chipItems.map(({ input, kind, id, title }) => {
          const av = avatar(kind, id);
          av.classList.add("forward-chip-avatar");
          const btn = el("button", { class: "forward-chip", type: "button", title }, [
            av,
            el("span", { class: "forward-chip-label" }, [title]),
            el("span", { class: "forward-chip-x", "aria-hidden": "true" }, ["×"]),
          ]) as HTMLButtonElement;
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            input.checked = false;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          });
          return btn;
        })
      );
    }

    if (recentSection) {
      for (const row of recentRows) {
        const kind = String(row.getAttribute("data-forward-kind") || "").trim() as TargetRef["kind"];
        const id = String(row.getAttribute("data-forward-id") || "").trim();
        const key = `${kind}:${id}`;
        const input = inputByKey.get(key) || null;
        row.classList.toggle("is-selected", Boolean(input && input.checked));
      }
    }

    for (const row of box.querySelectorAll<HTMLElement>(".forward-row-target")) {
      const input = row.querySelector<HTMLInputElement>("input[data-forward-kind]") || null;
      const checked = Boolean(input && input.checked);
      row.classList.toggle("is-selected", checked);
      row.setAttribute("aria-selected", checked ? "true" : "false");
    }
  };

  const groupIdSet = new Set((groups || []).map((g) => String(g?.id || "").trim()).filter(Boolean));
  const boardIdSet = new Set((boards || []).map((b) => String(b?.id || "").trim()).filter(Boolean));
  const remoteRowByKey = new Map<string, RowEntry>();
  let remoteExpectedQuery = "";
  let remoteApplicable = false;
  const remoteController = new AbortController();

  const setRemoteStatus = (text: string) => {
    remoteStatus.textContent = text;
    remoteStatus.classList.toggle("hidden", !text);
  };

  const hideRemoteRows = () => {
    for (const row of remoteRowByKey.values()) row.row.classList.add("hidden");
  };

  const resetRemote = () => {
    remoteApplicable = false;
    remoteExpectedQuery = "";
    remoteSection.classList.add("hidden");
    remoteSection.classList.remove("is-loading");
    setRemoteStatus("");
    hideRemoteRows();
  };

  const prepareRemoteForQuery = (raw: string) => {
    const q = String(raw || "").trim();
    if (!q) {
      resetRemote();
      return;
    }
    const derived = deriveServerSearchQuery(q);
    if (!derived) {
      resetRemote();
      return;
    }
    remoteApplicable = true;
    remoteSection.classList.remove("hidden");
    if (derived.query !== remoteExpectedQuery) {
      remoteExpectedQuery = derived.query;
      remoteSection.classList.add("is-loading");
      setRemoteStatus("Поиск в сети…");
      hideRemoteRows();
    }
  };

  const normalizeRemoteResults = (raw: any): SearchResultEntry[] => {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .map((r: any) => ({
        id: String(r?.id ?? ""),
        online: r?.online === undefined ? undefined : Boolean(r.online),
        friend: r?.friend === undefined ? undefined : Boolean(r.friend),
        group: r?.group === undefined ? undefined : Boolean(r.group),
        board: r?.board === undefined ? undefined : Boolean(r.board),
      }))
      .filter((r: SearchResultEntry) => Boolean(String(r.id || "").trim()));
  };

  const kindForRemote = (r: SearchResultEntry): TargetRef["kind"] => {
    const id = String(r.id || "").toLowerCase();
    if (r.group || id.startsWith("grp-")) return "group";
    if (r.board || id.startsWith("b-")) return "board";
    return "dm";
  };

  const labelForRemoteDm = (id: string, r: SearchResultEntry): { title: string; sub: string | null } => {
    const pid = String(id || "").trim();
    if (!pid) return { title: "—", sub: null };
    const p = profiles?.[pid];
    const display = p?.display_name ? String(p.display_name).trim() : "";
    const handle = normalizeHandle(p?.handle);
    const title = display || handle || pid;
    let sub: string | null = null;
    if (display && handle && handle !== display) sub = handle;
    else if (title !== pid) sub = pid;
    if (!r.friend) {
      const base = sub || pid;
      sub = `не в контактах · ${base}`;
    }
    return { title, sub };
  };

  const renderRemoteResults = (query: string, results: SearchResultEntry[], timedOut = false) => {
    if (!query || query !== remoteExpectedQuery) return;
    remoteSection.classList.remove("is-loading");

    const visibleKeys = new Set<string>();
    for (const r of results) {
      const id = String(r.id || "").trim();
      if (!id) continue;
      const kind = kindForRemote(r);
      if (kind === "group" && !groupIdSet.has(id)) continue;
      if (kind === "board" && !boardIdSet.has(id)) continue;
      const key = `${kind}:${id}`;
      if (inputByKey.has(key)) continue;
      visibleKeys.add(key);
      if (!remoteRowByKey.has(key)) {
        const label = kind === "dm" ? labelForRemoteDm(id, r) : { title: id, sub: null };
        const row = makeRow(kind, id, label.title, label.sub);
        row.row.classList.add("forward-row-remote");
        remoteRowByKey.set(key, row);
        remoteBody.append(row.row);
        rowByKey.set(key, row);
      }
    }

    let anyVisible = false;
    for (const [key, row] of remoteRowByKey) {
      const visible = visibleKeys.has(key);
      row.row.classList.toggle("hidden", !visible);
      if (visible) anyVisible = true;
    }

    if (anyVisible) {
      setRemoteStatus("");
    } else {
      setRemoteStatus(timedOut ? "Нет ответа от сервера" : "Ничего не найдено");
    }

    updateCount();
  };

  const attachRemoteListeners = () => {
    const onLoading = (e: Event) => {
      if (!box.isConnected) {
        remoteController.abort();
        return;
      }
      const ev = e as CustomEvent<any>;
      const q = String(ev?.detail?.query || "").trim();
      if (!q || q !== remoteExpectedQuery) return;
      remoteSection.classList.remove("hidden");
      remoteSection.classList.add("is-loading");
      setRemoteStatus("Поиск в сети…");
      hideRemoteRows();
    };
    const onClear = () => {
      if (!box.isConnected) {
        remoteController.abort();
        return;
      }
      resetRemote();
      applyFilter(queryInput.value);
      updateCount();
    };
    const onResult = (e: Event) => {
      if (!box.isConnected) {
        remoteController.abort();
        return;
      }
      const ev = e as CustomEvent<any>;
      const q = String(ev?.detail?.query || "").trim();
      const timedOut = Boolean(ev?.detail?.timeout);
      const results = normalizeRemoteResults(ev?.detail?.results);
      renderRemoteResults(q, results, timedOut);
    };
    try {
      window.addEventListener(FORWARD_SEARCH_LOADING_EVENT, onLoading as any, { signal: remoteController.signal });
      window.addEventListener(FORWARD_SEARCH_CLEAR_EVENT, onClear as any, { signal: remoteController.signal });
      window.addEventListener(FORWARD_SEARCH_RESULT_EVENT, onResult as any, { signal: remoteController.signal });
    } catch {
      // ignore
    }
  };
  attachRemoteListeners();

  const applyFilter = (raw: string) => {
    const query = String(raw || "").trim().toLowerCase();
    let anyVisible = false;
    const hideRecents = Boolean(query);
    if (recentSection) recentSection.classList.toggle("hidden", hideRecents);
    sections.forEach((section) => {
      let sectionVisible = false;
      if (!section.rows.length && !query) sectionVisible = true;
      section.rows.forEach((row) => {
        const hiddenByRecents = !query && recentKeySet.size ? recentKeySet.has(`${row.kind}:${row.id}`) : false;
        const visible = (!query || row.search.includes(query)) && !hiddenByRecents;
        row.row.classList.toggle("hidden", !visible);
        if (visible) sectionVisible = true;
      });
      section.section.classList.toggle("hidden", !sectionVisible);
      if (sectionVisible) anyVisible = true;
    });
    noResults.classList.toggle("hidden", anyVisible || !query || remoteApplicable);
  };

  listWrap.addEventListener("change", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || !(target instanceof HTMLInputElement)) return;
    if (!target.hasAttribute("data-forward-kind")) return;
    updateCount();
  });

  queryInput.addEventListener("input", () => {
    prepareRemoteForQuery(queryInput.value);
    applyFilter(queryInput.value);
  });

  if (recentSection) {
    recentSection.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement | null)?.closest("button.forward-row-recent") as HTMLButtonElement | null;
      if (!btn) return;
      e.preventDefault();
      const kind = String(btn.getAttribute("data-forward-kind") || "").trim() as TargetRef["kind"];
      const id = String(btn.getAttribute("data-forward-id") || "").trim();
      const key = `${kind}:${id}`;
      const input = inputByKey.get(key) || null;
      if (!input) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const submit = () => {
    const inputs = Array.from(box.querySelectorAll<HTMLInputElement>("input[data-forward-kind]:checked"));
    const targets: TargetRef[] = inputs
      .map((input) => {
        const kind = String(input.getAttribute("data-forward-kind") || "").trim() as TargetRef["kind"];
        const id = String(input.value || "").trim();
        if (!id || (kind !== "dm" && kind !== "group" && kind !== "board")) return null;
        return { kind, id };
      })
      .filter((item): item is TargetRef => Boolean(item));
    try {
      remoteController.abort();
    } catch {
      // ignore
    }
    actions.onSend(targets);
  };

  btnSend.addEventListener("click", submit);
  btnCancel.addEventListener("click", () => {
    try {
      remoteController.abort();
    } catch {
      // ignore
    }
    actions.onCancel();
  });

  let activeRow: HTMLElement | null = null;
  const setActiveRow = (row: HTMLElement | null) => {
    if (activeRow === row) return;
    if (activeRow) activeRow.classList.remove("is-active");
    activeRow = row;
    if (activeRow) activeRow.classList.add("is-active");
  };
  box.addEventListener("focusin", (e) => {
    const row = (e.target as HTMLElement | null)?.closest?.("[data-forward-focus='1']") as HTMLElement | null;
    if (row) setActiveRow(row);
  });
  const focusRow = (row: HTMLElement) => {
    try {
      (row as any).focus({ preventScroll: true });
    } catch {
      try {
        row.focus();
      } catch {
        // ignore
      }
    }
    setActiveRow(row);
  };
  const visibleRows = (): HTMLElement[] =>
    Array.from(box.querySelectorAll<HTMLElement>("[data-forward-focus='1']")).filter(
      (row) => !row.classList.contains("hidden") && row.offsetParent !== null
    );
  box.addEventListener("keydown", (e) => {
    const active = document.activeElement as HTMLElement | null;
    const isTextArea = active instanceof HTMLTextAreaElement;
    const activeFocusable = (active?.closest?.("[data-forward-focus='1']") as HTMLElement | null) ?? null;

    if (e.key === "Escape") {
      e.preventDefault();
      try {
        remoteController.abort();
      } catch {
        // ignore
      }
      actions.onCancel();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
      return;
    }

    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isTextArea) {
      const rows = visibleRows();
      if (!rows.length) return;
      const cur = activeFocusable || activeRow;
      let idx = cur ? rows.indexOf(cur) : -1;
      if (idx < 0) idx = e.key === "ArrowDown" ? -1 : rows.length;
      const nextIdx = e.key === "ArrowDown" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
      const next = rows[nextIdx];
      if (!next) return;
      e.preventDefault();
      focusRow(next);
      return;
    }

    if ((e.key === "Enter" || e.key === " ") && activeFocusable) {
      const row = activeFocusable;
      e.preventDefault();
      if (row instanceof HTMLButtonElement) {
        row.click();
        return;
      }
      const input = row.querySelector<HTMLInputElement>("input[data-forward-kind]") || null;
      if (!input || input.disabled) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  box.append(
    el("div", { class: "modal-title" }, [titleText]),
    el("div", { class: "modal-body" }, [
      previewLine,
      commentInput,
      options,
      queryInput,
      chipsWrap,
      selectionLine,
      listWrap,
    ]),
    warnLine,
    el("div", { class: "modal-actions modal-actions-compose" }, [btnCancel, btnSend])
  );

  updateCount();
  applyFilter("");
  queueMicrotask(() => {
    try {
      queryInput.focus({ preventScroll: true });
    } catch {
      queryInput.focus();
    }
  });
  (box as any).__disposeForwardModal = () => {
    try {
      remoteController.abort();
    } catch {
      // ignore
    }
  };
  return box;
}

function draftCountLabel(drafts: MessageHelperDraft[]): string {
  return drafts.length > 1 ? "Переслать сообщения" : "Переслать сообщение";
}
