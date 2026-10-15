import { dmKey } from "../../../helpers/chat/conversationKey";
import { saveLastReadMarkers } from "../../../helpers/ui/lastReadMarkers";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface ReadReceiptsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  lastReadSentAt: Map<string, number>;
  lastReadSavedAt: Map<string, number>;
}

export interface ReadReceiptsFeature {
  maybeSendMessageRead: (peerId: string, upToId?: number | null) => void;
  maybeSendRoomRead: (roomId: string, upToId: number) => void;
}

export function createReadReceiptsFeature(deps: ReadReceiptsFeatureDeps): ReadReceiptsFeature {
  const { store, send, lastReadSentAt, lastReadSavedAt } = deps;

  const maybeSendMessageRead = (peerId: string, upToId?: number | null) => {
    const st = store.get();
    if (st.conn !== "connected") return;
    if (!st.authed) return;
    const peer = String(peerId || "").trim();
    if (!peer) return;
    const unread = st.friends.find((f) => f.id === peer)?.unread ?? 0;
    const hasUpTo = typeof upToId === "number" && Number.isFinite(upToId) && upToId > 0;
    if (unread <= 0 && !hasUpTo) return;

    const now = Date.now();
    const throttleKey = `dm:${peer}`;
    const last = lastReadSentAt.get(throttleKey) ?? 0;
    if (now - last < 300) return;
    lastReadSentAt.set(throttleKey, now);

    send({ type: "message_read", peer, ...(hasUpTo ? { up_to_id: upToId } : {}) });

    const key = dmKey(peer);
    const conv = st.conversations?.[key] || [];
    let lastInboundId = 0;
    if (unread > 0 && conv.length > 0) {
      for (let i = conv.length - 1; i >= 0; i -= 1) {
        const msg = conv[i];
        if (!msg || msg.kind !== "in") continue;
        const msgId = Number(msg.id ?? 0);
        if (Number.isFinite(msgId) && msgId > 0) {
          lastInboundId = msgId;
          break;
        }
      }
    }
    let shouldClearUnread = unread > 0;
    if (hasUpTo && unread > 0) {
      shouldClearUnread = lastInboundId > 0 && upToId >= lastInboundId;
    }

    const lastReadUpdate = (() => {
      if (!st.selfId) return null;
      if (!key) return null;
      const targetId = hasUpTo
        ? Number(upToId)
        : (() => {
            for (let i = conv.length - 1; i >= 0; i -= 1) {
              const msg = conv[i];
              if (!msg || msg.kind === "sys") continue;
              const msgId = Number(msg.id ?? 0);
              if (Number.isFinite(msgId) && msgId > 0) return msgId;
            }
            return 0;
          })();
      if (!Number.isFinite(targetId) || targetId <= 0) return null;
      const marker = st.lastRead?.[key] || {};
      const prevId = Number(marker.id ?? 0);
      const prevTs = Number(marker.ts ?? 0);
      const nextEntry: { id?: number; ts?: number } = { ...marker };
      let changed = false;
      if (prevId <= 0 || targetId > prevId) {
        nextEntry.id = targetId;
        changed = true;
      }
      let targetTs = 0;
      for (let i = conv.length - 1; i >= 0; i -= 1) {
        const msg = conv[i];
        if (!msg || msg.kind === "sys") continue;
        const msgId = Number(msg.id ?? 0);
        if (!Number.isFinite(msgId) || msgId !== targetId) continue;
        targetTs = Number(msg.ts ?? 0);
        break;
      }
      if (Number.isFinite(targetTs) && targetTs > 0 && (prevTs <= 0 || targetTs > prevTs)) {
        nextEntry.ts = targetTs;
        changed = true;
      }
      if (!changed) return null;
      const lastSave = lastReadSavedAt.get(key) ?? 0;
      if (now - lastSave < 1200) return null;
      lastReadSavedAt.set(key, now);
      return nextEntry;
    })();

    if (!shouldClearUnread && !lastReadUpdate) return;
    let savedLastRead: Record<string, any> | null = null;
    store.set((prev) => {
      let next = prev;
      let changed = false;
      if (shouldClearUnread) {
        next = { ...next, friends: next.friends.map((f) => (f.id === peer ? { ...f, unread: 0 } : f)) };
        changed = true;
      }
      if (lastReadUpdate) {
        const merged = { ...(next.lastRead || {}), [key]: lastReadUpdate };
        savedLastRead = merged;
        next = { ...next, lastRead: merged };
        changed = true;
      }
      return changed ? next : prev;
    });
    if (savedLastRead && st.selfId) {
      saveLastReadMarkers(st.selfId, savedLastRead);
    }
  };

  const maybeSendRoomRead = (roomId: string, upToId: number) => {
    const st = store.get();
    if (st.conn !== "connected") return;
    if (!st.authed) return;
    const room = String(roomId || "").trim();
    if (!room) return;
    const hasUpTo = typeof upToId === "number" && Number.isFinite(upToId) && upToId > 0;
    if (!hasUpTo) return;

    const now = Date.now();
    const throttleKey = `room:${room}`;
    const last = lastReadSentAt.get(throttleKey) ?? 0;
    if (now - last < 300) return;
    lastReadSentAt.set(throttleKey, now);

    send({ type: "message_read", room, up_to_id: upToId });
  };

  return {
    maybeSendMessageRead,
    maybeSendRoomRead,
  };
}
