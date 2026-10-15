import type {
  AppState,
  DomainSyncSource,
  FriendEntry,
  ProfileSyncState,
  RosterSyncState,
  TopPeerEntry,
  UserProfile,
} from "../../stores/types";

function normalizeDomainSource(raw: unknown, fallback: DomainSyncSource): DomainSyncSource {
  const value = String(raw || "").trim().toLowerCase();
  return value === "cache" || value === "server" || value === "empty" ? (value as DomainSyncSource) : fallback;
}

function normalizeTs(raw: unknown): number | null {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : Math.trunc(Number(raw) || 0);
  return n > 0 ? n : null;
}

export function createRosterSyncState(patch?: Partial<RosterSyncState> | null): RosterSyncState {
  const loaded = Boolean(patch?.loaded);
  const source = normalizeDomainSource(patch?.source, loaded ? "server" : "empty");
  return {
    loaded,
    source,
    reconcilePending: Boolean(patch?.reconcilePending ?? (source === "cache" && loaded)),
    lastServerAt: normalizeTs(patch?.lastServerAt),
    lastPresenceAt: normalizeTs(patch?.lastPresenceAt),
  };
}

export function getRosterSyncState(state: AppState): RosterSyncState {
  return createRosterSyncState(state.rosterSync);
}

export function applyRosterSyncState(prev: AppState, patch: Partial<RosterSyncState>): AppState {
  return { ...prev, rosterSync: createRosterSyncState({ ...getRosterSyncState(prev), ...patch }) };
}

export function createProfileSyncState(patch?: Partial<ProfileSyncState> | null): ProfileSyncState {
  const loaded = Boolean(patch?.loaded);
  const source = normalizeDomainSource(patch?.source, loaded ? "server" : "empty");
  return {
    loaded,
    source,
    lastServerAt: normalizeTs(patch?.lastServerAt),
    avatarCheckedAt: normalizeTs(patch?.avatarCheckedAt),
  };
}

export function getProfileSyncState(state: AppState, id: string): ProfileSyncState {
  const cleanId = String(id || "").trim();
  if (!cleanId) return createProfileSyncState();
  return createProfileSyncState(state.profileSync?.[cleanId]);
}

export function applyProfileSyncState(prev: AppState, id: string, patch: Partial<ProfileSyncState>): AppState {
  const cleanId = String(id || "").trim();
  if (!cleanId) return prev;
  return {
    ...prev,
    profileSync: {
      ...(prev.profileSync || {}),
      [cleanId]: createProfileSyncState({ ...getProfileSyncState(prev, cleanId), ...patch }),
    },
  };
}

export function dropProfileSyncState(prev: AppState, id: string): AppState {
  const cleanId = String(id || "").trim();
  if (!cleanId) return prev;
  if (!Object.prototype.hasOwnProperty.call(prev.profileSync || {}, cleanId)) return prev;
  const next = { ...(prev.profileSync || {}) };
  delete next[cleanId];
  return { ...prev, profileSync: next };
}

export function upsertProfile(prev: AppState, profile: UserProfile, syncPatch?: Partial<ProfileSyncState>): AppState {
  const cleanId = String(profile?.id || "").trim();
  if (!cleanId) return prev;
  const next = {
    ...prev,
    profiles: {
      ...(prev.profiles || {}),
      [cleanId]: { ...(prev.profiles?.[cleanId] || { id: cleanId }), ...profile, id: cleanId },
    },
  };
  return applyProfileSyncState(
    next,
    cleanId,
    syncPatch || { loaded: true, source: "server", lastServerAt: Date.now() }
  );
}

export function mergeRosterProfiles(prev: AppState, friends: FriendEntry[]): AppState {
  let next = prev;
  for (const friend of friends || []) {
    const id = String(friend?.id || "").trim();
    if (!id) continue;
    const hasExtra =
      friend.display_name !== undefined ||
      friend.handle !== undefined ||
      friend.avatar_rev !== undefined ||
      friend.avatar_mime !== undefined;
    if (!hasExtra) continue;
    next = upsertProfile(
      next,
      {
        ...(next.profiles?.[id] || { id }),
        id,
        ...(friend.display_name === undefined ? {} : { display_name: friend.display_name }),
        ...(friend.handle === undefined ? {} : { handle: friend.handle }),
        ...(friend.avatar_rev === undefined ? {} : { avatar_rev: friend.avatar_rev }),
        ...(friend.avatar_mime === undefined ? {} : { avatar_mime: friend.avatar_mime }),
      },
      { loaded: true, source: "server", lastServerAt: Date.now() }
    );
  }
  return next;
}

export function applyRosterSnapshot(
  prev: AppState,
  payload: {
    friends: FriendEntry[];
    topPeers: TopPeerEntry[];
    pendingIn: string[];
    pendingOut: string[];
  },
  opts?: { source?: DomainSyncSource; reconcilePending?: boolean }
): AppState {
  const base = {
    ...prev,
    friends: payload.friends,
    topPeers: payload.topPeers,
    pendingIn: payload.pendingIn,
    pendingOut: payload.pendingOut,
  };
  const withProfiles = mergeRosterProfiles(base, payload.friends || []);
  return applyRosterSyncState(withProfiles, {
    loaded: true,
    source: opts?.source || "server",
    reconcilePending: Boolean(opts?.reconcilePending),
    lastServerAt: Date.now(),
  });
}

export function setFriendPresence(prev: AppState, id: string, online: boolean): AppState {
  const cleanId = String(id || "").trim();
  if (!cleanId) return prev;
  const nextFriends = prev.friends.map((f) => (f.id === cleanId ? { ...f, online } : f));
  return applyRosterSyncState({ ...prev, friends: nextFriends }, { lastPresenceAt: Date.now() });
}
