import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { normalizeMobileSidebarTab } from "../../helpers/sidebar/sidebarState";
import type { AppState, FriendEntry, MobileSidebarTab, TargetRef } from "../../stores/types";
import {
  collectAttentionPeers,
  collectSelfMentionHandles,
  compactOneLine,
  displayNameForFriend,
  hasSelfMention,
} from "./renderSidebarHelpers";

type RoomLike = { id: string; name?: string | null; handle?: string | null };

function normalizeSelectedKey(page: AppState["page"], selected: TargetRef | null): string {
  if (page !== "main" || !selected) return "";
  const id = String(selected.id || "").trim();
  if (!id) return "";
  return selected.kind === "dm" ? dmKey(id) : selected.kind === "group" || selected.kind === "board" ? roomKey(id) : "";
}

export interface SidebarProjection {
  selected: TargetRef | null;
  selectedKind: string;
  selectedId: string;
  currentSelectedKey: string;
  mobileTab: MobileSidebarTab;
  sidebarQueryRaw: string;
  sidebarQuery: string;
  hasSidebarQuery: boolean;
  sidebarArchiveOpen: boolean;
  drafts: Record<string, string>;
  groups: AppState["groups"];
  boards: AppState["boards"];
  pinnedKeys: string[];
  pinnedSet: Set<string>;
  archivedKeys: string[];
  archivedSet: Set<string>;
  attnSet: Set<string>;
  unknownAttnPeers: string[];
  contactCandidates: FriendEntry[];
  activeContacts: FriendEntry[];
  archivedContacts: FriendEntry[];
  groupArchiveCount: number;
  groupArchiveVisible: boolean;
  groupArchiveOpen: boolean;
  boardArchiveCount: number;
  boardArchiveVisible: boolean;
  boardArchiveOpen: boolean;
  matchesQuery: (raw: string) => boolean;
  matchesFriend: (friend: FriendEntry) => boolean;
  matchesRoom: (entry: RoomLike) => boolean;
  isMuted: (id: string) => boolean;
  lastTsForKey: (key: string) => number;
  computeRoomUnread: (key: string) => number;
  mentionForKey: (key: string) => boolean;
}

