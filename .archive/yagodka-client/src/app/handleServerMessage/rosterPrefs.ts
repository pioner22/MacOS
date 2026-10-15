import type { GatewayTransport } from "../../lib/net/gatewayClient";
import type { AppState, ConversationHistoryEmptyNotice, FriendEntry } from "../../stores/types";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { clearHistoryConvo } from "../../helpers/chat/historyIdb";
import { applyConversationHistorySyncState } from "../../helpers/chat/historySync";
import { applyRosterSnapshot, applyRosterSyncState, setFriendPresence } from "../../helpers/roster/rosterSync";
import { clearStoredAvatar, getStoredAvatar, getStoredAvatarRev, storeAvatarRev } from "../../helpers/avatar/avatarStore";
import { sanitizeArchived, saveArchivedForUser } from "../../helpers/chat/archives";
import { sanitizeChatFoldersSnapshot, saveChatFoldersForUser } from "../../helpers/chat/folders";
import { sanitizePins, savePinsForUser } from "../../helpers/chat/pins";
import { parseRoster } from "../../helpers/roster/parseRoster";
import { applySidebarFolderSnapshot } from "../../helpers/sidebar/sidebarState";
import { saveLastReadMarkers } from "../../helpers/ui/lastReadMarkers";
import { prefsBootstrapDoneForUser, sysActionMessage, upsertConversationByLocalId } from "./common";

function clearEventEmptyNotice(msg: any, scope: ConversationHistoryEmptyNotice["scope"]): ConversationHistoryEmptyNotice {
  const by = typeof msg?.by === "string" ? msg.by.trim() : "";
  const deletedRaw = Number(msg?.deleted ?? 0);
  const deleted = Number.isFinite(deletedRaw) && deletedRaw > 0 ? Math.trunc(deletedRaw) : null;
  return {
    kind: "cleared",
    scope,
    by: by || null,
    at: Date.now(),
    deleted,
  };
}

