import { sanitizeChatFoldersSnapshot, type ChatFoldersSnapshot } from "../chat/folders";
import type {
  AppState,
  ChatFolderEntry,
  DomainSyncSource,
  MobileSidebarTab,
  SidebarSyncState,
} from "../../stores/types";

function normalizeDomainSource(raw: unknown, fallback: DomainSyncSource): DomainSyncSource {
  const value = String(raw || "").trim().toLowerCase();
  return value === "cache" || value === "server" || value === "empty" ? (value as DomainSyncSource) : fallback;
}

function normalizeTs(raw: unknown): number | null {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return n > 0 ? n : null;
}

export function normalizeMobileSidebarTab(raw: unknown): MobileSidebarTab {
  const tab = String(raw || "").trim().toLowerCase();
  return tab === "groups" || tab === "boards" || tab === "menu" ? (tab as MobileSidebarTab) : "contacts";
}

function toFolderSnapshot(active: string, folders: ChatFolderEntry[]): ChatFoldersSnapshot {
  return sanitizeChatFoldersSnapshot({ v: 1, active, folders });
}

export function createSidebarSyncState(patch?: Partial<SidebarSyncState> | null): SidebarSyncState {
  const loaded = Boolean(patch?.loaded);
  const source = normalizeDomainSource(patch?.source, loaded ? "server" : "empty");
  return {
    loaded,
    source,
    reconcilePending: Boolean(patch?.reconcilePending ?? (source === "cache" && loaded)),
    lastServerAt: normalizeTs(patch?.lastServerAt),
    lastLocalAt: normalizeTs(patch?.lastLocalAt),
  };
}

export function getSidebarSyncState(state: AppState): SidebarSyncState {
  return createSidebarSyncState(state.sidebarSync);
}

export function applySidebarSyncState(prev: AppState, patch: Partial<SidebarSyncState>): AppState {
  return { ...prev, sidebarSync: createSidebarSyncState({ ...getSidebarSyncState(prev), ...patch }) };
}

export function applySidebarFolderSnapshot(
  prev: AppState,
  raw: unknown,
  opts?: { source?: DomainSyncSource; reconcilePending?: boolean }
): AppState {
  const snap = sanitizeChatFoldersSnapshot(raw);
  const source = opts?.source || "server";
  return applySidebarSyncState(
    {
      ...prev,
      chatFolders: snap.folders,
      sidebarFolderId: snap.active,
    },
    {
      loaded: true,
      source,
      reconcilePending: Boolean(opts?.reconcilePending ?? (source === "cache")),
      ...(source === "server" ? { lastServerAt: Date.now() } : { lastLocalAt: Date.now() }),
    }
  );
}

export function applySidebarFolderMutation(prev: AppState, raw: unknown): AppState {
  const snap = sanitizeChatFoldersSnapshot(raw);
  const current = getSidebarSyncState(prev);
  return applySidebarSyncState(
    {
      ...prev,
      chatFolders: snap.folders,
      sidebarFolderId: snap.active,
    },
    {
      loaded: true,
      source: current.loaded ? current.source : "server",
      reconcilePending: current.reconcilePending,
      lastLocalAt: Date.now(),
    }
  );
}

export function setSidebarFolderId(prev: AppState, folderId: string): AppState {
  const snap = toFolderSnapshot(String(folderId || "").trim().toLowerCase() || "all", prev.chatFolders || []);
  if (String(prev.sidebarFolderId || "").trim().toLowerCase() === snap.active) return prev;
  return applySidebarFolderMutation(prev, snap);
}

export function setSidebarQueryValue(prev: AppState, query: string): AppState {
  const nextQuery = String(query ?? "");
  if (prev.sidebarQuery === nextQuery) return prev;
  return applySidebarSyncState({ ...prev, sidebarQuery: nextQuery }, { lastLocalAt: Date.now() });
}

export function setSidebarArchiveOpenValue(prev: AppState, open: boolean): AppState {
  const nextOpen = Boolean(open);
  if (Boolean(prev.sidebarArchiveOpen) === nextOpen) return prev;
  return applySidebarSyncState({ ...prev, sidebarArchiveOpen: nextOpen }, { lastLocalAt: Date.now() });
}

export function toggleSidebarArchiveValue(prev: AppState): AppState {
  return setSidebarArchiveOpenValue(prev, !prev.sidebarArchiveOpen);
}

export function setMobileSidebarTabValue(prev: AppState, tab: MobileSidebarTab): AppState {
  const next = normalizeMobileSidebarTab(tab);
  if (prev.mobileSidebarTab === next) return prev;
  return applySidebarSyncState({ ...prev, mobileSidebarTab: next }, { lastLocalAt: Date.now() });
}

export function resetSidebarState(prev: AppState): AppState {
  return {
    ...prev,
    mobileSidebarTab: "contacts",
    sidebarFolderId: "all",
    sidebarQuery: "",
    sidebarArchiveOpen: true,
    chatFolders: [],
    sidebarSync: createSidebarSyncState(),
  };
}