export function buildSidebarProjection(state: AppState): SidebarProjection {
  const selected = state.selected;
  const selectedKind = selected?.kind ? String(selected.kind) : "";
  const selectedId = selected?.id ? String(selected.id) : "";
  const currentSelectedKey = normalizeSelectedKey(state.page, selected);
  const mobileTab = normalizeMobileSidebarTab(state.mobileSidebarTab);
  const sidebarQueryRaw = compactOneLine(String(state.sidebarQuery || ""));
  const sidebarQuery = sidebarQueryRaw.toLowerCase();
  const hasSidebarQuery = Boolean(sidebarQuery);
  const sidebarArchiveOpen = state.sidebarArchiveOpen !== false;
  const drafts = state.drafts || {};
  const groups = state.groups || [];
  const boards = state.boards || [];
  const pinnedKeys = Array.isArray(state.pinned) ? state.pinned : [];
  const pinnedSet = new Set(pinnedKeys);
  const archivedKeys = Array.isArray(state.archived) ? state.archived : [];
  const archivedSet = new Set(archivedKeys);
  const attnSet = collectAttentionPeers(state);
  const mutedSet = new Set((state.muted || []).map((x) => String(x || "").trim()).filter(Boolean));
  const selfMentionHandles = collectSelfMentionHandles(state);

  const matchesQuery = (raw: string): boolean => {
    if (!hasSidebarQuery) return true;
    return String(raw || "").toLowerCase().includes(sidebarQuery);
  };

  const matchesRoom = (entry: RoomLike): boolean => {
    if (!hasSidebarQuery) return true;
    const id = String(entry.id || "").trim();
    const name = entry.name ? String(entry.name).trim() : "";
    const handle = entry.handle ? String(entry.handle).trim() : "";
    const h = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "";
    return matchesQuery([name, h, id].filter(Boolean).join(" "));
  };

  const matchesFriend = (friend: FriendEntry): boolean => {
    if (!hasSidebarQuery) return true;
    const id = String(friend.id || "").trim();
    const profile = id ? state.profiles?.[id] : null;
    const displayName = displayNameForFriend(state, friend);
    const handle = profile?.handle ? String(profile.handle).trim() : "";
    const h = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "";
    return matchesQuery([displayName, h, id].filter(Boolean).join(" "));
  };

  const roomUnreadCache = new Map<string, number>();
  const computeRoomUnread = (key: string): number => {
    if (!key.startsWith("room:")) return 0;
    if (roomUnreadCache.has(key)) return roomUnreadCache.get(key) || 0;
    const conv = state.conversations?.[key] || [];
    if (!Array.isArray(conv) || conv.length === 0) {
      roomUnreadCache.set(key, 0);
      return 0;
    }
    const marker = state.lastRead?.[key];
    const lastReadId = Number((marker as any)?.id ?? 0);
    const lastReadTs = Number((marker as any)?.ts ?? 0);
    if (lastReadId <= 0 && lastReadTs <= 0) {
      roomUnreadCache.set(key, 0);
      return 0;
    }
    let count = 0;
    for (let i = conv.length - 1; i >= 0; i -= 1) {
      const msg = conv[i] as any;
      if (!msg || msg.kind !== "in") continue;
      const msgId = Number(msg.id ?? 0);
      const msgTs = Number(msg.ts ?? 0);
      if (lastReadId > 0) {
        if (Number.isFinite(msgId) && msgId > lastReadId) {
          count += 1;
          continue;
        }
        if (Number.isFinite(msgId) && msgId <= lastReadId) break;
        if (lastReadTs > 0 && msgTs > lastReadTs) {
          count += 1;
          continue;
        }
        if (lastReadTs > 0 && msgTs <= lastReadTs) break;
        continue;
      }
      if (lastReadTs > 0) {
        if (msgTs > lastReadTs) {
          count += 1;
          continue;
        }
        if (msgTs > 0 && msgTs <= lastReadTs) break;
      }
    }
    roomUnreadCache.set(key, count);
    return count;
  };

  const lastTsForKey = (key: string): number => {
    const conv = state.conversations[key] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    const ts = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? last.ts : 0;
    return Math.max(0, ts);
  };

  const mentionForKey = (key: string): boolean => {
    if (!selfMentionHandles.size) return false;
    const conv = state.conversations[key] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    if (!last || last.kind !== "in") return false;
    const from = String(last.from || "").trim();
    if (from && state.selfId && from === state.selfId) return false;
    const mentioned = hasSelfMention(String(last.text || ""), selfMentionHandles);
    if (!mentioned) return false;
    if (!key.startsWith("room:")) return true;
    const marker = state.lastRead?.[key];
    const lastReadId = Number(marker?.id ?? 0);
    const lastReadTs = Number(marker?.ts ?? 0);
    const msgId = Number(last.id ?? 0);
    const msgTs = Number(last.ts ?? 0);
    if (lastReadId > 0 && Number.isFinite(msgId) && msgId > 0 && msgId <= lastReadId) return false;
    if (lastReadId <= 0 && lastReadTs > 0 && msgTs > 0 && msgTs <= lastReadTs) return false;
    return true;
  };

  const friendIdSet = new Set<string>();
  for (const friend of state.friends || []) {
    const id = String(friend.id || "").trim();
    if (!id) continue;
    friendIdSet.add(id);
  }
  const unknownAttnPeers = Array.from(attnSet).filter((id) => !friendIdSet.has(id)).sort();
  const contactCandidates = (state.friends || []).filter((friend) => matchesFriend(friend) && !pinnedSet.has(dmKey(friend.id)));
  const activeContacts = contactCandidates;
  const archivedContacts: FriendEntry[] = [];

  const countArchivedRooms = (rooms: RoomLike[]): number => {
    if (hasSidebarQuery) return 0;
    let count = 0;
    for (const key of archivedKeys) {
      if (pinnedSet.has(key)) continue;
      if (!key.startsWith("room:")) continue;
      const roomId = key.slice(5);
      const entry = rooms.find((room) => String(room?.id || "") === roomId);
      if (entry && matchesRoom(entry)) count += 1;
    }
    return count;
  };

  const groupArchiveCount = countArchivedRooms(groups);
  const boardArchiveCount = countArchivedRooms(boards);
  const groupArchiveVisible = groupArchiveCount > 0;
  const boardArchiveVisible = boardArchiveCount > 0;
  const groupArchiveOpen = groupArchiveVisible && sidebarArchiveOpen;
  const boardArchiveOpen = boardArchiveVisible && sidebarArchiveOpen;

  const isMuted = (id: string): boolean => mutedSet.has(String(id || "").trim());

  return {
    selected,
    selectedKind,
    selectedId,
    currentSelectedKey,
    mobileTab,
    sidebarQueryRaw,
    sidebarQuery,
    hasSidebarQuery,
    sidebarArchiveOpen,
    drafts,
    groups,
    boards,
    pinnedKeys,
    pinnedSet,
    archivedKeys,
    archivedSet,
    attnSet,
    unknownAttnPeers,
    contactCandidates,
    activeContacts,
    archivedContacts,
    groupArchiveCount,
    groupArchiveVisible,
    groupArchiveOpen,
    boardArchiveCount,
    boardArchiveVisible,
    boardArchiveOpen,
    matchesQuery,
    matchesFriend,
    matchesRoom,
    isMuted,
    lastTsForKey,
    computeRoomUnread,
    mentionForKey,
  };
}
