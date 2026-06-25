import { el } from "../../../helpers/dom/el";
import { applyLegacyIdMask } from "../../../helpers/id/legacyIdMask";
import { normalizeMemberToken, statusForSearchResult, type MemberTokenStatus } from "../../../helpers/members/memberTokens";
import { resolveMemberTokensForSubmit, type ResolveMemberTokensResult } from "../../../helpers/members/resolveMemberTokens";
import { deriveServerSearchQuery } from "../../../helpers/search/serverSearchQuery";
import type { Store } from "../../../stores/store";
import type { AppState, SearchResultEntry } from "../../../stores/types";
import { normalizeHandle, parseMembersInput } from "./membersInputShared";

export type CreateMembersScope = "group_create" | "board_create";

type MembersAddUiStatus = MemberTokenStatus;

const FORWARD_SEARCH_DEBOUNCE_MS = 180;
const FORWARD_SEARCH_TIMEOUT_MS = 2500;
const FORWARD_SEARCH_TTL_MS = 10_000;

const FORWARD_SEARCH_LOADING_EVENT = "yagodka:forward-search-loading";
const FORWARD_SEARCH_RESULT_EVENT = "yagodka:forward-search-result";
const FORWARD_SEARCH_CLEAR_EVENT = "yagodka:forward-search-clear";

function chipTitle(status: MembersAddUiStatus): string {
  if (status === "ok") return "Найден";
  if (status === "warn") return "Найден, но может не добавиться (нет доступа)";
  if (status === "pending") return "Проверка…";
  if (status === "invalid") return "Некорректный формат";
  return "Не найден";
}

function membersAddDom(): {
  field: HTMLElement;
  chips: HTMLElement;
  entry: HTMLInputElement;
  hidden: HTMLInputElement;
} | null {
  const field = document.getElementById("members-add-field");
  const chips = document.getElementById("members-add-chips");
  const entry = document.getElementById("members-add-entry") as HTMLInputElement | null;
  const hidden = document.getElementById("members-add-input") as HTMLInputElement | null;
  if (!field || !chips || !entry || !hidden) return null;
  return { field, chips, entry, hidden };
}

function createMembersDom(scope: CreateMembersScope): {
  field: HTMLElement;
  chips: HTMLElement;
  entry: HTMLInputElement;
  hidden: HTMLInputElement;
} | null {
  const base = scope === "group_create" ? "group-members" : "board-members";
  const field = document.getElementById(`${base}-field`);
  const chips = document.getElementById(`${base}-chips`);
  const entry = document.getElementById(`${base}-entry`) as HTMLInputElement | null;
  const hidden = document.getElementById(base) as HTMLInputElement | null;
  if (!field || !chips || !entry || !hidden) return null;
  return { field, chips, entry, hidden };
}

type CreateMembersState = {
  status: Map<string, MembersAddUiStatus>;
  handleToId: Map<string, string>;
  queryToToken: Map<string, string>;
  queue: string[];
  inFlight: string | null;
  timeout: number | null;
};

export interface MembersChipsFeatureDeps {
  store: Store<AppState>;
  chatHost: HTMLElement;
  sendSearch: (query: string) => void;
}

export interface MembersChipsFeature {
  installEventListeners: () => void;
  dispose: () => void;

  handleSearchResultMessage: (msg: any) => boolean;

  clearMembersAddLookups: () => void;
  resetCreateMembers: (scope: CreateMembersScope) => void;

  renderMembersAddChips: () => void;
  drainMembersAddLookups: () => void;
  drainCreateMembersLookups: (scope: CreateMembersScope) => void;

  consumeMembersAddEntry: (forceAll: boolean) => void;
  consumeCreateMembersEntry: (scope: CreateMembersScope, forceAll: boolean) => void;

  getMembersAddTokens: () => string[];
  getCreateMembersTokens: (scope: CreateMembersScope) => string[];

  resolveMembersAddTokensForSubmit: (tokens: string[]) => ResolveMemberTokensResult;
  resolveCreateMembersTokensForSubmit: (scope: CreateMembersScope, tokens: string[]) => ResolveMemberTokensResult;
}

