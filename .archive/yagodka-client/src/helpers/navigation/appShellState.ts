import type { ChatSearchFilter } from "../chat/chatSearch";
import { applyDraftMapSnapshot } from "../runtime/deliverySync";
import { setMobileSidebarTabValue } from "../sidebar/sidebarState";
import type { AppState, ModalState } from "../../stores/types";
import type { NavigationRestoreSnapshot } from "./viewState";
import { applyPageState, applyRestartNavigationState } from "./viewState";

export interface AppShellRestoreSnapshot extends NavigationRestoreSnapshot {
  input?: string;
  drafts?: Record<string, string>;
  pinned?: string[];
  archived?: string[];
  chatSearchOpen?: boolean;
  chatSearchQuery?: string;
  chatSearchDate?: string;
  chatSearchFilter?: ChatSearchFilter;
  chatSearchPos?: number;
  searchQuery?: string;
  profileDraftDisplayName?: string;
  profileDraftHandle?: string;
  profileDraftBio?: string;
  profileDraftStatus?: string;
}

export function applyRestartAppShellState(prev: AppState, restored: AppShellRestoreSnapshot): AppState {
  const next = {
    ...applyRestartNavigationState(prev, restored),
    input: restored.input ?? prev.input,
    pinned: restored.pinned ?? prev.pinned,
    archived: restored.archived ?? prev.archived,
    chatSearchOpen: restored.chatSearchOpen ?? prev.chatSearchOpen,
    chatSearchQuery: restored.chatSearchQuery ?? prev.chatSearchQuery,
    chatSearchDate: restored.chatSearchDate ?? prev.chatSearchDate,
    chatSearchFilter: restored.chatSearchFilter ?? prev.chatSearchFilter,
    chatSearchPos: restored.chatSearchPos ?? prev.chatSearchPos,
    searchQuery: restored.searchQuery ?? prev.searchQuery,
    profileDraftDisplayName: restored.profileDraftDisplayName ?? prev.profileDraftDisplayName,
    profileDraftHandle: restored.profileDraftHandle ?? prev.profileDraftHandle,
    profileDraftBio: restored.profileDraftBio ?? prev.profileDraftBio,
    profileDraftStatus: restored.profileDraftStatus ?? prev.profileDraftStatus,
  };
  return restored.drafts ? applyDraftMapSnapshot(next, restored.drafts, { source: "cache", reconcilePending: true }) : next;
}

export function openModalState(prev: AppState, modal: ModalState): AppState {
  return { ...prev, modal };
}

export function closeModalState(prev: AppState, opts?: { dismissUpdate?: boolean }): AppState {
  return {
    ...prev,
    modal: null,
    ...(opts?.dismissUpdate ? { updateDismissedLatest: prev.updateLatest } : {}),
  };
}

export function openAuthModal(
  prev: AppState,
  opts?: { message?: string; mode?: "register" | "login"; status?: string | null }
): AppState {
  const next = {
    ...prev,
    ...(opts?.mode ? { authMode: opts.mode } : {}),
    ...(opts?.status !== undefined ? { status: opts.status || "" } : {}),
  };
  return openModalState(next, opts?.message ? { kind: "auth", message: opts.message } : { kind: "auth" });
}

export function openCreatePageState(prev: AppState, page: "group_create" | "board_create"): AppState {
  const next = setMobileSidebarTabValue(applyPageState(prev, page), "menu");
  if (page === "group_create") {
    return { ...next, groupCreateMessage: "" };
  }
  return { ...next, boardCreateMessage: "" };
}
