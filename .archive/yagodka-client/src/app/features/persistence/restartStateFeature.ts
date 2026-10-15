import { sanitizeArchived } from "../../../helpers/chat/archives";
import { conversationKey } from "../../../helpers/chat/conversationKey";
import { sanitizeDraftMap } from "../../../helpers/chat/drafts";
import { sanitizePins } from "../../../helpers/chat/pins";
import type { ChatSearchFilter } from "../../../helpers/chat/chatSearch";
import type { AppState, PageKind, TargetRef } from "../../../stores/types";
import type { AppShellRestoreSnapshot } from "../../../helpers/navigation/appShellState";

const RESTART_STATE_KEY = "yagodka_restart_state_v1";
const PAGE_KINDS: ReadonlyArray<PageKind> = ["main", "search", "profile", "user", "group", "board", "files"];
const CHAT_SEARCH_FILTERS: ReadonlyArray<ChatSearchFilter> = ["all", "media", "files", "links", "music", "voice"];

export interface RestartStateSnapshot extends AppShellRestoreSnapshot {}

export interface RestartStateFeature {
  save: (state: AppState) => void;
  consume: () => RestartStateSnapshot | null;
}

function toTrimmedString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value ? value : null;
}

function toSelected(raw: unknown): TargetRef | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const kind = typeof source.kind === "string" ? source.kind : "";
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id) return null;
  if (!["dm", "group", "board"].includes(kind)) return null;
  return { kind: kind as TargetRef["kind"], id };
}

function toPage(raw: unknown): PageKind | undefined {
  if (typeof raw !== "string") return undefined;
  if (!PAGE_KINDS.includes(raw as PageKind)) return undefined;
  return raw as PageKind;
}

function toChatSearchFilter(raw: unknown): ChatSearchFilter {
  if (typeof raw !== "string") return "all";
  if (!CHAT_SEARCH_FILTERS.includes(raw as ChatSearchFilter)) return "all";
  return raw as ChatSearchFilter;
}

export function createRestartStateFeature(): RestartStateFeature {
  function save(state: AppState) {
    try {
      const selectedKey = state.selected ? conversationKey(state.selected) : "";
      const input = state.editing && selectedKey && state.editing.key === selectedKey ? state.editing.prevDraft || "" : state.input;
      const payload = {
        v: 1,
        page: state.page,
        userViewId: state.userViewId,
        groupViewId: state.groupViewId,
        boardViewId: state.boardViewId,
        selected: state.selected,
        input,
        drafts: state.drafts,
        pinned: state.pinned,
        archived: state.archived,
        chatSearchOpen: state.chatSearchOpen,
        chatSearchQuery: state.chatSearchQuery,
        chatSearchDate: state.chatSearchDate,
        chatSearchFilter: state.chatSearchFilter,
        chatSearchPos: state.chatSearchPos,
        searchQuery: state.searchQuery,
        profileDraftDisplayName: state.profileDraftDisplayName,
        profileDraftHandle: state.profileDraftHandle,
        profileDraftBio: state.profileDraftBio,
        profileDraftStatus: state.profileDraftStatus,
      };
      sessionStorage.setItem(RESTART_STATE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function consume(): RestartStateSnapshot | null {
    try {
      const raw = sessionStorage.getItem(RESTART_STATE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(RESTART_STATE_KEY);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const obj = parsed as Record<string, unknown>;
      if (obj.v !== 1) return null;

      const userViewId = toTrimmedString(obj.userViewId);
      const groupViewId = toTrimmedString(obj.groupViewId);
      const boardViewId = toTrimmedString(obj.boardViewId);

      const input = typeof obj.input === "string" ? obj.input : "";
      const drafts = sanitizeDraftMap(obj.drafts);
      const pinned = sanitizePins(obj.pinned);
      const archived = sanitizeArchived(obj.archived);
      const chatSearchOpen = Boolean(obj.chatSearchOpen);
      const chatSearchQuery = typeof obj.chatSearchQuery === "string" ? obj.chatSearchQuery : "";
      const chatSearchDate = typeof obj.chatSearchDate === "string" ? obj.chatSearchDate : "";
      const chatSearchFilter = toChatSearchFilter(obj.chatSearchFilter);
      const chatSearchPos = Number.isFinite(obj.chatSearchPos) ? Math.trunc(obj.chatSearchPos as number) : 0;
      const searchQuery = typeof obj.searchQuery === "string" ? obj.searchQuery : "";
      const profileDraftDisplayName = typeof obj.profileDraftDisplayName === "string" ? obj.profileDraftDisplayName : "";
      const profileDraftHandle = typeof obj.profileDraftHandle === "string" ? obj.profileDraftHandle : "";
      const profileDraftBio = typeof obj.profileDraftBio === "string" ? obj.profileDraftBio : "";
      const profileDraftStatus = typeof obj.profileDraftStatus === "string" ? obj.profileDraftStatus : "";

      return {
        page: toPage(obj.page),
        userViewId,
        groupViewId,
        boardViewId,
        selected: toSelected(obj.selected),
        input,
        drafts,
        pinned,
        archived,
        chatSearchOpen,
        chatSearchQuery,
        chatSearchDate,
        chatSearchFilter,
        chatSearchPos,
        searchQuery,
        profileDraftDisplayName,
        profileDraftHandle,
        profileDraftBio,
        profileDraftStatus,
      };
    } catch {
      return null;
    }
  }

  return { save, consume };
}
