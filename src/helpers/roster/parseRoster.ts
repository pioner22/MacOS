import type { FriendEntry, TopPeerEntry } from "../../stores/types";

export function parseRoster(msg: any): {
  friends: FriendEntry[];
  pendingIn: string[];
  pendingOut: string[];
  topPeers: TopPeerEntry[];
} {
  const friendsRaw = Array.isArray(msg?.friends) ? msg.friends : [];
  const onlineRaw = Array.isArray(msg?.online) ? msg.online : [];
  const onlineSet = new Set(onlineRaw.map((x: any) => String(x)).filter(Boolean));
  const topPeersRaw = Array.isArray(msg?.top_peers) ? msg.top_peers : [];

  const friends: FriendEntry[] = friendsRaw
    .map((x: any) => {
      if (typeof x === "string") {
        return { id: x, online: onlineSet.has(x), unread: 0, last_seen_at: null };
      }
      const id = String(x?.id ?? "");
      return {
        id,
        online: Boolean(x?.online) || onlineSet.has(id),
        unread: Number(x?.unread ?? 0) || 0,
        last_seen_at: (x?.last_seen_at ?? null) as any,
        display_name: (x?.display_name ?? null) as any,
        handle: (x?.handle ?? null) as any,
        avatar_rev: x?.avatar_rev === undefined ? undefined : (Number(x?.avatar_rev ?? 0) || 0),
        avatar_mime: (x?.avatar_mime ?? null) as any,
      };
    })
    .filter((x: FriendEntry) => x.id);
  const pendingIn = (Array.isArray(msg?.pending_in) ? msg.pending_in : []).map((x: any) => String(x)).filter(Boolean);
  const pendingOut = (Array.isArray(msg?.pending_out) ? msg.pending_out : []).map((x: any) => String(x)).filter(Boolean);
  const topPeers: TopPeerEntry[] = topPeersRaw
    .map((x: any) => {
      const id = String(x?.id ?? "").trim();
      if (!id) return null;
      const lastTs = typeof x?.last_ts === "number" ? Number(x.last_ts) : null;
      return {
        id,
        last_ts: lastTs,
        msg_count: Number(x?.msg_count ?? 0) || 0,
      };
    })
    .filter(Boolean) as TopPeerEntry[];
  return { friends, pendingIn, pendingOut, topPeers };
}