export function handleRosterPrefsMessage(
  t: string,
  msg: any,
  state: AppState,
  gateway: GatewayTransport,
  patch: (p: Partial<AppState> | ((prev: AppState) => AppState)) => void
): boolean {
  if (t === "roster_full" || t === "roster") {
    const r = parseRoster(msg);
    let avatarChanged = false;
    for (const f of r.friends) {
      const id = String(f?.id ?? "").trim();
      if (!id) continue;
      const rev = typeof (f as any).avatar_rev === "number" ? Math.max(0, Math.trunc((f as any).avatar_rev)) : 0;
      const mimeRaw = (f as any).avatar_mime;
      const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? String(mimeRaw).trim() : null;
      const storedUrl = getStoredAvatar("dm", id);
      const storedRev = getStoredAvatarRev("dm", id);
      const hasAvatar = Boolean(mime);

      if (!hasAvatar) {
        if (storedUrl) {
          clearStoredAvatar("dm", id);
          storeAvatarRev("dm", id, rev);
          avatarChanged = true;
        } else if (storedRev !== rev) {
          storeAvatarRev("dm", id, rev);
        }
        continue;
      }
      if (storedRev !== rev || !storedUrl) {
        gateway.send({ type: "avatar_get", id });
      }
    }

    patch((prev) => {
      let nextState: any = applyRosterSnapshot(
        prev,
        {
          friends: r.friends,
          topPeers: r.topPeers,
          pendingIn: r.pendingIn,
          pendingOut: r.pendingOut,
        },
        { source: "server", reconcilePending: false }
      );
      if (avatarChanged) nextState = { ...nextState, avatarsRev: (prev.avatarsRev || 0) + 1 };
      for (const peer of r.pendingIn) {
        const id = String(peer || "").trim();
        if (!id) continue;
        const localId = `action:auth_in:${id}`;
        nextState = upsertConversationByLocalId(
          nextState,
          dmKey(id),
          sysActionMessage(id, `Входящий запрос на контакт: ${id}`, { kind: "auth_in", peer: id }, localId),
          localId
        );
      }
      for (const peer of r.pendingOut) {
        const id = String(peer || "").trim();
        if (!id) continue;
        const localId = `action:auth_out:${id}`;
        nextState = upsertConversationByLocalId(
          nextState,
          dmKey(id),
          sysActionMessage(id, `Ожидает подтверждения: ${id}`, { kind: "auth_out", peer: id }, localId),
          localId
        );
      }
      return nextState;
    });
    return true;
  }
  if (t === "friends") {
    const raw = Array.isArray(msg?.friends) ? msg.friends : [];
    const ids: string[] = raw.map((x: any) => String(x || "").trim()).filter((x: string) => Boolean(x));
    patch((prev) => {
      const byId = new Map<string, FriendEntry>(prev.friends.map((f) => [f.id, f]));
      const next: FriendEntry[] = ids.map((id) => byId.get(id) ?? { id, online: false, unread: 0, last_seen_at: null });
      next.sort((a: FriendEntry, b: FriendEntry) => a.id.localeCompare(b.id));
      return applyRosterSyncState({ ...prev, friends: next }, { loaded: true, source: "server", lastServerAt: Date.now() });
    });
    return true;
  }
  if (t === "prefs") {
    const muted = (Array.isArray(msg?.muted) ? msg.muted : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const blocked = (Array.isArray(msg?.blocked) ? msg.blocked : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const blockedBy = (Array.isArray(msg?.blocked_by) ? msg.blocked_by : [])
      .map((x: any) => String(x || "").trim())
      .filter(Boolean);

    const uid = String(state.selfId || "").trim();
    const hasPins = Object.prototype.hasOwnProperty.call(msg || {}, "chat_pins");
    const hasArchived = Object.prototype.hasOwnProperty.call(msg || {}, "chat_archived");
    const hasFolders = Object.prototype.hasOwnProperty.call(msg || {}, "chat_folders");

    patch((prev) => {
      const nextPatch: any = applyRosterSyncState(
        {
          ...prev,
          muted,
          blocked,
          blockedBy,
        },
        {
          loaded: true,
          source: "server",
          lastServerAt: Date.now(),
        }
      );
      if (hasPins) {
        const pins = sanitizePins((msg as any).chat_pins);
        nextPatch.pinned = pins;
        if (uid) savePinsForUser(uid, pins);
      }
      if (hasArchived) {
        const archived = sanitizeArchived((msg as any).chat_archived);
        nextPatch.archived = archived;
        if (uid) saveArchivedForUser(uid, archived);
      }
      if (hasFolders) {
        const snap = sanitizeChatFoldersSnapshot((msg as any).chat_folders);
        Object.assign(nextPatch, applySidebarFolderSnapshot(nextPatch, snap, { source: "server", reconcilePending: false }));
        if (uid) saveChatFoldersForUser(uid, snap);
      }
      return nextPatch;
    });

    // One-time bootstrap: migrate local chatlist prefs -> server prefs, if server has no value yet.
    if (uid && !prefsBootstrapDoneForUser.has(uid)) {
      prefsBootstrapDoneForUser.add(uid);
      const values: any = {};
      if (!hasPins && Array.isArray(state.pinned) && state.pinned.length) values.chat_pins = sanitizePins(state.pinned);
      if (!hasArchived && Array.isArray(state.archived) && state.archived.length) values.chat_archived = sanitizeArchived(state.archived);
      if (
        !hasFolders &&
        (Array.isArray((state as any).chatFolders) ? (state as any).chatFolders.length : false ||
          String((state as any).sidebarFolderId || "") !== "all")
      ) {
        values.chat_folders = sanitizeChatFoldersSnapshot({ v: 1, active: (state as any).sidebarFolderId, folders: (state as any).chatFolders });
      }
      if (Object.keys(values).length) {
        gateway.send({ type: "prefs_set", values });
      }
    }
    return true;
  }
  if (t === "mute_set_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    const value = Boolean(msg?.value);
    if (!peer) return true;
    if (!ok) {
      patch({ status: `Не удалось изменить mute: ${peer}` });
      return true;
    }
    patch((prev) => ({
      ...applyRosterSyncState(
        {
          ...prev,
          muted: value ? Array.from(new Set([...prev.muted, peer])) : prev.muted.filter((x) => x !== peer),
        },
        { loaded: true, source: "server", lastServerAt: Date.now() }
      ),
      status: value ? `Заглушено: ${peer}` : `Звук включён: ${peer}`,
    }));
    return true;
  }
  if (t === "block_set_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    const value = Boolean(msg?.value);
    if (!peer) return true;
    if (!ok) {
      patch({ status: `Не удалось изменить блокировку: ${peer}` });
      return true;
    }
    patch((prev) => ({
      ...applyRosterSyncState(
        {
          ...prev,
          blocked: value ? Array.from(new Set([...prev.blocked, peer])) : prev.blocked.filter((x) => x !== peer),
        },
        { loaded: true, source: "server", lastServerAt: Date.now() }
      ),
      status: value ? `Заблокировано: ${peer}` : `Разблокировано: ${peer}`,
    }));
    return true;
  }
  if (t === "blocked_by_update") {
    const peer = String(msg?.peer ?? "").trim();
    const value = Boolean(msg?.value);
    if (!peer) return true;
    patch((prev) => ({
      ...applyRosterSyncState(
        {
          ...prev,
          blockedBy: value ? Array.from(new Set([...prev.blockedBy, peer])) : prev.blockedBy.filter((x) => x !== peer),
        },
        { loaded: true, source: "server", lastServerAt: Date.now() }
      ),
      status: value ? `Вы заблокированы пользователем: ${peer}` : `Разблокировано пользователем: ${peer}`,
    }));
    return true;
  }
  if (t === "chat_cleared") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    if (!peer) return true;
    if (!ok) {
      patch({ status: `Не удалось очистить историю: ${peer}` });
      return true;
    }
    patch((prev) => {
      const key = dmKey(peer);
      if (prev.selfId) void clearHistoryConvo(prev.selfId, key);
      const conversations = { ...prev.conversations };
      delete conversations[key];
      const pinnedMessages = { ...prev.pinnedMessages };
      delete pinnedMessages[key];
      const pinnedMessageActive = { ...prev.pinnedMessageActive };
      delete pinnedMessageActive[key];
      const next = applyConversationHistorySyncState(
        {
          ...prev,
          conversations,
          pinnedMessages,
          pinnedMessageActive,
        },
        key,
        {
          loaded: true,
          previewOnly: false,
          cursor: null,
          hasMore: false,
          loading: false,
          loadingSlots: 0,
          virtualStart: 0,
          source: "server",
          reconcilePending: false,
          lastServerAt: Date.now(),
          emptyNotice: clearEventEmptyNotice(msg, "dm"),
        }
      );
      const selfId = String(prev.selfId || "").trim();
      const by = String((msg as any)?.by || "").trim();
      const remote = Boolean(by && selfId && by !== selfId);
      return {
        ...next,
        friends: prev.friends.map((f) => (f.id === peer ? { ...f, unread: 0 } : f)),
        status: remote ? `История очищена собеседником: ${peer}` : `История очищена: ${peer}`,
      };
    });
    return true;
  }
  if (t === "room_cleared") {
    const ok = Boolean(msg?.ok);
    const room = String(msg?.room ?? "").trim();
    if (!room) return true;
    if (!ok) {
      patch({ status: `Не удалось очистить историю: ${room}` });
      return true;
    }
    patch((prev) => {
      const key = roomKey(room);
      if (prev.selfId) void clearHistoryConvo(prev.selfId, key);
      const conversations = { ...prev.conversations };
      delete conversations[key];
      const pinnedMessages = { ...prev.pinnedMessages };
      delete pinnedMessages[key];
      const pinnedMessageActive = { ...prev.pinnedMessageActive };
      delete pinnedMessageActive[key];
      const next = applyConversationHistorySyncState(
        {
          ...prev,
          conversations,
          pinnedMessages,
          pinnedMessageActive,
        },
        key,
        {
          loaded: true,
          previewOnly: false,
          cursor: null,
          hasMore: false,
          loading: false,
          loadingSlots: 0,
          virtualStart: 0,
          source: "server",
          reconcilePending: false,
          lastServerAt: Date.now(),
          emptyNotice: clearEventEmptyNotice(msg, "room"),
        }
      );
      const selfId = String(prev.selfId || "").trim();
      const by = String((msg as any)?.by || "").trim();
      const remote = Boolean(by && selfId && by !== selfId);
      return {
        ...next,
        status: remote ? `История очищена участником: ${room}` : `История очищена: ${room}`,
      };
    });
    return true;
  }
  if (t === "friend_remove_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    if (!peer) return true;
    patch({ status: ok ? `Контакт удалён: ${peer}` : `Не удалось удалить контакт: ${peer}` });
    return true;
  }
  if (t === "presence_update") {
    const id = String(msg?.id ?? "");
    if (!id) return true;
    const online = Boolean(msg?.online);
    patch((prev) => setFriendPresence(prev, id, online));
    return true;
  }
  if (t === "unread_counts") {
    const raw = msg?.counts && typeof msg.counts === "object" ? msg.counts : {};
    patch((prev) => ({
      ...prev,
      // `counts` is an authoritative snapshot; absent keys mean 0 unread.
      friends: prev.friends.map((f) => {
        const activeDm = prev.page === "main" && prev.selected?.kind === "dm" && prev.selected.id === f.id;
        return { ...f, unread: activeDm ? 0 : Number((raw as any)[f.id] ?? 0) || 0 };
      }),
    }));
    return true;
  }
  if (t === "room_reads") {
    const raw = msg?.reads && typeof msg.reads === "object" ? msg.reads : {};
    patch((prev) => {
      const next = { ...(prev.lastRead || {}) };
      let changed = false;
      for (const [roomId, rawId] of Object.entries(raw as Record<string, unknown>)) {
        const id = Number(rawId);
        if (!Number.isFinite(id) || id <= 0) continue;
        const key = roomKey(String(roomId));
        const prevEntry = next[key] || {};
        if (prevEntry.id && id <= prevEntry.id) continue;
        next[key] = { ...prevEntry, id };
        changed = true;
      }
      if (!changed) return prev;
      if (prev.selfId) saveLastReadMarkers(prev.selfId, next);
      return { ...prev, lastRead: next };
    });
    return true;
  }

  return false;
}
