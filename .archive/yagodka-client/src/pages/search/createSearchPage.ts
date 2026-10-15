import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { applyLegacyIdMask } from "../../helpers/id/legacyIdMask";
import { focusElement } from "../../helpers/ui/focus";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { mapKeyboardLayout } from "../../helpers/search/keyboardLayout";
import { deriveServerSearchQuery } from "../../helpers/search/serverSearchQuery";
import { buildPivotSearchQuery, extractSearchQueryFilters, type SearchQueryFilters } from "../../helpers/search/searchQueryFilters";
import { conversationKey } from "../../helpers/chat/conversationKey";
import { fileBadge } from "../../helpers/files/fileBadge";
import { classifyAudioAttachment } from "../../helpers/files/audioAttachmentKind";
import { keepActiveControlVisible } from "../../helpers/ui/keepActiveControlVisible";
import type { AppState, ChatMessage, SearchResultEntry, TargetRef } from "../../stores/types";

export interface SearchPageActions {
  onQueryChange: (query: string) => void;
  onSubmit: (query: string) => void;
  onSelectTarget: (t: TargetRef) => void;
  onOpenHistoryHit: (t: TargetRef, query: string, msgIdx?: number) => void;
  onSearchHistoryDelete: (items: Array<{ target: TargetRef; idx: number }>, mode: "local" | "remote") => void;
  onSearchHistoryForward: (items: Array<{ target: TargetRef; idx: number }>) => void;
  onAuthRequest: (peer: string) => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupJoin: (groupId: string) => void;
  onBoardJoin: (boardId: string) => void;
  onSearchPinToggle: (targets: TargetRef[]) => void;
  onSearchServerForward: (items: SearchResultEntry[]) => void;
}

export interface SearchPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

function inferTarget(entry: SearchResultEntry): TargetRef {
  if (entry.board) return { kind: "board", id: entry.id };
  if (entry.group) return { kind: "group", id: entry.id };
  return { kind: "dm", id: entry.id };
}

function resultLabel(r: SearchResultEntry): string {
  const name = String(r.name || "").trim();
  const handle = String(r.handle || "").trim();
  const roomLabel = name || (handle ? (handle.startsWith("@") ? handle : `@${handle}`) : `# ${r.id}`);
  if (r.board) return roomLabel;
  if (r.group) return roomLabel;
  const dot = r.online ? "●" : "○";
  const star = r.friend ? "★" : " ";
  return `${star} ${dot} ${r.id}`;
}

function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

const SEARCH_NORMALIZE_RE = /[^a-z0-9а-яё_@]+/gi;
const CONTACTS_LIMIT = 60;
const ROOMS_LIMIT = 40;
const HISTORY_SCAN_LIMIT = 400;
const HISTORY_PER_CHAT_LIMIT = 4;
const HISTORY_MAX_RESULTS = 200;
const HISTORY_PAGE_SIZE = 30;
const HISTORY_INLINE_LIMIT = 6;
const HISTORY_VIRTUAL_THRESHOLD = 120;
const HISTORY_VIRTUAL_WINDOW = 80;
const HISTORY_VIRTUAL_OVERSCAN = 24;
const HISTORY_VIRTUAL_AVG_FALLBACK = 64;
const HISTORY_VIRTUAL_AVG_MIN = 40;
const HISTORY_VIRTUAL_AVG_MAX = 120;
const SNIPPET_MAX = 140;
const HISTORY_LINK_RE = /(https?:\/\/|www\.)\S+/i;

type HistoryFilter = "all" | "media" | "files" | "links" | "music" | "voice";
type SearchTab = "chats" | "channels" | "apps" | "media" | "links" | "files" | "music" | "voice";
type SelectionScope = "history" | "server";

const HISTORY_FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "media", label: "Медиа" },
  { id: "files", label: "Файлы" },
  { id: "links", label: "Ссылки" },
  { id: "music", label: "Музыка" },
  { id: "voice", label: "Голос" },
];

const SEARCH_TABS: Array<{ id: SearchTab; label: string }> = [
  { id: "chats", label: "Чаты" },
  { id: "channels", label: "Каналы" },
  { id: "apps", label: "Приложения" },
  { id: "media", label: "Медиа" },
  { id: "links", label: "Ссылки" },
  { id: "files", label: "Файлы" },
  { id: "music", label: "Музыка" },
  { id: "voice", label: "Голос" },
];

function normalizeSearchText(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(SEARCH_NORMALIZE_RE, " ")
    .trim();
}