function normalizeSearchResults(msg: any): SearchResultEntry[] {
  const raw = Array.isArray(msg?.results) ? msg.results : [];
  return raw
    .map((r: any) => ({
      id: String(r?.id ?? ""),
      online: r?.online === undefined ? undefined : Boolean(r.online),
      friend: r?.friend === undefined ? undefined : Boolean(r.friend),
      group: r?.group === undefined ? undefined : Boolean(r.group),
      board: r?.board === undefined ? undefined : Boolean(r.board),
    }))
    .filter((r: SearchResultEntry) => r.id);
}

export function createMembersChipsFeature(deps: MembersChipsFeatureDeps): MembersChipsFeature {
  const { store, chatHost, sendSearch } = deps;

  const membersIgnoreQueries = new Map<string, number>();

  let forwardSearchDebounce: number | null = null;
  let forwardSearchTimeout: number | null = null;
  let forwardSearchLastIssued = "";
  let forwardSearchExpected = "";
  let forwardSearchExpectedUntil = 0;
  let forwardSearchInputEl: HTMLInputElement | null = null;

  const membersAddStatus = new Map<string, MembersAddUiStatus>();
  const membersAddHandleToId = new Map<string, string>();
  const membersAddQueryToToken = new Map<string, string>();
  const membersAddQueue: string[] = [];
  let membersAddInFlight: string | null = null;
  let membersAddTimeout: number | null = null;

  const groupCreateMembers: CreateMembersState = {
    status: new Map<string, MembersAddUiStatus>(),
    handleToId: new Map<string, string>(),
    queryToToken: new Map<string, string>(),
    queue: [],
    inFlight: null,
    timeout: null,
  };
  const boardCreateMembers: CreateMembersState = {
    status: new Map<string, MembersAddUiStatus>(),
    handleToId: new Map<string, string>(),
    queryToToken: new Map<string, string>(),
    queue: [],
    inFlight: null,
    timeout: null,
  };

  function createMembersState(scope: CreateMembersScope): CreateMembersState {
    return scope === "group_create" ? groupCreateMembers : boardCreateMembers;
  }

  function dispatchForwardEvent(name: string, detail?: any) {
    try {
      if (typeof window === "undefined") return;
      if (typeof (window as any).dispatchEvent !== "function") return;
      if (typeof CustomEvent !== "function") return;
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {
      // ignore
    }
  }

  const clearForwardDebounce = () => {
    if (forwardSearchDebounce === null) return;
    window.clearTimeout(forwardSearchDebounce);
    forwardSearchDebounce = null;
  };

  const clearForwardTimeout = () => {
    if (forwardSearchTimeout === null) return;
    window.clearTimeout(forwardSearchTimeout);
    forwardSearchTimeout = null;
  };

  const resetForwardSearch = () => {
    clearForwardDebounce();
    clearForwardTimeout();
    forwardSearchLastIssued = "";
    forwardSearchExpected = "";
    forwardSearchExpectedUntil = 0;
    dispatchForwardEvent(FORWARD_SEARCH_CLEAR_EVENT);
  };

  const scheduleForwardSearch = (input: HTMLInputElement) => {
    if (forwardSearchInputEl !== input) {
      forwardSearchInputEl = input;
      forwardSearchLastIssued = "";
      forwardSearchExpected = "";
      forwardSearchExpectedUntil = 0;
      clearForwardDebounce();
      clearForwardTimeout();
    }
    clearForwardDebounce();
    clearForwardTimeout();

    const st = store.get();
    if (st.modal?.kind !== "forward_select") return;

    const qRaw = String(input.value || "").trim();
    if (!qRaw) {
      resetForwardSearch();
      return;
    }

    const derived = deriveServerSearchQuery(qRaw);
    if (!derived) {
      forwardSearchExpected = "";
      forwardSearchExpectedUntil = 0;
      dispatchForwardEvent(FORWARD_SEARCH_CLEAR_EVENT);
      return;
    }

    forwardSearchDebounce = window.setTimeout(() => {
      forwardSearchDebounce = null;
      const st2 = store.get();
      if (st2.modal?.kind !== "forward_select") return;
      if (!st2.authed || st2.conn !== "connected") return;

      const el = document.getElementById("forward-search") as HTMLInputElement | null;
      const nowRaw = String(el?.value || "").trim();
      const d2 = deriveServerSearchQuery(nowRaw);
      if (!d2) {
        dispatchForwardEvent(FORWARD_SEARCH_CLEAR_EVENT);
        return;
      }

      if (d2.query === forwardSearchLastIssued) return;
      forwardSearchLastIssued = d2.query;
      forwardSearchExpected = d2.query;
      forwardSearchExpectedUntil = Date.now() + FORWARD_SEARCH_TTL_MS;

      dispatchForwardEvent(FORWARD_SEARCH_LOADING_EVENT, { query: d2.query, kind: d2.kind });
      sendSearch(d2.query);

      forwardSearchTimeout = window.setTimeout(() => {
        forwardSearchTimeout = null;
        const st3 = store.get();
        if (st3.modal?.kind !== "forward_select") return;
        if (!forwardSearchExpected || forwardSearchExpected !== d2.query) return;
        if (Date.now() > forwardSearchExpectedUntil) return;
        dispatchForwardEvent(FORWARD_SEARCH_RESULT_EVENT, { query: d2.query, results: [], timeout: true });
      }, FORWARD_SEARCH_TIMEOUT_MS);
    }, FORWARD_SEARCH_DEBOUNCE_MS);
  };

  const handleForwardSearchResult = (msg: any): boolean => {
    const st = store.get();
    if (st.modal?.kind !== "forward_select") return false;
    const q = String(msg?.query ?? "").trim();
    if (!q) return false;
    const now = Date.now();
    if (!forwardSearchExpected || q !== forwardSearchExpected || now > forwardSearchExpectedUntil) return false;

    clearForwardTimeout();

    const results = normalizeSearchResults(msg);
    dispatchForwardEvent(FORWARD_SEARCH_RESULT_EVENT, { query: q, results });
    return true;
  };

  function clearMembersAddLookups() {
    membersAddQueryToToken.clear();
    membersAddQueue.length = 0;
    membersAddInFlight = null;
    if (membersAddTimeout !== null) {
      window.clearTimeout(membersAddTimeout);
      membersAddTimeout = null;
    }
  }

  function resetCreateMembers(scope: CreateMembersScope) {
    const st = createMembersState(scope);
    st.status.clear();
    st.handleToId.clear();
    st.queryToToken.clear();
    st.queue.length = 0;
    st.inFlight = null;
    if (st.timeout !== null) {
      window.clearTimeout(st.timeout);
      st.timeout = null;
    }
  }

  function createMembersTokens(scope: CreateMembersScope): string[] {
    const dom = createMembersDom(scope);
    if (!dom) return [];
    return Array.from(new Set(parseMembersInput(dom.hidden.value)));
  }

  function createMembersSetTokens(scope: CreateMembersScope, tokens: string[]) {
    const dom = createMembersDom(scope);
    if (!dom) return;
    dom.hidden.value = tokens.join(" ");
  }

  function renderCreateMembersChips(scope: CreateMembersScope) {
    const dom = createMembersDom(scope);
    if (!dom) return;
    const st = createMembersState(scope);

    const tokens = createMembersTokens(scope);
    const canonical = tokens.join(" ");
    if (dom.hidden.value !== canonical) dom.hidden.value = canonical;

    const chips = tokens.map((token) => {
      const status = st.status.get(token) || (normalizeMemberToken(token)?.kind === "invalid" ? "invalid" : "pending");
      const cls = "chip";
      return el(
        "span",
        {
          class: cls,
          role: "button",
          tabindex: "0",
          "data-action": "chip-edit",
          "data-token": token,
          "data-status": status,
          title: chipTitle(status),
        },
        [
          token,
          el(
            "button",
            {
              class: "chip-remove",
              type: "button",
              "data-action": "chip-remove",
              "data-token": token,
              "aria-label": `Удалить: ${token}`,
            },
            ["×"]
          ),
        ]
      );
    });

    dom.chips.replaceChildren(...chips);
  }

  function membersAddTokens(): string[] {
    const dom = membersAddDom();
    if (!dom) return [];
    return Array.from(new Set(parseMembersInput(dom.hidden.value)));
  }

  function membersAddSetTokens(tokens: string[]) {
    const dom = membersAddDom();
    if (!dom) return;
    dom.hidden.value = tokens.join(" ");
  }

  function renderMembersAddChips() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return;
    const dom = membersAddDom();
    if (!dom) return;

    const tokens = membersAddTokens();
    const canonical = tokens.join(" ");
    if (dom.hidden.value !== canonical) dom.hidden.value = canonical;

    const chips = tokens.map((token) => {
      const status = membersAddStatus.get(token) || (normalizeMemberToken(token)?.kind === "invalid" ? "invalid" : "pending");
      const cls = "chip";
      return el(
        "span",
        {
          class: cls,
          role: "button",
          tabindex: "0",
          "data-action": "chip-edit",
          "data-token": token,
          "data-status": status,
          title: chipTitle(status),
        },
        [
          token,
          el(
            "button",
            {
              class: "chip-remove",
              type: "button",
              "data-action": "chip-remove",
              "data-token": token,
              "aria-label": `Удалить: ${token}`,
            },
            ["×"]
          ),
        ]
      );
    });

    dom.chips.replaceChildren(...chips);
  }

  function removeMembersAddQueryFromQueue(query: string) {
    const idx = membersAddQueue.indexOf(query);
    if (idx >= 0) membersAddQueue.splice(idx, 1);
  }

  function removeMembersAddTokenFromLookups(token: string) {
    for (const [q, t] of membersAddQueryToToken.entries()) {
      if (t !== token) continue;
      membersAddQueryToToken.delete(q);
      removeMembersAddQueryFromQueue(q);
      if (membersAddInFlight === q) {
        membersAddInFlight = null;
        if (membersAddTimeout !== null) {
          window.clearTimeout(membersAddTimeout);
          membersAddTimeout = null;
        }
      }
    }
  }

  function membersAddRemoveToken(token: string) {
    const dom = membersAddDom();
    if (!dom) return;
    const tokens = membersAddTokens().filter((t) => t !== token);
    membersAddSetTokens(tokens);
    membersAddStatus.delete(token);
    membersAddHandleToId.delete(token);
    removeMembersAddTokenFromLookups(token);
    renderMembersAddChips();
    drainMembersAddLookups();
  }

  function membersAddEditToken(token: string) {
    const dom = membersAddDom();
    if (!dom) return;
    membersAddRemoveToken(token);
    dom.entry.value = token;
    try {
      dom.entry.focus();
      dom.entry.setSelectionRange(token.length, token.length);
    } catch {
      // ignore
    }
    applyLegacyIdMask(dom.entry);
  }

  function membersAddAddNormalizedTokens(values: string[]) {
    if (!values.length) return;
    const dom = membersAddDom();
    if (!dom) return;
    const current = new Set(membersAddTokens());
    for (const raw of values) {
      const norm = normalizeMemberToken(raw);
      if (!norm) continue;
      const token = norm.value;
      if (current.has(token)) continue;
      current.add(token);
      if (norm.kind === "invalid") {
        membersAddStatus.set(token, "invalid");
        continue;
      }
      if (!membersAddStatus.has(token)) membersAddStatus.set(token, "pending");
      if (norm.query) {
        membersAddQueryToToken.set(norm.query, token);
        if (!membersAddQueue.includes(norm.query) && membersAddInFlight !== norm.query) {
          membersAddQueue.push(norm.query);
        }
      }
    }
    membersAddSetTokens(Array.from(current));
    renderMembersAddChips();
    drainMembersAddLookups();
  }

  function consumeMembersAddEntry(forceAll: boolean) {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return;
    const dom = membersAddDom();
    if (!dom) return;

    const value = dom.entry.value;
    if (!value.trim()) return;

    const hasTrailingSep = /[\s,]$/.test(value);
    const parts = value.split(/[\s,]+/);
    let tail = "";
    let toCommit = parts;
    if (!forceAll && !hasTrailingSep) {
      tail = parts.pop() || "";
      toCommit = parts;
    }
    const tokens = toCommit.map((t) => t.trim()).filter(Boolean);
    if (tokens.length) membersAddAddNormalizedTokens(tokens);

    dom.entry.value = forceAll || hasTrailingSep ? "" : tail;
    applyLegacyIdMask(dom.entry);
  }

  function drainMembersAddLookups() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return;
    if (!st.authed || st.conn !== "connected") return;
    if (membersAddInFlight) return;
    const next = membersAddQueue.shift() || null;
    if (!next) return;
    membersAddInFlight = next;
    membersIgnoreQueries.set(next, Date.now() + 10_000);
    sendSearch(next);
    if (membersAddTimeout !== null) window.clearTimeout(membersAddTimeout);
    membersAddTimeout = window.setTimeout(() => {
      const q = membersAddInFlight;
      if (q !== next) return;
      membersAddInFlight = null;
      membersAddTimeout = null;
      membersIgnoreQueries.delete(next);
      const token = membersAddQueryToToken.get(next);
      if (token) {
        membersAddStatus.set(token, "bad");
        membersAddHandleToId.delete(token);
      }
      membersAddQueryToToken.delete(next);
      renderMembersAddChips();
      drainMembersAddLookups();
    }, 2500);
  }

  function handleMembersAddSearchResult(msg: any): boolean {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return false;
    const q = String(msg?.query ?? "").trim();
    if (!q) return false;
    const token = membersAddQueryToToken.get(q);
    if (!token) return false;
    membersIgnoreQueries.delete(q);

    const results = normalizeSearchResults(msg);
    const norm = normalizeMemberToken(token) || { kind: "invalid" as const, value: token, query: null };
    const res = statusForSearchResult(norm, results, modal.targetKind);
    membersAddStatus.set(token, res.status);
    if (norm.kind === "handle") {
      if (res.resolvedId) membersAddHandleToId.set(token, res.resolvedId);
      else membersAddHandleToId.delete(token);
    }

    membersAddQueryToToken.delete(q);
    if (membersAddInFlight === q) {
      membersAddInFlight = null;
      if (membersAddTimeout !== null) {
        window.clearTimeout(membersAddTimeout);
        membersAddTimeout = null;
      }
    }

    renderMembersAddChips();
    drainMembersAddLookups();
    return true;
  }

  function removeCreateQueryFromQueue(scope: CreateMembersScope, query: string) {
    const st = createMembersState(scope);
    const idx = st.queue.indexOf(query);
    if (idx >= 0) st.queue.splice(idx, 1);
  }

  function removeCreateTokenFromLookups(scope: CreateMembersScope, token: string) {
    const st = createMembersState(scope);
    for (const [q, t] of st.queryToToken.entries()) {
      if (t !== token) continue;
      st.queryToToken.delete(q);
      removeCreateQueryFromQueue(scope, q);
      if (st.inFlight === q) {
        st.inFlight = null;
        if (st.timeout !== null) {
          window.clearTimeout(st.timeout);
          st.timeout = null;
        }
      }
    }
  }

  function createMembersRemoveToken(scope: CreateMembersScope, token: string) {
    const dom = createMembersDom(scope);
    if (!dom) return;
    const st = createMembersState(scope);
    const tokens = createMembersTokens(scope).filter((t) => t !== token);
    createMembersSetTokens(scope, tokens);
    st.status.delete(token);
    st.handleToId.delete(token);
    removeCreateTokenFromLookups(scope, token);
    renderCreateMembersChips(scope);
    drainCreateMembersLookups(scope);
  }

  function createMembersEditToken(scope: CreateMembersScope, token: string) {
    const dom = createMembersDom(scope);
    if (!dom) return;
    createMembersRemoveToken(scope, token);
    dom.entry.value = token;
    try {
      dom.entry.focus();
      dom.entry.setSelectionRange(token.length, token.length);
    } catch {
      // ignore
    }
    applyLegacyIdMask(dom.entry);
  }

  function createMembersAddNormalizedTokens(scope: CreateMembersScope, values: string[]) {
    if (!values.length) return;
    const dom = createMembersDom(scope);
    if (!dom) return;
    const st = createMembersState(scope);
    const current = new Set(createMembersTokens(scope));
    for (const raw of values) {
      const norm = normalizeMemberToken(raw);
      if (!norm) continue;
      const token = norm.value;
      if (current.has(token)) continue;
      current.add(token);
      if (norm.kind === "invalid") {
        st.status.set(token, "invalid");
        continue;
      }
      if (!st.status.has(token)) st.status.set(token, "pending");
      if (norm.query) {
        st.queryToToken.set(norm.query, token);
        if (!st.queue.includes(norm.query) && st.inFlight !== norm.query) {
          st.queue.push(norm.query);
        }
      }
    }
    createMembersSetTokens(scope, Array.from(current));
    renderCreateMembersChips(scope);
    drainCreateMembersLookups(scope);
  }

  function consumeCreateMembersEntry(scope: CreateMembersScope, forceAll: boolean) {
    const st = store.get();
    if (st.page !== scope) return;
    const dom = createMembersDom(scope);
    if (!dom) return;

    const value = dom.entry.value;
    if (!value.trim()) return;

    const hasTrailingSep = /[\s,]$/.test(value);
    const parts = value.split(/[\s,]+/);
    let tail = "";
    let toCommit = parts;
    if (!forceAll && !hasTrailingSep) {
      tail = parts.pop() || "";
      toCommit = parts;
    }
    const tokens = toCommit.map((t) => t.trim()).filter(Boolean);
    if (tokens.length) createMembersAddNormalizedTokens(scope, tokens);

    dom.entry.value = forceAll || hasTrailingSep ? "" : tail;
    applyLegacyIdMask(dom.entry);
  }

  function drainCreateMembersLookups(scope: CreateMembersScope) {
    const st = store.get();
    if (st.page !== scope) return;
    if (!st.authed || st.conn !== "connected") return;
    const s = createMembersState(scope);
    if (s.inFlight) return;
    const next = s.queue.shift() || null;
    if (!next) return;
    s.inFlight = next;
    membersIgnoreQueries.set(next, Date.now() + 10_000);
    sendSearch(next);
    if (s.timeout !== null) window.clearTimeout(s.timeout);
    s.timeout = window.setTimeout(() => {
      const q = s.inFlight;
      if (q !== next) return;
      s.inFlight = null;
      s.timeout = null;
      membersIgnoreQueries.delete(next);
      const token = s.queryToToken.get(next);
      if (token) {
        s.status.set(token, "bad");
        s.handleToId.delete(token);
      }
      s.queryToToken.delete(next);
      renderCreateMembersChips(scope);
      drainCreateMembersLookups(scope);
    }, 2500);
  }

  function handleCreateMembersSearchResult(scope: CreateMembersScope, msg: any): boolean {
    const st = store.get();
    if (st.page !== scope) return false;
    const s = createMembersState(scope);
    const q = String(msg?.query ?? "").trim();
    if (!q) return false;
    const token = s.queryToToken.get(q);
    if (!token) return false;
    membersIgnoreQueries.delete(q);

    const results = normalizeSearchResults(msg);
    const targetKind = scope === "group_create" ? "group" : "board";
    const norm = normalizeMemberToken(token) || { kind: "invalid" as const, value: token, query: null };
    const res = statusForSearchResult(norm, results, targetKind);
    s.status.set(token, res.status);
    if (norm.kind === "handle") {
      if (res.resolvedId) s.handleToId.set(token, res.resolvedId);
      else s.handleToId.delete(token);
    }

    s.queryToToken.delete(q);
    if (s.inFlight === q) {
      s.inFlight = null;
      if (s.timeout !== null) {
        window.clearTimeout(s.timeout);
        s.timeout = null;
      }
    }

    renderCreateMembersChips(scope);
    drainCreateMembersLookups(scope);
    return true;
  }

  function handleSearchResultMessage(msg: any): boolean {
    if (handleForwardSearchResult(msg)) return true;
    const q = String(msg?.query ?? "").trim();
    const now = Date.now();
    const exp = q ? membersIgnoreQueries.get(q) : null;
    if (q && exp && exp > now) {
      handleMembersAddSearchResult(msg);
      handleCreateMembersSearchResult("group_create", msg);
      handleCreateMembersSearchResult("board_create", msg);
      return true;
    }
    if (q && exp) membersIgnoreQueries.delete(q);
    if (handleMembersAddSearchResult(msg)) return true;
    if (handleCreateMembersSearchResult("group_create", msg)) return true;
    if (handleCreateMembersSearchResult("board_create", msg)) return true;
    return false;
  }

  function installEventListeners() {
    if (!chatHost) return;

    chatHost.addEventListener("input", onChatInput);
    chatHost.addEventListener("paste", onChatPaste);
    chatHost.addEventListener("keydown", onChatKeyDown, true);
    chatHost.addEventListener("click", onChatClick);
  }

  function dispose() {
    if (!chatHost) return;
    chatHost.removeEventListener("input", onChatInput);
    chatHost.removeEventListener("paste", onChatPaste);
    chatHost.removeEventListener("keydown", onChatKeyDown, true);
    chatHost.removeEventListener("click", onChatClick);
  }

  function onChatInput(e: Event) {
    const st = store.get();
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.id === "forward-search") {
      if (st.modal?.kind !== "forward_select") return;
      scheduleForwardSearch(target as HTMLInputElement);
      return;
    }
    if (target.id === "members-add-entry") {
      if (st.modal?.kind !== "members_add") return;
      const input = target as HTMLInputElement;
      applyLegacyIdMask(input);
      consumeMembersAddEntry(false);
      return;
    }
    if (target.id === "group-members-entry") {
      if (st.page !== "group_create") return;
      const input = target as HTMLInputElement;
      applyLegacyIdMask(input);
      consumeCreateMembersEntry("group_create", false);
      return;
    }
    if (target.id === "board-members-entry") {
      if (st.page !== "board_create") return;
      const input = target as HTMLInputElement;
      applyLegacyIdMask(input);
      consumeCreateMembersEntry("board_create", false);
      return;
    }
  }

  function onChatPaste(e: ClipboardEvent) {
    const st = store.get();
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.id === "members-add-entry") {
      if (st.modal?.kind !== "members_add") return;
      window.setTimeout(() => consumeMembersAddEntry(true), 0);
      return;
    }
    if (target.id === "group-members-entry") {
      if (st.page !== "group_create") return;
      window.setTimeout(() => consumeCreateMembersEntry("group_create", true), 0);
      return;
    }
    if (target.id === "board-members-entry") {
      if (st.page !== "board_create") return;
      window.setTimeout(() => consumeCreateMembersEntry("board_create", true), 0);
      return;
    }
  }

  function onChatKeyDown(e: KeyboardEvent) {
    const st = store.get();
    const target = e.target as HTMLElement | null;

    const entryScope: "members_add" | CreateMembersScope | null =
      target?.id === "members-add-entry" && st.modal?.kind === "members_add"
        ? "members_add"
        : target?.id === "group-members-entry" && st.page === "group_create"
          ? "group_create"
          : target?.id === "board-members-entry" && st.page === "board_create"
            ? "board_create"
            : null;

    if (entryScope && target) {
      const entry = target as HTMLInputElement;
      const hasText = Boolean(entry.value.trim());
      if (e.key === "Enter" && !e.shiftKey) {
        if (hasText) {
          e.preventDefault();
          e.stopPropagation();
          if (entryScope === "members_add") consumeMembersAddEntry(true);
          else consumeCreateMembersEntry(entryScope, true);
        }
        return;
      }
      if (e.key === "," || e.key === " ") {
        if (hasText) {
          e.preventDefault();
          e.stopPropagation();
          if (entryScope === "members_add") consumeMembersAddEntry(true);
          else consumeCreateMembersEntry(entryScope, true);
        }
        return;
      }
      if (e.key === "Backspace" && !entry.value) {
        const tokens = entryScope === "members_add" ? membersAddTokens() : createMembersTokens(entryScope);
        const last = tokens.length ? tokens[tokens.length - 1] : "";
        if (last) {
          e.preventDefault();
          e.stopPropagation();
          if (entryScope === "members_add") membersAddEditToken(last);
          else createMembersEditToken(entryScope, last);
        }
        return;
      }
    }

    const chip = target?.closest("[data-action='chip-edit'][data-token]") as HTMLElement | null;
    if (chip && (e.key === "Enter" || e.key === " ")) {
      const token = String(chip.getAttribute("data-token") || "").trim();
      if (!token) return;

      const scope: "members_add" | CreateMembersScope | null =
        chip.closest("#members-add-field") && st.modal?.kind === "members_add"
          ? "members_add"
          : chip.closest("#group-members-field") && st.page === "group_create"
            ? "group_create"
            : chip.closest("#board-members-field") && st.page === "board_create"
              ? "board_create"
              : null;
      if (!scope) return;

      e.preventDefault();
      e.stopPropagation();
      if (scope === "members_add") membersAddEditToken(token);
      else createMembersEditToken(scope, token);
    }
  }

  function onChatClick(e: MouseEvent) {
    const st = store.get();
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const scope: "members_add" | CreateMembersScope | null =
      target.closest("#members-add-field") && st.modal?.kind === "members_add"
        ? "members_add"
        : target.closest("#group-members-field") && st.page === "group_create"
          ? "group_create"
          : target.closest("#board-members-field") && st.page === "board_create"
            ? "board_create"
            : null;
    if (!scope) return;

    const removeBtn = target.closest("button[data-action='chip-remove'][data-token]") as HTMLButtonElement | null;
    if (removeBtn) {
      const token = String(removeBtn.getAttribute("data-token") || "").trim();
      if (token) {
        e.preventDefault();
        if (scope === "members_add") membersAddRemoveToken(token);
        else createMembersRemoveToken(scope, token);
      }
      return;
    }

    const chip = target.closest("[data-action='chip-edit'][data-token]") as HTMLElement | null;
    if (chip) {
      const token = String(chip.getAttribute("data-token") || "").trim();
      if (token) {
        e.preventDefault();
        if (scope === "members_add") membersAddEditToken(token);
        else createMembersEditToken(scope, token);
      }
      return;
    }

    const field = target.closest(".chips-field");
    if (!field) return;
    const dom = scope === "members_add" ? membersAddDom() : createMembersDom(scope);
    dom?.entry.focus();
  }

  function getMembersAddTokens() {
    return membersAddTokens();
  }

  function getCreateMembersTokens(scope: CreateMembersScope) {
    return createMembersTokens(scope);
  }

  function resolveMembersAddTokensForSubmit(tokens: string[]): ResolveMemberTokensResult {
    return resolveMemberTokensForSubmit({
      tokens,
      statusByToken: membersAddStatus,
      handleToId: membersAddHandleToId,
    });
  }

  function resolveCreateMembersTokensForSubmit(scope: CreateMembersScope, tokens: string[]): ResolveMemberTokensResult {
    const st = createMembersState(scope);
    return resolveMemberTokensForSubmit({
      tokens,
      statusByToken: st.status,
      handleToId: st.handleToId,
    });
  }

  return {
    installEventListeners,
    dispose,
    handleSearchResultMessage,
    clearMembersAddLookups,
    resetCreateMembers,
    renderMembersAddChips,
    drainMembersAddLookups,
    drainCreateMembersLookups,
    consumeMembersAddEntry,
    consumeCreateMembersEntry,
    getMembersAddTokens,
    getCreateMembersTokens,
    resolveMembersAddTokensForSubmit,
    resolveCreateMembersTokensForSubmit,
  };
}