function tokenizeSearchQuery(raw: string): string[] {
  const normalized = normalizeSearchText(raw);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

function scoreStringMatch(haystack: string, query: string): number {
  if (!query || !haystack) return 0;
  if (haystack === query) return 140;
  if (haystack.startsWith(query)) return 90;
  if (haystack.includes(query)) return 40;
  return 0;
}

function buildHaystack(parts: Array<string | null | undefined>): string {
  const text = parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(" ");
  return normalizeSearchText(text);
}

function matchesTokens(haystack: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  return tokens.every((t) => haystack.includes(t));
}

function truncateText(raw: string, max: number): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatHandle(handle: string): string {
  const h = String(handle || "").trim();
  if (!h) return "";
  return h.startsWith("@") ? h : `@${h}`;
}

function matchesSenderFilter(state: AppState, msg: ChatMessage, rawFilter: string): boolean {
  const needle = normalizeSearchText(rawFilter);
  if (!needle) return true;
  const senderId = String(msg?.from || "").trim();
  if (!senderId) return false;
  const label = resolveContactLabel(state, senderId);
  const haystack = buildHaystack([senderId, label.title, label.handle, formatHandle(label.handle)]);
  if (haystack.includes(needle)) return true;
  const needleDigits = rawFilter.replace(/\D/g, "");
  if (needleDigits) {
    const senderDigits = senderId.replace(/\D/g, "");
    if (senderDigits.includes(needleDigits)) return true;
  }
  return false;
}

function matchesHashtags(text: string, hashtags: string[]): boolean {
  if (!hashtags.length) return true;
  const haystack = String(text || "").toLowerCase();
  return hashtags.every((tag) => haystack.includes(`#${tag}`));
}

function classifyHistoryMessage(msg: ChatMessage) {
  const attachment = msg?.attachment;
  const text = String(msg?.text || "");
  const hasLink = HISTORY_LINK_RE.test(text);
  let hasMedia = false;
  let hasFiles = false;
  let hasMusic = false;
  let hasVoice = false;
  if (attachment?.kind === "file") {
    const badge = fileBadge(attachment.name, attachment.mime);
    if (badge.kind === "image" || badge.kind === "video") {
      hasMedia = true;
    } else if (badge.kind === "audio") {
      const audioKind = classifyAudioAttachment(attachment.name, attachment.mime);
      if (audioKind === "voice") hasVoice = true;
      else hasMusic = true;
    } else {
      hasFiles = true;
    }
  }
  return { media: hasMedia, files: hasFiles, links: hasLink, music: hasMusic, voice: hasVoice };
}

function matchesHistoryFilter(match: { flags: { media: boolean; files: boolean; links: boolean; music: boolean; voice: boolean } }, filter: HistoryFilter): boolean {
  if (filter === "all") return true;
  return Boolean(match.flags?.[filter]);
}

function resolveContactLabel(state: AppState, id: string): { title: string; handle: string; sub: string; online: boolean } {
  const friend = state.friends.find((f) => f.id === id);
  const profile = state.profiles?.[id];
  const displayName = String(friend?.display_name || profile?.display_name || "").trim();
  const handle = formatHandle(String(friend?.handle || profile?.handle || "").trim());
  const title = displayName || handle || id;
  const subParts: string[] = [];
  if (handle && handle !== title) subParts.push(handle);
  if (id && id !== title) subParts.push(`ID: ${id}`);
  const sub = subParts.join(" · ");
  return { title, handle, sub, online: Boolean(friend?.online) };
}

function resolveRoomLabel(state: AppState, kind: "group" | "board", id: string): { title: string; sub: string } {
  const entry = kind === "group" ? state.groups.find((g) => g.id === id) : state.boards.find((b) => b.id === id);
  const name = String(entry?.name || "").trim();
  const handle = formatHandle(String(entry?.handle || "").trim());
  const title = name || id;
  const subParts: string[] = [];
  if (handle && handle !== title) subParts.push(handle);
  if (id && id !== title) subParts.push(`ID: ${id}`);
  const sub = subParts.join(" · ");
  return { title, sub };
}

export function createSearchPage(actions: SearchPageActions): SearchPage {
  const mobileUi = isMobileLikeUi();

  const input = el("input", {
    class: "modal-input search-input",
    type: "search",
    placeholder: "Имя, ID, @логин, текст",
    "aria-label": "Поиск",
    "data-ios-assistant": "off",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "search",
  }) as HTMLInputElement;

  const clearBtn = el("button", { class: "btn search-clear hidden", type: "button", "aria-label": "Очистить поиск" }, [
    el("span", { class: "search-clear-icon", "aria-hidden": "true" }),
  ]);
  const btn = el("button", { class: "btn search-submit", type: "button", "aria-label": "Искать" }, [
    el("span", { class: "search-submit-icon", "aria-hidden": "true" }),
  ]);

  const searchField = el("div", { class: "search-field" }, [
    el("span", { class: "search-field-icon", "aria-hidden": "true" }),
    input,
    clearBtn,
  ]);
  const form = el("div", { class: "page-form search-form", role: "search" }, [searchField, btn]);
  const quickHints = el("div", { class: "search-quick" }, [
    el("span", { class: "search-quick-chip" }, ["Контакты"]),
    el("span", { class: "search-quick-chip" }, ["Сообщения"]),
    el("span", { class: "search-quick-chip" }, ["ID"]),
    el("span", { class: "search-quick-chip" }, ["@логин"]),
  ]);
  const tabsBar = el("div", { class: "search-tabs", role: "tablist" });
  const tabsWrap = el("div", { class: "search-tabs-wrap" }, [tabsBar]);
  const filterBar = el("div", { class: "search-filters hidden", role: "tablist" });
  const dateLabel = el("span", { class: "search-date-label" }, ["Дата"]);
  const dateInput = el("input", {
    class: "modal-input search-date-input",
    type: "date",
    "aria-label": "Фильтр по дате",
  }) as HTMLInputElement;
  const dateClear = el("button", { class: "btn", type: "button" }, ["Сброс"]);
  const dateBar = el("div", { class: "search-date hidden" }, [dateLabel, dateInput, dateClear]);
  const selectionBar = el("div", { class: "search-selection hidden" });
  const results = el("div", { class: "page-results" });
  const hint = mobileUi ? null : el("div", { class: "msg msg-sys page-hint" }, ["Enter — искать | Esc — назад"]);
  const searchShell = el("div", { class: "search-shell" }, [form, quickHints, tabsWrap, filterBar, dateBar, selectionBar]);

  const root = el("div", { class: "page page-search" }, [
    searchShell,
    results,
    ...(hint ? [hint] : []),
  ]);

  type ContactMatch = {
    id: string;
    title: string;
    sub: string;
    online: boolean;
    score: number;
  };

  type RoomMatch = {
    id: string;
    kind: "group" | "board";
    title: string;
    sub: string;
    score: number;
  };

  type HistoryMatch = {
    target: TargetRef;
    idx: number;
    title: string;
    sub: string;
    ts: number;
    flags: { media: boolean; files: boolean; links: boolean; music: boolean; voice: boolean };
  };

  let cachedQuery = "";
  let cachedFriendsRef: AppState["friends"] | null = null;
  let cachedGroupsRef: AppState["groups"] | null = null;
  let cachedBoardsRef: AppState["boards"] | null = null;
  let cachedProfilesRef: AppState["profiles"] | null = null;
  let cachedConversationsRef: AppState["conversations"] | null = null;
  let cachedContacts: ContactMatch[] = [];
  let cachedRooms: RoomMatch[] = [];
  let cachedGroups: RoomMatch[] = [];
  let cachedBoards: RoomMatch[] = [];
  let cachedHistory: HistoryMatch[] = [];
  let cachedTotals = { contacts: 0, rooms: 0, groups: 0, boards: 0, history: 0 };
  let cachedHistoryCounts = { all: 0, media: 0, files: 0, links: 0, music: 0, voice: 0 };
  let activeFilter: HistoryFilter = "all";
  let activeTab: SearchTab = "chats";
  let selectionMode = false;
  let selectionScope: SelectionScope | null = null;
  let selectedHistory = new Map<string, { target: TargetRef; idx: number }>();
  let selectedServer = new Map<string, SearchResultEntry>();
  let activeDate = "";
  let showAllHistory = false;
  let historyVisible = HISTORY_PAGE_SIZE;
  let historyAutoLoadHost: HTMLElement | null = null;
  let historyAutoLoadRaf: number | null = null;
  let historyAutoLoadEnabled = false;
  let historyAutoLoadTotal = 0;
  let historyVirtualAnchor: HTMLElement | null = null;
  let historyVirtualAvg = HISTORY_VIRTUAL_AVG_FALLBACK;
  let historyVirtualStart = 0;
  let historyVirtualTotal = 0;
  let historyVirtualEnabled = false;
  let historyVirtualUpdateRaf: number | null = null;
  let historyVirtualMeasureRaf: number | null = null;
  let historyVirtualLastUpdateAt = 0;
  let cachedDate = "";
  let lastQueryKey = "";
  let lastDateKey = "";
  let lastTabsScrollKey = "";
  let lastFilterScrollKey = "";
  let lastState: AppState | null = null;

  const resetHistoryPaging = () => {
    historyVisible = HISTORY_PAGE_SIZE;
    historyVirtualStart = 0;
    historyVirtualTotal = 0;
    historyVirtualEnabled = false;
  };

  const clampHistoryVirtualAvg = (value?: number | null) => {
    const v = typeof value === "number" && Number.isFinite(value) ? value : HISTORY_VIRTUAL_AVG_FALLBACK;
    return Math.max(HISTORY_VIRTUAL_AVG_MIN, Math.min(HISTORY_VIRTUAL_AVG_MAX, v));
  };

  const getHistoryVirtualMaxStart = (total: number) => {
    if (!Number.isFinite(total) || total <= 0) return 0;
    return Math.max(0, total - HISTORY_VIRTUAL_WINDOW);
  };

  const getHistoryVirtualStart = (total: number, start?: number | null) => {
    const maxStart = getHistoryVirtualMaxStart(total);
    if (typeof start !== "number" || !Number.isFinite(start)) return maxStart;
    return Math.max(0, Math.min(maxStart, Math.floor(start)));
  };

  const getHistoryVirtualEnd = (total: number, start: number) => {
    if (!Number.isFinite(total) || total <= 0) return 0;
    return Math.min(total, Math.max(0, start) + HISTORY_VIRTUAL_WINDOW);
  };

  const updateHistoryScrollHost = () => {
    const nextHost = root.closest(".chat-host") as HTMLElement | null;
    if (nextHost === historyAutoLoadHost) return;
    if (historyAutoLoadHost) historyAutoLoadHost.removeEventListener("scroll", onHistoryScroll);
    historyAutoLoadHost = nextHost;
    if (historyAutoLoadHost) historyAutoLoadHost.addEventListener("scroll", onHistoryScroll, { passive: true });
  };

  const scheduleHistoryAutoLoad = () => {
    if (!historyAutoLoadEnabled || historyAutoLoadRaf !== null) return;
    if (typeof window === "undefined") return;
    historyAutoLoadRaf = window.requestAnimationFrame(() => {
      historyAutoLoadRaf = null;
      if (!historyAutoLoadEnabled || !historyAutoLoadHost) return;
      if (historyVisible >= historyAutoLoadTotal) return;
      const host = historyAutoLoadHost;
      const distance = host.scrollHeight - host.scrollTop - host.clientHeight;
      if (distance > 240) return;
      historyVisible = Math.min(historyVisible + HISTORY_PAGE_SIZE, historyAutoLoadTotal);
      if (lastState) update(lastState);
    });
  };

  const scheduleHistoryVirtualUpdate = () => {
    if (!historyVirtualEnabled || historyVirtualUpdateRaf !== null) return;
    if (typeof window === "undefined") return;
    historyVirtualUpdateRaf = window.requestAnimationFrame(() => {
      historyVirtualUpdateRaf = null;
      if (!historyVirtualEnabled || !historyAutoLoadHost || !historyVirtualAnchor) return;
      if (historyVirtualTotal <= HISTORY_VIRTUAL_THRESHOLD) return;
      const host = historyAutoLoadHost;
      const anchor = historyVirtualAnchor;
      const hostRect = host.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const listTop = anchorRect.top - hostRect.top + host.scrollTop;
      const relativeTop = host.scrollTop - listTop;
      const maxStart = getHistoryVirtualMaxStart(historyVirtualTotal);
      let targetStart = Math.floor(relativeTop / historyVirtualAvg) - HISTORY_VIRTUAL_OVERSCAN;
      targetStart = Math.max(0, Math.min(maxStart, targetStart));
      const currentStart = getHistoryVirtualStart(historyVirtualTotal, historyVirtualStart);
      const delta = Math.abs(targetStart - currentStart);
      if (delta < Math.max(4, Math.floor(HISTORY_VIRTUAL_OVERSCAN / 2))) return;
      const now = Date.now();
      if (now - historyVirtualLastUpdateAt < 80) return;
      historyVirtualLastUpdateAt = now;
      historyVirtualStart = targetStart;
      if (lastState) update(lastState);
    });
  };

  const scheduleHistoryVirtualMeasure = () => {
    if (!historyVirtualEnabled || historyVirtualMeasureRaf !== null) return;
    if (typeof window === "undefined") return;
    historyVirtualMeasureRaf = window.requestAnimationFrame(() => {
      historyVirtualMeasureRaf = null;
      if (!historyVirtualEnabled || !historyVirtualAnchor) return;
      const rows = Array.from(historyVirtualAnchor.querySelectorAll<HTMLElement>(".row-history"));
      if (!rows.length) return;
      let total = 0;
      for (const row of rows) {
        total += row.getBoundingClientRect().height;
      }
      const avg = clampHistoryVirtualAvg(total / rows.length);
      if (Math.abs(avg - historyVirtualAvg) < 1) return;
      historyVirtualAvg = avg;
      if (lastState) update(lastState);
    });
  };

  function onHistoryScroll() {
    scheduleHistoryAutoLoad();
    scheduleHistoryVirtualUpdate();
  }

  const historyKey = (target: TargetRef, idx: number) => `${target.kind}:${target.id}:${idx}`;
  const serverKey = (entry: SearchResultEntry) => `${entry.board ? "board" : entry.group ? "group" : "dm"}:${entry.id}`;

  const parseDateRange = (value: string): { start: number; end: number } | null => {
    if (!value) return null;
    const parts = value.split("-").map((p) => Number(p));
    if (parts.length !== 3 || parts.some((v) => Number.isNaN(v))) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000;
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime() / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  };

  const clearSelection = () => {
    selectionMode = false;
    selectionScope = null;
    selectedHistory.clear();
    selectedServer.clear();
  };

  const startSelection = (scope: SelectionScope) => {
    selectionMode = true;
    selectionScope = scope;
    if (scope === "history") {
      selectedServer.clear();
    } else {
      selectedHistory.clear();
    }
    if (lastState) update(lastState);
  };

  dateClear.addEventListener("click", () => {
    if (!activeDate) return;
    activeDate = "";
    showAllHistory = false;
    resetHistoryPaging();
    dateInput.value = "";
    if (lastState) update(lastState);
  });

  const setActiveFilter = (next: HistoryFilter) => {
    if (activeFilter === next) return;
    activeFilter = next;
    showAllHistory = false;
    resetHistoryPaging();
    if (lastState) update(lastState);
  };

  const setActiveTab = (next: SearchTab) => {
    if (activeTab === next) return;
    activeTab = next;
    showAllHistory = false;
    resetHistoryPaging();
    if (lastState) update(lastState);
  };

  function computeLocalMatches(state: AppState, rawQuery: string, filters: SearchQueryFilters) {
    const qRaw = rawQuery.trim();
    const qText = String(filters.text || "").trim();
    const qAltEn = mapKeyboardLayout(qText, "ruToEn");
    const qAltRu = mapKeyboardLayout(qText, "enToRu");
    const tokens = tokenizeSearchQuery(qText);
    const tokensAltEn = qAltEn !== qText ? tokenizeSearchQuery(qAltEn) : [];
    const tokensAltRu = qAltRu !== qText ? tokenizeSearchQuery(qAltRu) : [];
    const tokenSets = [tokens, tokensAltEn, tokensAltRu].filter((set) => set.length > 0);
    const qNorm = normalizeSearchText(qText);
    const qNormAltEn = qAltEn !== qText ? normalizeSearchText(qAltEn) : "";
    const qNormAltRu = qAltRu !== qText ? normalizeSearchText(qAltRu) : "";
    const qDigits = qText.replace(/\D/g, "");
    if (!qRaw) {
      cachedQuery = qRaw;
      cachedContacts = [];
      cachedRooms = [];
      cachedGroups = [];
      cachedBoards = [];
      cachedHistory = [];
      cachedTotals = { contacts: 0, rooms: 0, groups: 0, boards: 0, history: 0 };
      cachedHistoryCounts = { all: 0, media: 0, files: 0, links: 0, music: 0, voice: 0 };
      return {
        contacts: cachedContacts,
        rooms: cachedRooms,
        groups: cachedGroups,
        boards: cachedBoards,
        history: cachedHistory,
        totals: cachedTotals,
        historyCounts: cachedHistoryCounts,
      };
    }

    const canReuse =
      qRaw === cachedQuery &&
      activeDate === cachedDate &&
      cachedFriendsRef === state.friends &&
      cachedGroupsRef === state.groups &&
      cachedBoardsRef === state.boards &&
      cachedProfilesRef === state.profiles &&
      cachedConversationsRef === state.conversations;
    if (canReuse) {
      return {
        contacts: cachedContacts,
        rooms: cachedRooms,
        groups: cachedGroups,
        boards: cachedBoards,
        history: cachedHistory,
        totals: cachedTotals,
        historyCounts: cachedHistoryCounts,
      };
    }

    const contactMatches: ContactMatch[] = [];
    for (const friend of state.friends) {
      const id = String(friend.id || "").trim();
      if (!id) continue;
      const profile = state.profiles?.[id];
      const displayName = String(friend.display_name || profile?.display_name || "").trim();
      const handleRaw = String(friend.handle || profile?.handle || "").trim();
      const idDigits = id.replace(/\D/g, "");
      const haystack = buildHaystack([displayName, handleRaw, formatHandle(handleRaw), id, idDigits]);
      const tokenHit = tokenSets.some((set) => matchesTokens(haystack, set));
      if (!tokenHit && !(qDigits && idDigits.includes(qDigits))) continue;
      const { title, sub, online } = resolveContactLabel(state, id);
      const bestDisplay = Math.max(
        scoreStringMatch(normalizeSearchText(displayName), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(displayName), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(displayName), qNormAltRu) : 0
      );
      const bestHandle = Math.max(
        scoreStringMatch(normalizeSearchText(handleRaw), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltRu) : 0
      );
      const score =
        bestDisplay +
        bestHandle +
        (qDigits && idDigits.startsWith(qDigits) ? 70 : qDigits && idDigits.includes(qDigits) ? 30 : 0) +
        (tokens.length > 1 ? 10 : 0);
      contactMatches.push({ id, title, sub, online, score });
    }
    contactMatches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const groupMatches: RoomMatch[] = [];
    const boardMatches: RoomMatch[] = [];
    for (const g of state.groups) {
      const id = String(g.id || "").trim();
      if (!id) continue;
      const name = String(g.name || "").trim();
      const handleRaw = String(g.handle || "").trim();
      const idDigits = id.replace(/\D/g, "");
      const haystack = buildHaystack([name, handleRaw, formatHandle(handleRaw), id, idDigits]);
      const tokenHit = tokenSets.some((set) => matchesTokens(haystack, set));
      if (!tokenHit && !(qDigits && idDigits.includes(qDigits))) continue;
      const { title, sub } = resolveRoomLabel(state, "group", id);
      const bestName = Math.max(
        scoreStringMatch(normalizeSearchText(name), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(name), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(name), qNormAltRu) : 0
      );
      const bestHandle = Math.max(
        scoreStringMatch(normalizeSearchText(handleRaw), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltRu) : 0
      );
      const score =
        bestName +
        bestHandle +
        (qDigits && idDigits.startsWith(qDigits) ? 70 : qDigits && idDigits.includes(qDigits) ? 30 : 0) +
        (tokens.length > 1 ? 10 : 0);
      groupMatches.push({ id, kind: "group", title, sub, score });
    }
    for (const b of state.boards) {
      const id = String(b.id || "").trim();
      if (!id) continue;
      const name = String(b.name || "").trim();
      const handleRaw = String(b.handle || "").trim();
      const idDigits = id.replace(/\D/g, "");
      const haystack = buildHaystack([name, handleRaw, formatHandle(handleRaw), id, idDigits]);
      const tokenHit = tokenSets.some((set) => matchesTokens(haystack, set));
      if (!tokenHit && !(qDigits && idDigits.includes(qDigits))) continue;
      const { title, sub } = resolveRoomLabel(state, "board", id);
      const bestName = Math.max(
        scoreStringMatch(normalizeSearchText(name), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(name), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(name), qNormAltRu) : 0
      );
      const bestHandle = Math.max(
        scoreStringMatch(normalizeSearchText(handleRaw), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltRu) : 0
      );
      const score =
        bestName +
        bestHandle +
        (qDigits && idDigits.startsWith(qDigits) ? 70 : qDigits && idDigits.includes(qDigits) ? 30 : 0) +
        (tokens.length > 1 ? 10 : 0);
      boardMatches.push({ id, kind: "board", title, sub, score });
    }
    groupMatches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    boardMatches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    const roomMatches = [...groupMatches, ...boardMatches];
    roomMatches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const historyMatches: HistoryMatch[] = [];
    const historyCounts = { all: 0, media: 0, files: 0, links: 0, music: 0, voice: 0 };
    const hasHistoryQuery = tokenSets.length > 0 || Boolean(filters.from) || filters.hashtags.length > 0;
    if (hasHistoryQuery) {
      const dateRange = parseDateRange(activeDate);
      for (const [key, msgs] of Object.entries(state.conversations || {})) {
        if (!Array.isArray(msgs) || !msgs.length) continue;
        let target: TargetRef | null = null;
        if (key.startsWith("dm:")) {
          target = { kind: "dm", id: key.slice(3) };
        } else if (key.startsWith("room:")) {
          const id = key.slice(5);
          if (state.boards.some((b) => b.id === id)) target = { kind: "board", id };
          else target = { kind: "group", id };
        }
        if (!target) continue;
        const title =
          target.kind === "dm"
            ? resolveContactLabel(state, target.id).title
            : resolveRoomLabel(state, target.kind, target.id).title;
        let picked = 0;
        const start = Math.max(0, msgs.length - HISTORY_SCAN_LIMIT);
        for (let idx = msgs.length - 1; idx >= start; idx -= 1) {
          const msg = msgs[idx];
          const ts = Number(msg?.ts || 0);
          if (dateRange && (ts < dateRange.start || ts >= dateRange.end)) continue;
          const text = String(msg?.text || "");
          const attachmentName = msg?.attachment?.kind === "file" ? String(msg.attachment.name || "") : "";
          const haystack = buildHaystack([text, attachmentName]);
          const textHit = tokenSets.length ? tokenSets.some((set) => matchesTokens(haystack, set)) : true;
          if (!textHit) continue;
          if (filters.from && !matchesSenderFilter(state, msg, filters.from)) continue;
          if (filters.hashtags.length && !matchesHashtags(text, filters.hashtags)) continue;
          const fromLabel = msg?.from ? resolveContactLabel(state, String(msg.from)).title : "";
          const snippet = truncateText(text || attachmentName, SNIPPET_MAX);
          const subParts: string[] = [];
          if (fromLabel && target.kind !== "dm") subParts.push(`От: ${fromLabel}`);
          if (snippet) subParts.push(snippet);
          const sub = subParts.join(" · ");
          const flags = classifyHistoryMessage(msg);
          historyMatches.push({ target, idx, title, sub, ts, flags });
          historyCounts.all += 1;
          if (flags.media) historyCounts.media += 1;
          if (flags.files) historyCounts.files += 1;
          if (flags.links) historyCounts.links += 1;
          if (flags.music) historyCounts.music += 1;
          if (flags.voice) historyCounts.voice += 1;
          picked += 1;
          if (picked >= HISTORY_PER_CHAT_LIMIT) break;
        }
      }
      historyMatches.sort((a, b) => b.ts - a.ts);
    }

    cachedQuery = qRaw;
    cachedDate = activeDate;
    cachedFriendsRef = state.friends;
    cachedGroupsRef = state.groups;
    cachedBoardsRef = state.boards;
    cachedProfilesRef = state.profiles;
    cachedConversationsRef = state.conversations;
    cachedTotals = {
      contacts: contactMatches.length,
      rooms: roomMatches.length,
      groups: groupMatches.length,
      boards: boardMatches.length,
      history: historyMatches.length,
    };
    cachedContacts = contactMatches.slice(0, CONTACTS_LIMIT);
    cachedRooms = roomMatches.slice(0, ROOMS_LIMIT);
    cachedGroups = groupMatches.slice(0, ROOMS_LIMIT);
    cachedBoards = boardMatches.slice(0, ROOMS_LIMIT);
    cachedHistory = historyMatches.slice(0, HISTORY_MAX_RESULTS);
    cachedHistoryCounts = historyCounts;
    return {
      contacts: cachedContacts,
      rooms: cachedRooms,
      groups: cachedGroups,
      boards: cachedBoards,
      history: cachedHistory,
      totals: cachedTotals,
      historyCounts: cachedHistoryCounts,
    };
  }

  function submit() {
    const q = input.value.trim();
    actions.onSubmit(q);
  }

  btn.addEventListener("click", () => submit());
  clearBtn.addEventListener("click", () => {
    if (!input.value && !activeDate) return;
    input.value = "";
    activeDate = "";
    dateInput.value = "";
    clearSelection();
    showAllHistory = false;
    resetHistoryPaging();
    actions.onQueryChange("");
    if (lastState) update({ ...lastState, searchQuery: "" });
    focusElement(input);
  });

  input.addEventListener("input", () => {
    applyLegacyIdMask(input);
    actions.onQueryChange(input.value);
  });
  dateInput.addEventListener("input", () => {
    activeDate = String(dateInput.value || "");
    if (lastState) update(lastState);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });

  function update(state: AppState) {
    lastState = state;
    updateHistoryScrollHost();
    if (document.activeElement !== input && input.value !== state.searchQuery) {
      input.value = state.searchQuery;
    }

    const qRaw = String(state.searchQuery || "");
    const q = qRaw.trim();
    const filters = extractSearchQueryFilters(qRaw);
    const openQuery = buildPivotSearchQuery(filters);
    const canSearchNow = Boolean(deriveServerSearchQuery(qRaw));
    root.classList.toggle("search-has-query", Boolean(q));
    quickHints.classList.toggle("hidden", Boolean(q));
    clearBtn.classList.toggle("hidden", !qRaw);

    if (qRaw !== lastQueryKey) {
      clearSelection();
      showAllHistory = false;
      resetHistoryPaging();
      lastQueryKey = qRaw;
    }
    if (activeDate !== lastDateKey) {
      clearSelection();
      showAllHistory = false;
      resetHistoryPaging();
      lastDateKey = activeDate;
    }

    if (!q) {
      activeFilter = "all";
      activeTab = "chats";
      showAllHistory = false;
      resetHistoryPaging();
      tabsWrap.classList.add("hidden");
      tabsBar.replaceChildren();
      filterBar.classList.add("hidden");
      dateBar.classList.add("hidden");
      dateBar.replaceChildren(dateLabel, dateInput, dateClear);
      selectionBar.classList.add("hidden");
      selectionBar.replaceChildren();
      clearSelection();
      results.replaceChildren(
        el("div", { class: "page-empty search-empty" }, [
          el("div", { class: "search-empty-icon", "aria-hidden": "true" }),
          el("div", { class: "page-empty-title" }, ["Начните поиск"]),
          el("div", { class: "page-empty-sub" }, ["Имя, ID, @логин, текст сообщения"]),
        ])
      );
      return;
    }

    const local = computeLocalMatches(state, qRaw, filters);
    const list = state.searchResults || [];
    const serverDm = list.filter((r) => !r.group && !r.board);
    const serverGroups = list.filter((r) => r.group);
    const serverBoards = list.filter((r) => r.board);
    const historyTabIds: SearchTab[] = ["media", "links", "files", "music", "voice"];
    const tabCounts: Record<SearchTab, number> = {
      chats: local.totals.contacts + local.totals.groups + local.totals.history + serverDm.length + serverGroups.length,
      channels: local.totals.boards + serverBoards.length,
      apps: 0,
      media: local.historyCounts.media,
      links: local.historyCounts.links,
      files: local.historyCounts.files,
      music: local.historyCounts.music,
      voice: local.historyCounts.voice,
    };
    const visibleTabs = SEARCH_TABS.filter((tab) => tab.id === "chats" || tabCounts[tab.id] > 0);
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      activeTab = visibleTabs[0]?.id ?? "chats";
      showAllHistory = false;
      resetHistoryPaging();
    }

    tabsWrap.classList.remove("hidden");
    tabsWrap.classList.toggle("is-single", visibleTabs.length <= 1);
    tabsBar.replaceChildren(
      ...visibleTabs.map((tab) => {
        const active = tab.id === activeTab;
        const count = tabCounts[tab.id];
        const btn = el(
          "button",
          {
            class: `search-tab${active ? " is-active" : ""}`,
            type: "button",
            role: "tab",
            "aria-selected": active ? "true" : "false",
          },
          [tab.label, el("span", { class: "search-tab-count" }, [String(count)])]
        );
        btn.addEventListener("click", () => setActiveTab(tab.id));
        return btn;
      })
    );
    const nextTabsScrollKey = `${activeTab}|${visibleTabs.map((tab) => tab.id).join(",")}`;
    if (nextTabsScrollKey !== lastTabsScrollKey) {
      lastTabsScrollKey = nextTabsScrollKey;
      keepActiveControlVisible(tabsBar, ".search-tab.is-active");
    }

    const showChatsTab = activeTab === "chats";
    const showChannelsTab = activeTab === "channels";
    const showAppsTab = activeTab === "apps";
    const isHistoryTab = historyTabIds.includes(activeTab);
    const showHistory = showChatsTab || isHistoryTab;
    if (showChatsTab && activeFilter !== "all" && local.historyCounts[activeFilter] === 0) {
      activeFilter = "all";
      showAllHistory = false;
      resetHistoryPaging();
    }
    const effectiveHistoryFilter: HistoryFilter = isHistoryTab ? (activeTab as HistoryFilter) : activeFilter;
    const serverList = showChannelsTab ? serverBoards : showChatsTab ? list.filter((r) => !r.board) : [];
    const serverSelectable = serverList.length > 0;
    const resolveServerState = (entry: SearchResultEntry) => {
      const kind: "dm" | "group" | "board" = entry.board ? "board" : entry.group ? "group" : "dm";
      const isFriend = entry.friend ?? state.friends.some((f) => f.id === entry.id);
      const pendingIn = state.pendingIn.includes(entry.id);
      const pendingOut = state.pendingOut.includes(entry.id);
      const inGroup = kind === "group" && state.groups.some((g) => g.id === entry.id);
      const inBoard = kind === "board" && state.boards.some((b) => b.id === entry.id);
      const canOpen = kind === "dm" ? isFriend : kind === "group" ? inGroup : inBoard;
      return { kind, isFriend, pendingIn, pendingOut, inGroup, inBoard, canOpen };
    };
    const blocks: HTMLElement[] = [];

    const makeGroup = (label: string, className = "") => {
      const group = el("div", { class: `search-group${className ? ` ${className}` : ""}` });
      group.append(el("div", { class: "pane-section search-group__name" }, [label]));
      return group;
    };

    const showFilterBar = showChatsTab && local.historyCounts.all > 0;
    if (showFilterBar) {
      filterBar.classList.remove("hidden");
      filterBar.replaceChildren(
        ...HISTORY_FILTERS.map((item) => {
          const count = item.id === "all" ? local.historyCounts.all : local.historyCounts[item.id];
          const active = item.id === activeFilter;
          const disabled = item.id !== "all" && count === 0;
          const btn = el(
            "button",
            {
              class: `search-filter${active ? " is-active" : ""}`,
              type: "button",
              role: "tab",
              "aria-selected": active ? "true" : "false",
              ...(disabled ? { disabled: "true" } : {}),
            },
            [item.label, el("span", { class: "search-filter-count" }, [String(count)])]
          );
          if (!disabled) btn.addEventListener("click", () => setActiveFilter(item.id));
          return btn;
        })
      );
      const nextFilterScrollKey = `shown|${activeFilter}`;
      if (nextFilterScrollKey !== lastFilterScrollKey) {
        lastFilterScrollKey = nextFilterScrollKey;
        keepActiveControlVisible(filterBar, ".search-filter.is-active");
      }
    } else {
      filterBar.classList.add("hidden");
      filterBar.replaceChildren();
      lastFilterScrollKey = "hidden";
    }
    const showDateBar = showHistory && (local.historyCounts.all > 0 || Boolean(activeDate));
    if (showDateBar) {
      dateBar.classList.remove("hidden");
      dateInput.value = activeDate;
    } else {
      dateBar.classList.add("hidden");
      dateInput.value = "";
    }

    const historySelectable = showHistory && local.history.length > 0;
    if (selectionMode) {
      if (selectionScope === "history" && !historySelectable) clearSelection();
      if (selectionScope === "server" && !serverSelectable) clearSelection();
    }
    if (selectionScope === "server" && selectedServer.size) {
      const visibleKeys = new Set(serverList.map(serverKey));
      for (const key of selectedServer.keys()) {
        if (!visibleKeys.has(key)) selectedServer.delete(key);
      }
    }
    if (!historySelectable && !serverSelectable) {
      selectionBar.classList.add("hidden");
      selectionBar.replaceChildren();
      clearSelection();
    } else {
      selectionBar.classList.remove("hidden");
      selectionBar.replaceChildren();
      if (!selectionMode) {
        const makeSelectButton = (label: string, scope: SelectionScope) => {
          const btn = el("button", { class: "btn", type: "button" }, [label]);
          btn.addEventListener("click", () => startSelection(scope));
          return btn;
        };
        if (historySelectable && serverSelectable) {
          selectionBar.append(makeSelectButton("Выбрать историю", "history"), makeSelectButton("Выбрать сервер", "server"));
        } else if (historySelectable) {
          selectionBar.append(makeSelectButton("Выбрать", "history"));
        } else if (serverSelectable) {
          selectionBar.append(makeSelectButton("Выбрать", "server"));
        }
      } else {
        const cancelBtn = el("button", { class: "btn", type: "button" }, ["Отмена"]);
        cancelBtn.addEventListener("click", () => {
          clearSelection();
          if (lastState) update(lastState);
        });
        const actionsWrap = el("div", { class: "search-selection-actions" });
        if (selectionScope === "history") {
          const countEl = el("span", { class: "search-selection-count" }, [`Выбрано: ${selectedHistory.size}`]);
          if (selectedHistory.size === 1) {
            const only = Array.from(selectedHistory.values())[0];
            const gotoBtn = el("button", { class: "btn", type: "button" }, ["Перейти"]);
            gotoBtn.addEventListener("click", () => {
              actions.onOpenHistoryHit(only.target, openQuery, only.idx);
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(gotoBtn);
          }
          const forwardBtn = el("button", { class: "btn", type: "button" }, ["Переслать"]);
          forwardBtn.addEventListener("click", () => {
            actions.onSearchHistoryForward(Array.from(selectedHistory.values()));
            clearSelection();
            if (lastState) update(lastState);
          });
          const delLocalBtn = el("button", { class: "btn", type: "button" }, ["Удалить у меня"]);
          delLocalBtn.addEventListener("click", () => {
            actions.onSearchHistoryDelete(Array.from(selectedHistory.values()), "local");
            clearSelection();
            if (lastState) update(lastState);
          });
          const delRemoteBtn = el("button", { class: "btn", type: "button" }, ["Удалить у всех"]);
          delRemoteBtn.addEventListener("click", () => {
            actions.onSearchHistoryDelete(Array.from(selectedHistory.values()), "remote");
            clearSelection();
            if (lastState) update(lastState);
          });
          actionsWrap.append(forwardBtn, delLocalBtn, delRemoteBtn);
          selectionBar.append(cancelBtn, countEl, actionsWrap);
        } else if (selectionScope === "server") {
          const selectedItems = Array.from(selectedServer.values());
          const countEl = el("span", { class: "search-selection-count" }, [`Выбрано: ${selectedItems.length}`]);
          const uniq = (ids: string[]) => Array.from(new Set(ids));
          const labelWithCount = (label: string, count: number) => (count > 1 ? `${label} (${count})` : label);
          const selectedStates = selectedItems.map((entry) => ({ entry, ...resolveServerState(entry) }));
          const pinTargets = state.selfId
            ? Array.from(
                new Map(
                  selectedStates
                    .filter((s) => s.canOpen)
                    .map((s) => inferTarget(s.entry))
                    .map((t) => [`${t.kind}:${t.id}`, t] as const)
                ).values()
              )
            : [];
          const pinKeys = pinTargets.map(conversationKey);
          const pinnedSet = new Set(state.pinned || []);
          const allPinned = Boolean(pinKeys.length) && pinKeys.every((k) => pinnedSet.has(k));
          if (selectedStates.length === 1 && selectedStates[0].canOpen) {
            const only = selectedStates[0].entry;
            const gotoBtn = el("button", { class: "btn", type: "button" }, ["Перейти"]);
            gotoBtn.addEventListener("click", () => {
              actions.onSelectTarget(inferTarget(only));
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(gotoBtn);
          }
          if (pinTargets.length) {
            const pinBtn = el(
              "button",
              { class: "btn", type: "button" },
              [labelWithCount(allPinned ? "Открепить" : "Закрепить", pinTargets.length)]
            );
            pinBtn.addEventListener("click", () => {
              actions.onSearchPinToggle(pinTargets);
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(pinBtn);
          }
          const reqContacts = uniq(
            selectedStates
              .filter((s) => s.kind === "dm" && !s.isFriend && !s.pendingIn && !s.pendingOut)
              .map((s) => s.entry.id)
          );
          if (reqContacts.length) {
            const reqBtn = el("button", { class: "btn", type: "button" }, [labelWithCount("Запросить контакт", reqContacts.length)]);
            reqBtn.addEventListener("click", () => {
              reqContacts.forEach((id) => actions.onAuthRequest(id));
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(reqBtn);
          }
          const acceptIds = uniq(selectedStates.filter((s) => s.kind === "dm" && s.pendingIn).map((s) => s.entry.id));
          const declineIds = acceptIds;
          if (acceptIds.length) {
            const acceptBtn = el("button", { class: "btn", type: "button" }, [labelWithCount("Принять", acceptIds.length)]);
            acceptBtn.addEventListener("click", () => {
              acceptIds.forEach((id) => actions.onAuthAccept(id));
              clearSelection();
              if (lastState) update(lastState);
            });
            const declineBtn = el("button", { class: "btn", type: "button" }, [labelWithCount("Отклонить", declineIds.length)]);
            declineBtn.addEventListener("click", () => {
              declineIds.forEach((id) => actions.onAuthDecline(id));
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(acceptBtn, declineBtn);
          }
          const cancelIds = uniq(selectedStates.filter((s) => s.kind === "dm" && s.pendingOut).map((s) => s.entry.id));
          if (cancelIds.length) {
            const cancelBtn = el("button", { class: "btn", type: "button" }, [labelWithCount("Отменить запрос", cancelIds.length)]);
            cancelBtn.addEventListener("click", () => {
              cancelIds.forEach((id) => actions.onAuthCancel(id));
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(cancelBtn);
          }
          const joinGroups = uniq(selectedStates.filter((s) => s.kind === "group" && !s.inGroup).map((s) => s.entry.id));
          if (joinGroups.length) {
            const joinBtn = el("button", { class: "btn", type: "button" }, [labelWithCount("Запросить вступление", joinGroups.length)]);
            joinBtn.addEventListener("click", () => {
              joinGroups.forEach((id) => actions.onGroupJoin(id));
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(joinBtn);
          }
          const joinBoards = uniq(selectedStates.filter((s) => s.kind === "board" && !s.inBoard).map((s) => s.entry.id));
          if (joinBoards.length) {
            const joinBtn = el("button", { class: "btn", type: "button" }, [labelWithCount("Вступить", joinBoards.length)]);
            joinBtn.addEventListener("click", () => {
              joinBoards.forEach((id) => actions.onBoardJoin(id));
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(joinBtn);
          }
          if (selectedItems.length) {
            const forwardBtn = el("button", { class: "btn", type: "button" }, ["Переслать ID"]);
            forwardBtn.addEventListener("click", () => {
              actions.onSearchServerForward(selectedItems);
              clearSelection();
              if (lastState) update(lastState);
            });
            actionsWrap.append(forwardBtn);
          }
          selectionBar.append(cancelBtn, countEl, actionsWrap);
        }
      }
    }

    if (showChatsTab && local.contacts.length) {
      const group = makeGroup(`Контакты (${local.totals.contacts})`, "search-group-contacts");
      for (const item of local.contacts) {
        const dot = item.online ? "●" : "○";
        const rowMain = el("span", { class: "row-main" }, [
          el("span", { class: "row-title" }, [item.title]),
          ...(item.sub ? [el("span", { class: "row-sub" }, [item.sub])] : []),
        ]);
        const row = el("button", { class: "row", type: "button" }, [
          avatar("dm", item.id),
          rowMain,
          el("span", { class: "row-tail" }, [el("span", { class: `row-dot ${item.online ? "row-dot-online" : "row-dot-offline"}` }, [dot])]),
        ]);
        row.addEventListener("click", () => actions.onSelectTarget({ kind: "dm", id: item.id }));
        group.append(el("div", { class: "result-item" }, [row]));
      }
      if (local.totals.contacts > local.contacts.length) {
        group.append(el("div", { class: "result-meta" }, [`Показаны первые ${local.contacts.length} контактов`]));
      }
      blocks.push(group);
    }

    if (showChatsTab && local.groups.length) {
      const group = makeGroup(`Группы (${local.totals.groups})`, "search-group-contacts");
      for (const item of local.groups) {
        const rowMain = el("span", { class: "row-main" }, [
          el("span", { class: "row-title" }, [item.title]),
          ...(item.sub ? [el("span", { class: "row-sub" }, [item.sub])] : []),
        ]);
        const row = el("button", { class: "row", type: "button" }, [avatar(item.kind, item.id), rowMain]);
        row.addEventListener("click", () => actions.onSelectTarget({ kind: item.kind, id: item.id }));
        group.append(el("div", { class: "result-item" }, [row]));
      }
      if (local.totals.groups > local.groups.length) {
        group.append(el("div", { class: "result-meta" }, [`Показаны первые ${local.groups.length} групп`]));
      }
      blocks.push(group);
    }

    if (showChannelsTab && local.boards.length) {
      const group = makeGroup(`Доски (${local.totals.boards})`, "search-group-contacts");
      for (const item of local.boards) {
        const rowMain = el("span", { class: "row-main" }, [
          el("span", { class: "row-title" }, [item.title]),
          ...(item.sub ? [el("span", { class: "row-sub" }, [item.sub])] : []),
        ]);
        const row = el("button", { class: "row", type: "button" }, [avatar(item.kind, item.id), rowMain]);
        row.addEventListener("click", () => actions.onSelectTarget({ kind: item.kind, id: item.id }));
        group.append(el("div", { class: "result-item" }, [row]));
      }
      if (local.totals.boards > local.boards.length) {
        group.append(el("div", { class: "result-meta" }, [`Показаны первые ${local.boards.length} досок`]));
      }
      blocks.push(group);
    }

    if (showHistory && local.history.length) {
      const historyGroup = makeGroup(`История чатов (${local.totals.history})`, "search-group-messages search-group-recent");
      const historyItems = local.history.filter((item) => matchesHistoryFilter(item, effectiveHistoryFilter));
      const inlineHistory = showChatsTab && !showAllHistory;
      const showAllButton = inlineHistory && historyItems.length > HISTORY_INLINE_LIMIT;
      if (!inlineHistory && historyVisible > historyItems.length) {
        historyVisible = historyItems.length;
      }
      if (!historyItems.length) {
        historyVirtualAnchor = null;
        historyVirtualTotal = 0;
        historyVirtualEnabled = false;
        historyAutoLoadTotal = 0;
        historyAutoLoadEnabled = false;
        historyGroup.append(el("div", { class: "result-meta" }, ["По выбранному фильтру совпадений нет"]));
      } else {
        const historyTotal = inlineHistory ? Math.min(historyItems.length, HISTORY_INLINE_LIMIT) : Math.min(historyItems.length, historyVisible);
        historyAutoLoadTotal = historyItems.length;
        historyAutoLoadEnabled = !inlineHistory && historyItems.length > historyVisible;
        historyVirtualTotal = historyTotal;
        historyVirtualEnabled = !inlineHistory && historyTotal > HISTORY_VIRTUAL_THRESHOLD;
        if (!historyVirtualEnabled) {
          historyVirtualStart = 0;
        }
        const maxVirtualStart = historyVirtualEnabled ? getHistoryVirtualMaxStart(historyVirtualTotal) : 0;
        const safeVirtualStart = historyVirtualEnabled ? Math.max(0, Math.min(maxVirtualStart, Math.floor(historyVirtualStart))) : 0;
        if (historyVirtualEnabled && safeVirtualStart !== historyVirtualStart) {
          historyVirtualStart = safeVirtualStart;
        }
        const virtualEnd = historyVirtualEnabled ? getHistoryVirtualEnd(historyVirtualTotal, safeVirtualStart) : historyTotal;
        const topSpacerHeight = historyVirtualEnabled ? Math.max(0, safeVirtualStart) * historyVirtualAvg : 0;
        const bottomSpacerHeight = historyVirtualEnabled ? Math.max(0, historyVirtualTotal - virtualEnd) * historyVirtualAvg : 0;
        const visibleHistory = inlineHistory
          ? historyItems.slice(0, HISTORY_INLINE_LIMIT)
          : historyVirtualEnabled
            ? historyItems.slice(safeVirtualStart, virtualEnd)
            : historyItems.slice(0, historyTotal);
        const historyWrap = el("div", { class: "search-history-list" });
        historyVirtualAnchor = historyWrap;
        const makeSpacer = (height: number, pos: "top" | "bottom") => {
          const spacer = el("div", { class: "search-virtual-spacer", "data-virtual-spacer": pos, "aria-hidden": "true" });
          spacer.style.height = `${height}px`;
          return spacer;
        };
        if (historyVirtualEnabled && topSpacerHeight > 0) {
          historyWrap.append(makeSpacer(topSpacerHeight, "top"));
        }
        for (const item of visibleHistory) {
          const key = historyKey(item.target, item.idx);
          const isSelected = selectionMode && selectedHistory.has(key);
          const rowMain = el("span", { class: "row-main" }, [
            el("span", { class: "row-title" }, [item.title]),
            ...(item.sub ? [el("span", { class: "row-sub" }, [item.sub])] : []),
          ]);
          const row = el("button", { class: `row row-history${isSelected ? " row-sel" : ""}`, type: "button" }, [
            avatar(item.target.kind, item.target.id),
            rowMain,
          ]);
          row.addEventListener("click", (e) => {
            if (!selectionMode) {
              actions.onOpenHistoryHit(item.target, openQuery, item.idx);
              return;
            }
            e.preventDefault();
            if (selectedHistory.has(key)) {
              selectedHistory.delete(key);
            } else {
              selectedHistory.set(key, { target: item.target, idx: item.idx });
            }
            if (lastState) update(lastState);
          });
          historyWrap.append(el("div", { class: "result-item" }, [row]));
        }
        if (historyVirtualEnabled && bottomSpacerHeight > 0) {
          historyWrap.append(makeSpacer(bottomSpacerHeight, "bottom"));
        }
        historyGroup.append(historyWrap);
        if (showAllButton) {
          const showAll = el("button", { class: "btn search-group__show-more", type: "button" }, ["Показать все"]);
          showAll.addEventListener("click", () => {
            showAllHistory = true;
            resetHistoryPaging();
            if (lastState) update(lastState);
          });
          historyGroup.append(el("div", { class: "result-meta" }, [showAll]));
        }
        if (!inlineHistory && historyVisible < historyItems.length) {
          const showMore = el("button", { class: "btn search-group__show-more", type: "button" }, ["Показать еще"]);
          showMore.addEventListener("click", () => {
            historyVisible = Math.min(historyVisible + HISTORY_PAGE_SIZE, historyItems.length);
            if (lastState) update(lastState);
          });
          historyGroup.append(el("div", { class: "result-meta" }, [showMore]));
        }
        const totalForFilter = effectiveHistoryFilter === "all" ? local.historyCounts.all : local.historyCounts[effectiveHistoryFilter];
        if (totalForFilter > historyItems.length) {
          historyGroup.append(el("div", { class: "result-meta" }, [`Показаны первые ${historyItems.length} совпадений`]));
        }
        if (historyAutoLoadEnabled) scheduleHistoryAutoLoad();
      }
      historyGroup.append(el("div", { class: "result-meta" }, ["Поиск по загруженной истории сообщений"]));
      blocks.push(historyGroup);
    } else {
      historyAutoLoadTotal = 0;
      historyAutoLoadEnabled = false;
      historyVirtualAnchor = null;
      historyVirtualTotal = 0;
      historyVirtualEnabled = false;
    }

    if (serverList.length) {
      const serverGroup = makeGroup("Поиск по ID/@логину", "search-group-contacts search-group-people");
      serverGroup.append(
        ...serverList.map((r) => {
          const info = resolveServerState(r);
          const isGroup = info.kind === "group";
          const isBoard = info.kind === "board";
          const isFriend = info.isFriend;
          const pendingIn = info.pendingIn;
          const pendingOut = info.pendingOut;
          const inGroup = info.inGroup;
          const inBoard = info.inBoard;
          const canOpen = info.canOpen;
          const key = serverKey(r);
          const isSelected = selectionMode && selectionScope === "server" && selectedServer.has(key);
          const disableRow = !canOpen && !(selectionMode && selectionScope === "server");
          const displayName = String(r.name || "").trim();
          const displayHandleRaw = String(r.handle || "").trim();
          const displayHandle = displayHandleRaw ? (displayHandleRaw.startsWith("@") ? displayHandleRaw : `@${displayHandleRaw}`) : "";

          const typeLabel = isGroup ? "Группа" : isBoard ? "Доска" : isFriend ? "Контакт" : "Пользователь";
          const stateLabel = pendingIn
            ? "Входящий запрос"
            : pendingOut
              ? "Ожидает подтверждения"
              : isGroup && !inGroup
              ? "Доступ по запросу"
                : isBoard && !inBoard
                  ? "Открытая доска"
                  : typeLabel;
          const rowTitle = isGroup || isBoard ? displayName || displayHandle || `# ${r.id}` : r.id;
          const rowSub = isGroup || isBoard ? [displayHandle, r.id, stateLabel].filter(Boolean).join(" · ") : stateLabel;
          const rowChildren: Array<string | HTMLElement> = [
            avatar(info.kind, r.id),
            el("span", { class: "row-main" }, [
              el("span", { class: "row-title" }, [rowTitle]),
              el("span", { class: "row-sub" }, [rowSub]),
            ]),
            isGroup || isBoard
              ? el("span", { class: "search-result-badge" }, [typeLabel])
              : el("span", { class: "search-result-status", "aria-label": r.online ? "Онлайн" : "Офлайн" }, [
                  el("span", { class: `row-dot ${r.online ? "row-dot-online" : "row-dot-offline"}`, "aria-hidden": "true" }, ["●"]),
                ]),
          ];

          const rowBtn = el(
            "button",
            {
              class: `row${isSelected ? " row-sel" : ""}`,
              type: "button",
              ...(disableRow ? { disabled: "true" } : {}),
              ...(isSelected ? { "aria-pressed": "true" } : {}),
            },
            rowChildren
          );
          rowBtn.addEventListener("click", (e) => {
            if (selectionMode && selectionScope === "server") {
              e.preventDefault();
              if (selectedServer.has(key)) {
                selectedServer.delete(key);
              } else {
                selectedServer.set(key, r);
              }
              if (lastState) update(lastState);
              return;
            }
            if (canOpen) actions.onSelectTarget(inferTarget(r));
          });

          const actionButtons: HTMLElement[] = [];
          if (isGroup) {
            if (!inGroup) {
              const joinBtn = el("button", { class: "btn", type: "button" }, ["Запросить вступление"]);
              joinBtn.addEventListener("click", () => actions.onGroupJoin(r.id));
              actionButtons.push(joinBtn);
            }
          } else if (isBoard) {
            if (!inBoard) {
              const joinBtn = el("button", { class: "btn", type: "button" }, ["Вступить"]);
              joinBtn.addEventListener("click", () => actions.onBoardJoin(r.id));
              actionButtons.push(joinBtn);
            }
          } else if (pendingIn) {
            const acceptBtn = el("button", { class: "btn", type: "button" }, ["Принять"]);
            const declineBtn = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
            acceptBtn.addEventListener("click", () => actions.onAuthAccept(r.id));
            declineBtn.addEventListener("click", () => actions.onAuthDecline(r.id));
            actionButtons.push(acceptBtn, declineBtn);
          } else if (pendingOut) {
            const cancelBtn = el("button", { class: "btn", type: "button" }, ["Отменить запрос"]);
            cancelBtn.addEventListener("click", () => actions.onAuthCancel(r.id));
            actionButtons.push(cancelBtn);
          } else if (!isFriend && !isGroup && !isBoard) {
            const reqBtn = el("button", { class: "btn", type: "button" }, ["Запросить контакт"]);
            reqBtn.addEventListener("click", () => actions.onAuthRequest(r.id));
            actionButtons.push(reqBtn);
          }

          const meta: string[] = [];
          if (pendingIn) meta.push("Входящий запрос");
          if (pendingOut) meta.push("Ожидает подтверждения");
          if (isGroup && !inGroup) meta.push("Доступ по запросу");
          if (isBoard && !inBoard) meta.push("Открытая доска");

          const itemChildren: HTMLElement[] = [rowBtn];
          if (meta.length) {
            itemChildren.push(el("div", { class: "result-meta" }, [meta.join(" · ")]));
          }
          if (actionButtons.length) {
            itemChildren.push(el("div", { class: "page-actions" }, actionButtons));
          }

          return el("div", { class: "result-item" }, itemChildren);
        })
      );
      blocks.push(serverGroup);
    }

    if (showAppsTab) {
      blocks.push(el("div", { class: "page-empty" }, [el("div", { class: "page-empty-title" }, ["Приложения пока не поддерживаются"])]));
    }

    if (!blocks.length) {
      const message = canSearchNow
        ? "Проверьте запрос или попробуйте другие первые цифры/буквы"
        : "Локально ничего не найдено. Для поиска по серверу нужно минимум 3 цифры ID или 3+ символа логина (@ необязателен)";
      results.replaceChildren(
        el("div", { class: "page-empty" }, [el("div", { class: "page-empty-title" }, ["Ничего не найдено"]), el("div", { class: "page-empty-sub" }, [message])])
      );
      return;
    }

    if (!serverList.length && !canSearchNow && (showChatsTab || showChannelsTab)) {
      blocks.push(el("div", { class: "result-meta" }, ["Поиск по серверу доступен от 3 цифр ID или 3+ символов логина (@ необязателен)"]));
    }

    results.replaceChildren(...blocks);
    if (historyVirtualEnabled) {
      scheduleHistoryVirtualMeasure();
      scheduleHistoryVirtualUpdate();
    }
  }

  return {
    root,
    update,
    focus: () => {
      focusElement(input, { select: true });
    },
  };
}
