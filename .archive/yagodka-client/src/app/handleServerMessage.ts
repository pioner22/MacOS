import type { GatewayTransport } from "../lib/net/gatewayClient";
import type {
  AppState,
  BoardEntry,
  ChatMessage,
  GroupEntry,
  SearchResultEntry,
} from "../stores/types";
import { dmKey, roomKey } from "../helpers/chat/conversationKey";
import { applyConversationHistorySyncState, dropConversationHistorySyncState, getConversationHistorySyncState } from "../helpers/chat/historySync";
import { deleteHistoryMessageById, ingestHistoryResult, patchHistoryMessageById } from "../helpers/chat/historyIdb";
import { removeCachedFileBlob } from "../helpers/files/fileBlobCache";
import {
  getActiveConversationTarget,
  hasActiveConversationSelection,
  isViewingDmPeer,
  isViewingRoomId,
} from "../helpers/navigation/mainConversationState";
import { nowTs } from "../helpers/time";
import { upsertConversation } from "../helpers/chat/upsertConversation";
import { removeOutboxEntry } from "../helpers/chat/outbox";
import { applyFileTransferSnapshot, applyOutboxSnapshot } from "../helpers/runtime/deliverySync";
import { saveLastReadMarkers } from "../helpers/ui/lastReadMarkers";
import { deriveServerSearchQuery } from "../helpers/search/serverSearchQuery";
import { clearStoredAvatar, getStoredAvatar, getStoredAvatarRev, storeAvatarRev, type AvatarTargetKind } from "../helpers/avatar/avatarStore";
import {
  humanizeError,
  isDocHidden,
  lastReadSavedAt,
  maybePlaySound,
  parseAttachment,
  parseMessageRef,
  showInAppNotification,
  updateFirstPendingOutgoing,
} from "./handleServerMessage/common";
import { handleActionConversationMessage } from "./handleServerMessage/actionDomain";
import { handleCoreAuthMessage } from "./handleServerMessage/coreAuth";
import { handleHistoryServerMessage } from "./handleServerMessage/history";
import { handleRosterPrefsMessage } from "./handleServerMessage/rosterPrefs";
import { handleSessionDevicesMessage } from "./handleServerMessage/sessions";
import { handleUpdateRequiredMessage } from "./handleServerMessage/updateRequired";
import { handleProfileAvatarMessage } from "./handleServerMessage/profileAvatar";

type RoomInviteActionKind = "group" | "board";

function hasOwn(payload: any, key: string): boolean {
  return Boolean(payload && Object.prototype.hasOwnProperty.call(payload, key));
}

function normalizedAvatarRev(payload: any, fallback?: number | null): number | null {
  if (!hasOwn(payload, "avatar_rev")) return fallback === undefined ? null : fallback;
  return Math.max(0, Math.trunc(Number(payload?.avatar_rev ?? 0) || 0));
}

function normalizedAvatarMime(payload: any, fallback?: string | null): string | null {
  if (!hasOwn(payload, "avatar_mime")) return fallback === undefined ? null : fallback;
  const raw = payload?.avatar_mime;
  return typeof raw === "string" && raw.trim() ? String(raw).trim() : null;
}

function syncRoomAvatarFromMeta(kind: Extract<AvatarTargetKind, "group" | "board">, id: string, payload: any, gateway: GatewayTransport): boolean {
  if (!id || !hasOwn(payload, "avatar_rev")) return false;
  const rev = normalizedAvatarRev(payload, 0) || 0;
  const mime = normalizedAvatarMime(payload, null);
  const storedRev = getStoredAvatarRev(kind, id);
  const storedUrl = getStoredAvatar(kind, id);
  if (!mime) {
    if (storedUrl || storedRev !== rev) {
      clearStoredAvatar(kind, id);
      storeAvatarRev(kind, id, rev);
      return Boolean(storedUrl);
    }
    return false;
  }
  if (storedRev !== rev || !storedUrl) gateway.send({ type: "avatar_get", kind, id });
  return false;
}

function invitePayloadRoomId(payload: any, kind: RoomInviteActionKind): string {
  if (!payload || typeof payload !== "object") return "";
  if (kind === "group") {
    if (String(payload.kind || "") !== "group_invite") return "";
    return String(payload.groupId ?? payload.group_id ?? "").trim();
  }
  if (String(payload.kind || "") !== "board_invite") return "";
  return String(payload.boardId ?? payload.board_id ?? "").trim();
}

function clearAcceptedRoomInviteActions(prev: AppState, kind: RoomInviteActionKind, roomId: string, text: string): AppState {
  const id = String(roomId || "").trim();
  if (!id) return prev;

  let conversations = prev.conversations;
  let conversationsChanged = false;
  for (const [key, conv] of Object.entries(prev.conversations || {})) {
    if (!Array.isArray(conv) || !conv.length) continue;
    let nextConv: ChatMessage[] | null = null;
    for (let idx = 0; idx < conv.length; idx += 1) {
      const msg = conv[idx];
      const payload = msg?.attachment?.kind === "action" ? msg.attachment.payload : null;
      if (invitePayloadRoomId(payload, kind) !== id) continue;
      if (!nextConv) nextConv = [...conv];
      nextConv[idx] = { ...msg, text, attachment: null };
    }
    if (!nextConv) continue;
    if (!conversationsChanged) conversations = { ...prev.conversations };
    conversations[key] = nextConv;
    conversationsChanged = true;
  }

  const modalPayload = prev.modal?.kind === "action" ? prev.modal.payload : null;
  const modal = invitePayloadRoomId(modalPayload, kind) === id ? null : prev.modal;
  if (!conversationsChanged && modal === prev.modal) return prev;
  return {
    ...prev,
    ...(conversationsChanged ? { conversations } : {}),
    ...(modal !== prev.modal ? { modal } : {}),
  };
}

export function handleServerMessage(
  msg: any,
  state: AppState,
  gateway: GatewayTransport,
  patch: (p: Partial<AppState> | ((prev: AppState) => AppState)) => void
) {
  const t = String(msg?.type ?? "");

  if (handleCoreAuthMessage(t, msg, state, gateway, patch)) return;
  if (handleRosterPrefsMessage(t, msg, state, gateway, patch)) return;
  if (handleHistoryServerMessage(t, msg, state, gateway, patch)) return;
  if (handleSessionDevicesMessage(t, msg, state, gateway, patch)) return;
  if (handleActionConversationMessage(t, msg, state, patch)) return;
  if (handleUpdateRequiredMessage(t, msg, state, patch)) return;
  if (handleProfileAvatarMessage(t, msg, state, gateway, patch)) return;
  if (t === "groups") {
    const raw = Array.isArray(msg?.groups) ? msg.groups : [];
    let avatarBumped = false;
    for (const g of raw) {
      const id = String(g?.id ?? "");
      if (syncRoomAvatarFromMeta("group", id, g, gateway)) avatarBumped = true;
    }
    patch((prev) => {
      const prevMap = new Map(prev.groups.map((g) => [g.id, g]));
      const groups: GroupEntry[] = raw
        .map((g: any) => {
          const id = String(g?.id ?? "");
          const prevEntry = prevMap.get(id);
          const hasDescription = hasOwn(g, "description");
          const hasRules = hasOwn(g, "rules");
          const avatarRev = normalizedAvatarRev(g, prevEntry?.avatar_rev ?? 0);
          const avatarMime = normalizedAvatarMime(g, prevEntry?.avatar_mime ?? null);
          const description = hasDescription ? (g?.description ?? null) : (prevEntry?.description ?? null);
          const rules = hasRules ? (g?.rules ?? null) : (prevEntry?.rules ?? null);
          const nextMembers = Array.isArray(g?.members) ? (g.members as any[]).map((m) => String(m || "").trim()).filter(Boolean) : null;
          const nextPostBanned = Array.isArray(g?.post_banned)
            ? (g.post_banned as any[]).map((m) => String(m || "").trim()).filter(Boolean)
            : null;
          return {
            id,
            name: (g?.name ?? prevEntry?.name ?? null) as any,
            owner_id: (g?.owner_id ?? prevEntry?.owner_id ?? null) as any,
            handle: (g?.handle ?? prevEntry?.handle ?? null) as any,
            description,
            rules,
            avatar_rev: avatarRev,
            avatar_mime: avatarMime,
            ...(nextMembers ? { members: nextMembers } : prevEntry?.members ? { members: prevEntry.members } : {}),
            ...(nextPostBanned ? { post_banned: nextPostBanned } : prevEntry?.post_banned ? { post_banned: prevEntry.post_banned } : {}),
          } as GroupEntry;
        })
        .filter((g: GroupEntry) => g.id);
      return { ...prev, groups, ...(avatarBumped ? { avatarsRev: (prev.avatarsRev || 0) + 1 } : {}) };
    });
    return;
  }
  if (t === "group_added" || t === "group_updated") {
    const g = msg?.group ?? null;
    const groupId = g ? String(g?.id ?? "") : "";
    const avatarBumped = syncRoomAvatarFromMeta("group", groupId, g, gateway);
    patch((prev) => {
      const id = groupId;
      if (!id) return prev;
      const hasDescription = hasOwn(g, "description");
      const hasRules = hasOwn(g, "rules");
      const hasMembers = Array.isArray(g?.members);
      const nextMembers = hasMembers ? (g.members as any[]).map((m) => String(m || "").trim()).filter(Boolean) : null;
      const hasPostBanned = Array.isArray(g?.post_banned);
      const nextPostBanned = hasPostBanned ? (g.post_banned as any[]).map((m) => String(m || "").trim()).filter(Boolean) : null;
      const prevEntry = prev.groups.find((x) => x.id === id);
      const description = hasDescription ? (g?.description ?? null) : (prevEntry?.description ?? null);
      const rules = hasRules ? (g?.rules ?? null) : (prevEntry?.rules ?? null);
      const avatarRev = normalizedAvatarRev(g, prevEntry?.avatar_rev ?? 0);
      const avatarMime = normalizedAvatarMime(g, prevEntry?.avatar_mime ?? null);
      const upd: GroupEntry = {
        id,
        name: (g?.name ?? prevEntry?.name ?? null) as any,
        owner_id: (g?.owner_id ?? prevEntry?.owner_id ?? null) as any,
        handle: (g?.handle ?? prevEntry?.handle ?? null) as any,
        description,
        rules,
        avatar_rev: avatarRev,
        avatar_mime: avatarMime,
        ...(hasMembers ? { members: nextMembers || [] } : prevEntry?.members ? { members: prevEntry.members } : {}),
        ...(hasPostBanned ? { post_banned: nextPostBanned || [] } : prevEntry?.post_banned ? { post_banned: prevEntry.post_banned } : {}),
      };
      const next = prev.groups.filter((x) => x.id !== upd.id);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      const base = clearAcceptedRoomInviteActions(prev, "group", upd.id, `Приглашение принято: ${upd.id}`);
      return { ...base, groups: next, pendingGroupInvites: base.pendingGroupInvites.filter((inv) => inv.groupId !== upd.id), ...(avatarBumped ? { avatarsRev: (base.avatarsRev || 0) + 1 } : {}) };
    });
    return;
  }
  if (t === "group_info_result") {
    const ok = Boolean(msg?.ok);
    const g = msg?.group ?? null;
    const gid = String(g?.id ?? msg?.group_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason || "ошибка");
      patch({ status: `Не удалось получить чат: ${reason}` });
      return;
    }
    if (!gid) return;
    const avatarBumped = syncRoomAvatarFromMeta("group", gid, g, gateway);
    const members = Array.isArray(g?.members) ? g.members.map((m: any) => String(m || "").trim()).filter(Boolean) : [];
    const postBanned = Array.isArray(g?.post_banned) ? g.post_banned.map((m: any) => String(m || "").trim()).filter(Boolean) : [];
    patch((prev) => {
      const prevEntry = prev.groups.find((x) => x.id === gid);
      const hasDescription = hasOwn(g, "description");
      const hasRules = hasOwn(g, "rules");
      const avatarRev = normalizedAvatarRev(g, prevEntry?.avatar_rev ?? 0);
      const avatarMime = normalizedAvatarMime(g, prevEntry?.avatar_mime ?? null);
      const upd: GroupEntry = {
        id: gid,
        name: (g?.name ?? prevEntry?.name ?? null) as any,
        owner_id: (g?.owner_id ?? prevEntry?.owner_id ?? null) as any,
        handle: (g?.handle ?? prevEntry?.handle ?? null) as any,
        description: (hasDescription ? g?.description : prevEntry?.description) as any,
        rules: (hasRules ? g?.rules : prevEntry?.rules) as any,
        avatar_rev: avatarRev,
        avatar_mime: avatarMime,
        members,
        post_banned: postBanned,
      };
      const next = prev.groups.filter((x) => x.id !== gid);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, groups: next, ...(avatarBumped ? { avatarsRev: (prev.avatarsRev || 0) + 1 } : {}) };
    });
    return;
  }
  if (t === "group_post_set_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    const member = String(msg?.member_id ?? "").trim();
    const value = Boolean(msg?.value);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_args"
          ? "Некорректные данные"
          : reason === "forbidden_or_not_found"
            ? "Только владелец может менять права"
            : reason === "not_in_group"
              ? "Пользователь не найден в чате"
              : "Не удалось изменить права";
      patch({ status: `Изменение прав не выполнено: ${message}` });
      return;
    }
    if (!gid || !member) return;
    patch((prev) => {
      const prevEntry = prev.groups.find((x) => x.id === gid);
      if (!prevEntry) return prev;
      const nextBanned = new Set((prevEntry.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean));
      if (value) nextBanned.add(member);
      else nextBanned.delete(member);
      const upd: GroupEntry = { ...prevEntry, post_banned: Array.from(nextBanned) };
      const next = prev.groups.filter((x) => x.id !== gid);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, groups: next, status: value ? `Запрещено писать: ${member}` : `Разрешено писать: ${member}` };
    });
    return;
  }
  if (t === "group_post_update") {
    const gid = String(msg?.group_id ?? "").trim();
    const member = String(msg?.member_id ?? "").trim();
    const value = Boolean(msg?.value);
    if (!gid || !member) return;
    patch((prev) => {
      const prevEntry = prev.groups.find((x) => x.id === gid);
      if (!prevEntry) return prev;
      const nextBanned = new Set((prevEntry.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean));
      if (value) nextBanned.add(member);
      else nextBanned.delete(member);
      const upd: GroupEntry = { ...prevEntry, post_banned: Array.from(nextBanned) };
      const next = prev.groups.filter((x) => x.id !== gid);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, groups: next };
    });
    return;
  }
  if (t === "group_removed") {
    const id = String(msg?.id ?? msg?.group_id ?? "");
    if (!id) return;
    const by = String(msg?.by ?? "").trim();
    const name = String(msg?.name ?? "").trim();
    const label = name ? `${name} (${id})` : id;
    const key = roomKey(id);
    patch((prev) => {
      const sel = prev.selected;
      const selectedRemoved = Boolean(sel && sel.kind === "group" && sel.id === id);
      const next = selectedRemoved
        ? dropConversationHistorySyncState(
            {
              ...prev,
              conversations: Object.fromEntries(Object.entries(prev.conversations).filter(([entryKey]) => entryKey !== key)),
            },
            key
          )
        : prev;
      return {
        ...next,
        groups: prev.groups.filter((g) => g.id !== id),
        selected: selectedRemoved ? null : prev.selected,
        status: by ? `Удалены из чата: ${label} (by ${by})` : `Удалены из чата: ${label}`,
      };
    });
    return;
  }
  if (t === "boards") {
    const raw = Array.isArray(msg?.boards) ? msg.boards : [];
    let avatarBumped = false;
    for (const b of raw) {
      const id = String(b?.id ?? "");
      if (syncRoomAvatarFromMeta("board", id, b, gateway)) avatarBumped = true;
    }
    const boards: BoardEntry[] = raw
      .map((b: any) => {
        const hasDescription = hasOwn(b, "description");
        const hasRules = hasOwn(b, "rules");
        return {
          id: String(b?.id ?? ""),
          name: (b?.name ?? null) as any,
          owner_id: (b?.owner_id ?? null) as any,
          handle: (b?.handle ?? null) as any,
          description: (hasDescription ? b?.description : null) as any,
          rules: (hasRules ? b?.rules : null) as any,
          avatar_rev: normalizedAvatarRev(b, 0),
          avatar_mime: normalizedAvatarMime(b, null),
          ...(Array.isArray(b?.members)
            ? { members: (b.members as any[]).map((m) => String(m || "").trim()).filter(Boolean) }
            : {}),
        };
      })
      .filter((b: BoardEntry) => b.id);
    patch((prev) => ({ ...prev, boards, ...(avatarBumped ? { avatarsRev: (prev.avatarsRev || 0) + 1 } : {}) }));
    return;
  }
  if (t === "board_added" || t === "board_updated") {
    const b = msg?.board ?? null;
    const boardId = b ? String(b?.id ?? "") : "";
    const avatarBumped = syncRoomAvatarFromMeta("board", boardId, b, gateway);
    patch((prev) => {
      const id = boardId;
      if (!id) return prev;
      const hasDescription = hasOwn(b, "description");
      const hasRules = hasOwn(b, "rules");
      const hasMembers = Array.isArray(b?.members);
      const nextMembers = hasMembers ? (b.members as any[]).map((m) => String(m || "").trim()).filter(Boolean) : null;
      const prevEntry = prev.boards.find((x) => x.id === id);
      const description = hasDescription ? (b?.description ?? null) : (prevEntry?.description ?? null);
      const rules = hasRules ? (b?.rules ?? null) : (prevEntry?.rules ?? null);
      const avatarRev = normalizedAvatarRev(b, prevEntry?.avatar_rev ?? 0);
      const avatarMime = normalizedAvatarMime(b, prevEntry?.avatar_mime ?? null);
      const upd: BoardEntry = {
        id,
        name: (b?.name ?? prevEntry?.name ?? null) as any,
        owner_id: (b?.owner_id ?? prevEntry?.owner_id ?? null) as any,
        handle: (b?.handle ?? prevEntry?.handle ?? null) as any,
        description,
        rules,
        avatar_rev: avatarRev,
        avatar_mime: avatarMime,
        ...(hasMembers ? { members: nextMembers || [] } : prevEntry?.members ? { members: prevEntry.members } : {}),
      };
      const next = prev.boards.filter((x) => x.id !== upd.id);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      const base = clearAcceptedRoomInviteActions(prev, "board", upd.id, `Приглашение принято: ${upd.id}`);
      return { ...base, boards: next, pendingBoardInvites: base.pendingBoardInvites.filter((inv) => inv.boardId !== upd.id), ...(avatarBumped ? { avatarsRev: (base.avatarsRev || 0) + 1 } : {}) };
    });
    return;
  }
  if (t === "board_info_result") {
    const ok = Boolean(msg?.ok);
    const b = msg?.board ?? null;
    const bid = String(b?.id ?? msg?.board_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason || "ошибка");
      patch({ status: `Не удалось получить доску: ${reason}` });
      return;
    }
    if (!bid) return;
    const avatarBumped = syncRoomAvatarFromMeta("board", bid, b, gateway);
    const members = Array.isArray(b?.members) ? b.members.map((m: any) => String(m || "").trim()).filter(Boolean) : [];
    patch((prev) => {
      const prevEntry = prev.boards.find((x) => x.id === bid);
      const hasDescription = hasOwn(b, "description");
      const hasRules = hasOwn(b, "rules");
      const avatarRev = normalizedAvatarRev(b, prevEntry?.avatar_rev ?? 0);
      const avatarMime = normalizedAvatarMime(b, prevEntry?.avatar_mime ?? null);
      const upd: BoardEntry = {
        id: bid,
        name: (b?.name ?? prevEntry?.name ?? null) as any,
        owner_id: (b?.owner_id ?? prevEntry?.owner_id ?? null) as any,
        handle: (b?.handle ?? prevEntry?.handle ?? null) as any,
        description: (hasDescription ? b?.description : prevEntry?.description) as any,
        rules: (hasRules ? b?.rules : prevEntry?.rules) as any,
        avatar_rev: avatarRev,
        avatar_mime: avatarMime,
        members,
      };
      const next = prev.boards.filter((x) => x.id !== bid);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, boards: next, ...(avatarBumped ? { avatarsRev: (prev.avatarsRev || 0) + 1 } : {}) };
    });
    return;
  }
  if (t === "board_removed") {
    const id = String(msg?.id ?? msg?.board_id ?? "");
    if (!id) return;
    const by = String(msg?.by ?? "").trim();
    const name = String(msg?.name ?? "").trim();
    const label = name ? `${name} (${id})` : id;
    const key = roomKey(id);
    patch((prev) => {
      const sel = prev.selected;
      const selectedRemoved = Boolean(sel && sel.kind === "board" && sel.id === id);
      const next = selectedRemoved
        ? dropConversationHistorySyncState(
            {
              ...prev,
              conversations: Object.fromEntries(Object.entries(prev.conversations).filter(([entryKey]) => entryKey !== key)),
            },
            key
          )
        : prev;
      return {
        ...next,
        boards: prev.boards.filter((b) => b.id !== id),
        selected: selectedRemoved ? null : prev.selected,
        status: by ? `Удалены из доски: ${label} (by ${by})` : `Удалены из доски: ${label}`,
      };
    });
    return;
  }
  if (t === "group_rename_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "not_authenticated"
          ? "Нужно авторизоваться"
          : reason === "rate_limited"
            ? "Слишком часто. Попробуйте позже"
            : reason === "bad_args"
              ? "Некорректные данные"
              : reason === "name_too_long"
                ? "Название слишком длинное"
                : reason === "forbidden_or_not_found"
                  ? "Только владелец может переименовать чат"
                  : "Не удалось переименовать чат";
      patch((prev) => ({
        ...prev,
        modal: prev.modal?.kind === "rename" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? { ...prev.modal, message } : prev.modal,
        status: `Переименование не выполнено: ${message}`,
      }));
      return;
    }
    const name = String(msg?.name ?? "").trim();
    patch((prev) => ({
      ...prev,
      modal: prev.modal?.kind === "rename" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? null : prev.modal,
      status: name ? `Чат переименован: ${name}` : "Чат переименован",
    }));
    return;
  }
  if (t === "group_set_info_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? msg?.group?.id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "not_authenticated"
          ? "Нужно авторизоваться"
          : reason === "rate_limited"
            ? "Слишком часто. Попробуйте позже"
            : reason === "bad_gid"
              ? "Некорректный ID чата"
              : reason === "description_too_long"
                ? "Описание слишком длинное"
                : reason === "rules_too_long"
                  ? "Правила слишком длинные"
                  : reason === "forbidden_or_not_found"
                    ? "Только владелец может менять информацию"
                    : "Не удалось обновить информацию";
      patch({ status: `Обновление не выполнено: ${message}` });
      return;
    }
    const g = msg?.group ?? null;
    if (g?.id) {
      const avatarBumped = syncRoomAvatarFromMeta("group", String(g?.id ?? ""), g, gateway);
      patch((prev) => {
        const id = String(g?.id ?? "");
        if (!id) return prev;
        const prevEntry = prev.groups.find((x) => x.id === id);
        const hasDescription = hasOwn(g, "description");
        const hasRules = hasOwn(g, "rules");
        const upd: GroupEntry = {
          id,
          name: (g?.name ?? prevEntry?.name ?? null) as any,
          owner_id: (g?.owner_id ?? prevEntry?.owner_id ?? null) as any,
          handle: (g?.handle ?? prevEntry?.handle ?? null) as any,
          description: (hasDescription ? g?.description : prevEntry?.description) as any,
          rules: (hasRules ? g?.rules : prevEntry?.rules) as any,
          avatar_rev: normalizedAvatarRev(g, prevEntry?.avatar_rev ?? 0),
          avatar_mime: normalizedAvatarMime(g, prevEntry?.avatar_mime ?? null),
          members: prevEntry?.members,
          post_banned: prevEntry?.post_banned,
        };
        const next = prev.groups.filter((x) => x.id !== upd.id);
        next.push(upd);
        next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
        return { ...prev, groups: next, status: "Информация чата обновлена", ...(avatarBumped ? { avatarsRev: (prev.avatarsRev || 0) + 1 } : {}) };
      });
      return;
    }
    patch({ status: gid ? `Информация чата обновлена: ${gid}` : "Информация чата обновлена" });
    return;
  }
  if (t === "board_rename_result") {
    const ok = Boolean(msg?.ok);
    const bid = String(msg?.board_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "not_authenticated"
          ? "Нужно авторизоваться"
          : reason === "rate_limited"
            ? "Слишком часто. Попробуйте позже"
            : reason === "bad_args"
              ? "Некорректные данные"
              : reason === "name_too_long"
                ? "Название слишком длинное"
                : reason === "forbidden_or_not_found"
                  ? "Только владелец может переименовать доску"
                  : "Не удалось переименовать доску";
      patch((prev) => ({
        ...prev,
        modal: prev.modal?.kind === "rename" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? { ...prev.modal, message } : prev.modal,
        status: `Переименование не выполнено: ${message}`,
      }));
      return;
    }
    const name = String(msg?.name ?? "").trim();
    patch((prev) => ({
      ...prev,
      modal: prev.modal?.kind === "rename" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? null : prev.modal,
      status: name ? `Доска переименована: ${name}` : "Доска переименована",
    }));
    return;
  }
  if (t === "board_set_info_result") {
    const ok = Boolean(msg?.ok);
    const bid = String(msg?.board_id ?? msg?.board?.id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "not_authenticated"
          ? "Нужно авторизоваться"
          : reason === "rate_limited"
            ? "Слишком часто. Попробуйте позже"
            : reason === "bad_id"
              ? "Некорректный ID доски"
              : reason === "description_too_long"
                ? "Описание слишком длинное"
                : reason === "rules_too_long"
                  ? "Правила слишком длинные"
                  : reason === "forbidden_or_not_found"
                    ? "Только владелец может менять информацию"
                    : "Не удалось обновить информацию";
      patch({ status: `Обновление не выполнено: ${message}` });
      return;
    }
    const b = msg?.board ?? null;
    if (b?.id) {
      const avatarBumped = syncRoomAvatarFromMeta("board", String(b?.id ?? ""), b, gateway);
      patch((prev) => {
        const id = String(b?.id ?? "");
        if (!id) return prev;
        const prevEntry = prev.boards.find((x) => x.id === id);
        const hasDescription = hasOwn(b, "description");
        const hasRules = hasOwn(b, "rules");
        const upd: BoardEntry = {
          id,
          name: (b?.name ?? prevEntry?.name ?? null) as any,
          owner_id: (b?.owner_id ?? prevEntry?.owner_id ?? null) as any,
          handle: (b?.handle ?? prevEntry?.handle ?? null) as any,
          description: (hasDescription ? b?.description : prevEntry?.description) as any,
          rules: (hasRules ? b?.rules : prevEntry?.rules) as any,
          avatar_rev: normalizedAvatarRev(b, prevEntry?.avatar_rev ?? 0),
          avatar_mime: normalizedAvatarMime(b, prevEntry?.avatar_mime ?? null),
          members: prevEntry?.members,
        };
        const next = prev.boards.filter((x) => x.id !== upd.id);
        next.push(upd);
        next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
        return { ...prev, boards: next, status: "Информация доски обновлена", ...(avatarBumped ? { avatarsRev: (prev.avatarsRev || 0) + 1 } : {}) };
      });
      return;
    }
    patch({ status: bid ? `Информация доски обновлена: ${bid}` : "Информация доски обновлена" });
    return;
  }
  if (t === "group_disband_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Чат не удалён: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const gid = String(msg?.group_id ?? "").trim();
    patch({ status: gid ? `Чат удалён: ${gid}` : "Чат удалён" });
    return;
  }
  if (t === "board_disband_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Доска не удалена: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const bid = String(msg?.board_id ?? "").trim();
    patch({ status: bid ? `Доска удалена: ${bid}` : "Доска удалена" });
    return;
  }
  if (t === "group_remove_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_args"
          ? "Некорректные данные"
          : reason === "forbidden_or_not_found"
            ? "Только владелец может удалять участников"
            : reason === "no_members"
              ? "Не найдено подходящих участников"
              : "Не удалось удалить участников";
      patch((prev) => ({
        ...prev,
        modal: prev.modal?.kind === "members_remove" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? { ...prev.modal, message } : prev.modal,
        status: `Удаление не выполнено: ${message}`,
      }));
      return;
    }
    const removed = (Array.isArray(msg?.removed) ? msg.removed : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const preview = removed.length <= 3 ? removed.join(", ") : `${removed.slice(0, 3).join(", ")}…`;
    patch((prev) => ({
      ...prev,
      modal: prev.modal?.kind === "members_remove" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? null : prev.modal,
      status: removed.length ? `Удалены из чата: ${removed.length} (${preview})` : "Удаление выполнено",
    }));
    return;
  }
  if (t === "board_remove_result") {
    const ok = Boolean(msg?.ok);
    const bid = String(msg?.board_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_args"
          ? "Некорректные данные"
          : reason === "forbidden_or_not_found"
            ? "Только владелец может удалять участников"
            : reason === "no_members"
              ? "Не найдено подходящих участников"
              : "Не удалось удалить участников";
      patch((prev) => ({
        ...prev,
        modal: prev.modal?.kind === "members_remove" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? { ...prev.modal, message } : prev.modal,
        status: `Удаление не выполнено: ${message}`,
      }));
      return;
    }
    const removed = (Array.isArray(msg?.removed) ? msg.removed : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const preview = removed.length <= 3 ? removed.join(", ") : `${removed.slice(0, 3).join(", ")}…`;
    patch((prev) => ({
      ...prev,
      modal: prev.modal?.kind === "members_remove" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? null : prev.modal,
      status: removed.length ? `Удалены из доски: ${removed.length} (${preview})` : "Удаление выполнено",
    }));
    return;
  }
  if (t === "group_create_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "empty_name"
          ? "Введите название чата"
          : reason === "name_too_long"
            ? "Название слишком длинное"
            : reason === "description_too_long"
              ? "Описание слишком длинное"
              : reason === "rules_too_long"
                ? "Правила слишком длинные"
            : reason === "rate_limited"
              ? "Слишком часто. Попробуйте позже"
              : reason === "not_authenticated"
                ? "Нужно авторизоваться"
                : "Не удалось создать чат";
      patch((prev) => ({
        ...prev,
        groupCreateMessage: prev.page === "group_create" ? message : prev.groupCreateMessage,
        status: `Чат не создан: ${message}`,
      }));
      return;
    }
    const g = msg?.group ?? null;
    if (g?.id) {
      patch((prev) => ({
        ...prev,
        groups: [
          ...prev.groups.filter((x) => x.id !== String(g.id)),
          {
            id: String(g.id),
            name: g.name ?? null,
            owner_id: g.owner_id ?? null,
            handle: g.handle ?? null,
            description: g.description ?? null,
            rules: g.rules ?? null,
          },
        ],
        groupCreateMessage: "",
        page: prev.page === "group_create" ? "main" : prev.page,
        status: `Чат создан: ${String(g.name || g.id)}`,
      }));
    }
    return;
  }
  if (t === "board_create_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "empty_name"
          ? "Введите название доски"
          : reason === "name_too_long"
            ? "Название слишком длинное"
            : reason === "description_too_long"
              ? "Описание слишком длинное"
              : reason === "rules_too_long"
                ? "Правила слишком длинные"
            : reason === "handle_invalid"
              ? "Некорректный хэндл"
              : reason === "handle_taken"
                ? "Хэндл уже занят"
                : reason === "rate_limited"
                  ? "Слишком часто. Попробуйте позже"
                  : reason === "not_authenticated"
                    ? "Нужно авторизоваться"
                    : "Не удалось создать доску";
      patch((prev) => ({
        ...prev,
        boardCreateMessage: prev.page === "board_create" ? message : prev.boardCreateMessage,
        status: `Доска не создана: ${message}`,
      }));
      return;
    }
    const b = msg?.board ?? null;
    if (b?.id) {
      patch((prev) => ({
        ...prev,
        boards: [
          ...prev.boards.filter((x) => x.id !== String(b.id)),
          {
            id: String(b.id),
            name: b.name ?? null,
            owner_id: b.owner_id ?? null,
            handle: b.handle ?? null,
            description: b.description ?? null,
            rules: b.rules ?? null,
          },
        ],
        boardCreateMessage: "",
        page: prev.page === "board_create" ? "main" : prev.page,
        status: `Доска создана: ${String(b.name || b.id)}`,
      }));
    }
    return;
  }
  if (t === "group_add_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_gid"
          ? "Некорректный ID чата"
          : reason === "not_found"
            ? "Чат не найден"
            : reason === "forbidden"
              ? "Только владелец может добавлять участников"
              : "Не удалось отправить приглашения";
      patch((prev) => ({
        ...prev,
        modal:
          prev.modal?.kind === "members_add" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid)
            ? { ...prev.modal, message }
            : prev.modal,
        status: `Приглашения не отправлены: ${message}`,
      }));
      return;
    }
    const invited = (Array.isArray(msg?.invited) ? msg.invited : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    if (!invited.length) {
      const message = "Не найдено подходящих пользователей (существующие + дружба)";
      patch((prev) => ({
        ...prev,
        modal:
          prev.modal?.kind === "members_add" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid)
            ? { ...prev.modal, message }
            : prev.modal,
        status: message,
      }));
      return;
    }
    const preview = invited.length <= 3 ? invited.join(", ") : `${invited.slice(0, 3).join(", ")}…`;
    patch((prev) => ({
      ...prev,
      modal:
        prev.modal?.kind === "members_add" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? null : prev.modal,
      status: `Приглашены в чат: ${invited.length} (${preview})`,
    }));
    return;
  }
  if (t === "board_add_result") {
    const ok = Boolean(msg?.ok);
    const bid = String(msg?.board_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_id"
          ? "Некорректный ID доски"
          : reason === "forbidden_or_not_found"
            ? "Только владелец может добавлять участников"
            : reason === "no_members"
              ? "Не найдено подходящих пользователей"
              : "Не удалось добавить участников";
      patch((prev) => ({
        ...prev,
        modal:
          prev.modal?.kind === "members_add" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid)
            ? { ...prev.modal, message }
            : prev.modal,
        status: `Добавление не выполнено: ${message}`,
      }));
      return;
    }
    const added = (Array.isArray(msg?.added) ? msg.added : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const preview = !added.length ? "" : added.length <= 3 ? added.join(", ") : `${added.slice(0, 3).join(", ")}…`;
    patch((prev) => ({
      ...prev,
      modal:
        prev.modal?.kind === "members_add" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? null : prev.modal,
      status: added.length ? `Добавлены в доску: ${added.length} (${preview})` : "Добавление выполнено",
    }));
    return;
  }
  if (t === "board_join_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Не удалось вступить: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const bid = String(msg?.board_id ?? "");
    if (bid) patch({ status: `Вступление: ${bid}` });
    return;
  }
  if (t === "search_result") {
    const q = String(msg?.query ?? "").trim();
    const expected = deriveServerSearchQuery(state.searchQuery)?.query ?? null;
    if (!expected || q !== expected) {
      // Ignore stale/out-of-order search results (keeps UI consistent with current input).
      return;
    }
    const raw = Array.isArray(msg?.results) ? msg.results : [];
    const results: SearchResultEntry[] = raw
      .map((r: any) => ({
        id: String(r?.id ?? ""),
        name: r?.name == null ? undefined : String(r.name),
        handle: r?.handle == null ? undefined : String(r.handle),
        online: r?.online === undefined ? undefined : Boolean(r.online),
        friend: r?.friend === undefined ? undefined : Boolean(r.friend),
        group: r?.group === undefined ? undefined : Boolean(r.group),
        board: r?.board === undefined ? undefined : Boolean(r.board),
      }))
      .filter((r: SearchResultEntry) => r.id);
    patch({ searchResults: results, status: results.length ? `Найдено: ${results.length}` : "Ничего не найдено" });
    return;
  }
  if (t === "message") {
    const from = String(msg?.from ?? "");
    const to = msg?.to ? String(msg.to) : undefined;
    const room = msg?.room ? String(msg.room) : undefined;
    const text = String(msg?.text ?? "");
    const ts = Number(msg?.ts ?? nowTs()) || nowTs();
    const edited = Boolean(msg?.edited);
    const editedTsRaw = (msg as any)?.edited_ts;
    const edited_ts = typeof editedTsRaw === "number" && Number.isFinite(editedTsRaw) ? editedTsRaw : undefined;
    const key = room ? roomKey(room) : dmKey(from === state.selfId ? String(to ?? "") : from);
    if (!key || key.endsWith(":")) return;
    const kind = from === state.selfId ? "out" : "in";
    const deliveredId = typeof msg?.id === "number" && Number.isFinite(msg.id) ? Math.trunc(msg.id) : null;
    const attachment = parseAttachment(msg?.attachment);
    const reply = parseMessageRef((msg as any)?.reply);
    const forward = parseMessageRef((msg as any)?.forward);
    if (kind === "in") {
      const hidden = isDocHidden();
      const viewingSame = Boolean((room && isViewingRoomId(state, room)) || (!room && isViewingDmPeer(state, from)));
      const profile = state.profiles?.[from];
      let fromLabel = String(profile?.display_name || "").trim();
      if (!fromLabel) {
        const handle = String(profile?.handle || "").trim();
        fromLabel = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : from;
      }
      let title = `Сообщение от ${fromLabel || from}`;
      let body = String(text || "").trim();
      if (!body) {
        if (attachment?.kind === "file") body = `Файл: ${attachment.name || "файл"}`;
        else body = "Новое сообщение";
      }
      if (room) {
        const group = (state.groups || []).find((g) => g.id === room);
        const board = !group ? (state.boards || []).find((b) => b.id === room) : null;
        const roomLabel = group ? String(group.name || group.id) : board ? String(board.name || board.id) : room;
        title = group ? `Чат: ${roomLabel}` : board ? `Доска: ${roomLabel}` : `Чат: ${roomLabel}`;
        if (fromLabel) body = `${fromLabel}: ${body}`;
      }
      const idKey =
        typeof msg?.id === "number" && Number.isFinite(msg.id) ? String(Math.trunc(msg.id)) : String(Math.round(ts || nowTs()));
      const notifKey = room ? `message:room:${room}:${idKey}` : `message:dm:${from}:${idKey}`;
      showInAppNotification(state, notifKey, title, body, room ? `yagodka:room:${room}` : `yagodka:dm:${from}`);
      maybePlaySound(state, "message", notifKey, hidden || !viewingSame);
    }
    const chatMessage: ChatMessage = {
      kind,
      from,
      to,
      room,
      text,
      ts,
      id: msg?.id ?? null,
      attachment,
      ...(reply ? { reply } : {}),
      ...(forward ? { forward } : {}),
      ...(edited ? { edited: true } : {}),
      ...(edited && edited_ts ? { edited_ts } : {}),
    };
    patch((prev) => upsertConversation(prev, key, chatMessage));
    try {
      void ingestHistoryResult(state.selfId, key, [chatMessage], {
        beforeId: null,
        hasMore: null,
        preview: false,
        sinceId: null,
      });
    } catch {
      // ignore
    }

    // delivered_to_device: подтверждаем факт доставки события на устройство (DM).
    if (!room && kind === "in" && deliveredId !== null) {
      gateway.send({ type: "message_delivered_to_device", peer: from, id: deliveredId });
    }

    // If we're actively viewing this DM, mark as read immediately to keep unread counters consistent.
    if (!room && kind === "in" && isViewingDmPeer(state, from)) {
      const upToId = typeof msg?.id === "number" ? msg.id : undefined;
      gateway.send({ type: "message_read", peer: from, ...(upToId === undefined ? {} : { up_to_id: upToId }) });
      const key = dmKey(from);
      const now = Date.now();
      const lastSave = lastReadSavedAt.get(key) ?? 0;
      if (now - lastSave < 1200) {
        patch((prev) => {
          const hadUnread = (prev.friends || []).some((friend) => friend.id === from && Number(friend.unread || 0) > 0);
          if (!hadUnread) return prev;
          return { ...prev, friends: prev.friends.map((friend) => (friend.id === from ? { ...friend, unread: 0 } : friend)) };
        });
      } else {
        lastReadSavedAt.set(key, now);
        patch((prev) => {
          let nextState = prev;
          const hadUnread = (prev.friends || []).some((friend) => friend.id === from && Number(friend.unread || 0) > 0);
          if (hadUnread) {
            nextState = { ...nextState, friends: nextState.friends.map((friend) => (friend.id === from ? { ...friend, unread: 0 } : friend)) };
          }
          if (!prev.selfId) return nextState;
          const marker = prev.lastRead?.[key] || {};
          const nextEntry = { ...marker };
          let changed = false;
          if (upToId !== undefined) {
            const id = Number(upToId);
            if (Number.isFinite(id) && id > 0 && (!marker.id || id > marker.id)) {
              nextEntry.id = id;
              changed = true;
            }
          }
          const tsNum = Number(ts ?? 0);
          if (Number.isFinite(tsNum) && tsNum > 0 && (!marker.ts || tsNum > marker.ts)) {
            nextEntry.ts = tsNum;
            changed = true;
          }
          if (!changed) return nextState;
          const merged = { ...(nextState.lastRead || {}), [key]: nextEntry };
          saveLastReadMarkers(prev.selfId, merged);
          return { ...nextState, lastRead: merged };
        });
      }
    }
    return;
  }
  if (t === "message_delivered") {
    const to = msg?.to ? String(msg.to) : undefined;
    const room = msg?.room ? String(msg.room) : undefined;
    const key = room ? roomKey(room) : to ? dmKey(to) : "";
    if (!key) return;
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null;
    patch((prev) => {
      const curOutbox = ((prev as any).outbox || {}) as any;
      const conv = prev.conversations[key];
      if (id !== null && Array.isArray(conv) && conv.length) {
        const idx = conv.findIndex((m) => m.kind === "out" && typeof m.id === "number" && m.id === id);
        if (idx >= 0) {
          const cur = conv[idx];
          const next = [...conv];
          const candidate: ChatMessage["status"] = room ? "delivered" : "sent";
          const status: ChatMessage["status"] =
            cur.status === "read" || cur.status === "delivered" ? cur.status : candidate;
          next[idx] = { ...cur, status };
          const lid = typeof cur.localId === "string" && cur.localId.trim() ? cur.localId.trim() : null;
          const outbox = lid ? removeOutboxEntry(curOutbox, key, lid) : curOutbox;
          return applyOutboxSnapshot(
            { ...prev, conversations: { ...prev.conversations, [key]: next } },
            outbox,
            { source: "server", reconcilePending: false }
          );
        }
      }
      const updated = updateFirstPendingOutgoing(prev, key, (msg) => ({ ...msg, id, status: room ? "delivered" : "sent" }));
      const nextOutbox = ((updated.state as any).outbox || curOutbox) as any;
      const outbox = updated.localId ? removeOutboxEntry(nextOutbox, key, updated.localId) : nextOutbox;
      return applyOutboxSnapshot(updated.state, outbox, { source: "server", reconcilePending: false });
    });
    return;
  }
  if (t === "message_delivered_to_device") {
    const to = msg?.to ? String(msg.to) : undefined;
    const room = msg?.room ? String(msg.room) : undefined;
    if (room) return;
    if (!to) return;
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null;
    if (id === null) return;
    const key = dmKey(to);
    patch((prev) => {
      const conv = prev.conversations[key];
      if (!Array.isArray(conv) || !conv.length) return prev;
      const idx = conv.findIndex((m) => m.kind === "out" && typeof m.id === "number" && m.id === id);
      if (idx < 0) return prev;
      const cur = conv[idx] as ChatMessage;
      if (cur.status === "read" || cur.status === "delivered") return prev;
      const next = [...conv];
      next[idx] = { ...cur, status: "delivered" as const };
      return { ...prev, conversations: { ...prev.conversations, [key]: next } };
    });
    return;
  }
  if (t === "message_deleted") {
    const ok = msg?.ok;
    if (ok === false) {
      const reason = String(msg?.reason ?? "ошибка");
      patch({ status: `Не удалось удалить сообщение: ${reason}` });
      return;
    }
    const from = String(msg?.from ?? "");
    const to = msg?.to ? String(msg.to) : undefined;
    const room = msg?.room ? String(msg.room) : undefined;
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null;
    if (id === null) return;
    const key = room ? roomKey(room) : dmKey(from === state.selfId ? String(to ?? "") : from);
    if (!key) return;
    let detachedFileId: string | null = null;
    patch((prev) => {
      const conv = prev.conversations[key];
      if (!Array.isArray(conv) || !conv.length) return prev;
      const deletedMsg = conv.find((m) => m.id === id) || null;
      const nextConv = conv.filter((m) => m.id !== id);
      if (nextConv.length === conv.length) return prev;
      const pinnedIds = prev.pinnedMessages[key];
      const hadPinned = Array.isArray(pinnedIds) && pinnedIds.includes(id);
      const nextPinned = hadPinned ? { ...prev.pinnedMessages } : prev.pinnedMessages;
      const nextActive = hadPinned ? { ...prev.pinnedMessageActive } : prev.pinnedMessageActive;
      if (hadPinned) {
        const nextList = pinnedIds.filter((x) => x !== id);
        if (nextList.length) {
          nextPinned[key] = nextList;
          if (nextActive[key] === id || !nextList.includes(nextActive[key])) nextActive[key] = nextList[0];
        } else {
          delete nextPinned[key];
          delete nextActive[key];
        }
      }
      let nextTransfers = prev.fileTransfers;
      let nextThumbs = prev.fileThumbs;
      const removedFileId =
        deletedMsg?.attachment?.kind === "file" && typeof deletedMsg.attachment.fileId === "string"
          ? deletedMsg.attachment.fileId.trim()
          : "";
      if (removedFileId) {
        let stillReferenced = false;
        for (const [convKey, messages] of Object.entries(prev.conversations)) {
          const list = convKey === key ? nextConv : messages;
          if (!Array.isArray(list) || !list.length) continue;
          if (
            list.some(
              (m) => m?.attachment?.kind === "file" && String(m.attachment?.fileId || "").trim() === removedFileId
            )
          ) {
            stillReferenced = true;
            break;
          }
        }
        if (!stillReferenced) {
          detachedFileId = removedFileId;
          nextTransfers = prev.fileTransfers.filter((entry) => {
            const match = String(entry.id || "").trim() === removedFileId;
            if (!match) return true;
            if (entry.url && entry.url.startsWith("blob:")) {
              try {
                URL.revokeObjectURL(entry.url);
              } catch {
                // ignore
              }
            }
            return false;
          });
          const existingThumb = prev.fileThumbs?.[removedFileId] || null;
          if (existingThumb) {
            if (existingThumb.url) {
              try {
                URL.revokeObjectURL(existingThumb.url);
              } catch {
                // ignore
              }
            }
            nextThumbs = { ...(prev.fileThumbs || {}) };
            delete nextThumbs[removedFileId];
          }
        }
      }
      let next = applyFileTransferSnapshot(
        {
          ...prev,
          conversations: { ...prev.conversations, [key]: nextConv },
          fileThumbs: nextThumbs,
          pinnedMessages: nextPinned,
          pinnedMessageActive: nextActive,
        },
        nextTransfers,
        { source: "server", reconcilePending: false }
      );
      if (!nextConv.length) {
        const prevSync = getConversationHistorySyncState(prev, key);
        const hasOlderHistory = prevSync.hasMore === true || (prevSync.cursor !== null && prevSync.hasMore !== false);
        if (hasOlderHistory) return next;
        const deletedBy = String(from || "").trim();
        next = applyConversationHistorySyncState(next, key, {
          loaded: true,
          previewOnly: false,
          cursor: null,
          hasMore: false,
          loading: false,
          loadingSlots: 0,
          source: "server",
          reconcilePending: false,
          lastServerAt: Date.now(),
          emptyNotice: {
            kind: "message_deleted",
            scope: room ? "room" : "dm",
            by: deletedBy || null,
            at: Date.now(),
            deleted: 1,
          },
        });
      }
      if (prev.editing && prev.editing.key === key && prev.editing.id === id) {
        return { ...next, editing: null, input: prev.editing.prevDraft || "" };
      }
      return next;
    });
    patch({ status: "Сообщение удалено" });
    try {
      void deleteHistoryMessageById(state.selfId, id);
    } catch {
      // ignore
    }
    try {
      const uid = String(state.selfId || "").trim();
      const fid = String(detachedFileId || "").trim();
      if (uid && fid) {
        void removeCachedFileBlob(uid, fid);
        void removeCachedFileBlob(uid, `thumb:${fid}`);
      }
    } catch {
      // ignore
    }
    return;
  }
  if (t === "message_edited") {
    const ok = msg?.ok;
    if (ok === false) {
      const reason = String(msg?.reason ?? "ошибка");
      patch({ status: `Не удалось изменить сообщение: ${reason}` });
      return;
    }
    const from = String(msg?.from ?? "").trim();
    const to = msg?.to ? String(msg.to).trim() : "";
    const room = msg?.room ? String(msg.room).trim() : "";
    const text = String(msg?.text ?? "");
    const editedTsRaw = (msg as any)?.edited_ts;
    const edited_ts = typeof editedTsRaw === "number" && Number.isFinite(editedTsRaw) ? editedTsRaw : undefined;
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null;
    if (id === null) return;
    let didUpdate = false;
    patch((prev) => {
      const conversations = (prev as any).conversations || {};
      const candidates: string[] = [];
      if (room) candidates.push(roomKey(room));
      if (!room) {
        const selfId = String((prev as any).selfId ?? "").trim();
        const peer = selfId && from && from === selfId ? to : from;
        if (peer) candidates.push(dmKey(peer));
      }
      const selected = (prev as any).selected;
      const selectedKey = selected ? (selected.kind === "dm" ? dmKey(String(selected.id || "")) : roomKey(String(selected.id || ""))) : "";
      if (selectedKey && !candidates.includes(selectedKey)) candidates.push(selectedKey);

      const tryUpdate = (key: string): AppState | null => {
        const k = String(key || "").trim();
        if (!k) return null;
        const conv = conversations[k];
        if (!Array.isArray(conv) || !conv.length) return null;
        const idx = conv.findIndex((m) => typeof m?.id === "number" && m.id === id);
        if (idx < 0) return null;
        const next = [...conv];
        const cur = next[idx];
        next[idx] = { ...cur, text, edited: true, ...(edited_ts ? { edited_ts } : {}) };
        didUpdate = true;
        return { ...(prev as any), conversations: { ...conversations, [k]: next } } as AppState;
      };

      for (const k of candidates) {
        const next = tryUpdate(k);
        if (next) return next;
      }

      // Fallback: routing metadata может отсутствовать, но msg_id глобально уникален — найдём по всем чатам.
      for (const [k, conv] of Object.entries(conversations)) {
        if (!Array.isArray(conv) || !conv.length) continue;
        const idx = (conv as any[]).findIndex((m) => typeof m?.id === "number" && m.id === id);
        if (idx < 0) continue;
        const nextConv = [...(conv as any[])];
        const cur = nextConv[idx];
        nextConv[idx] = { ...cur, text, edited: true, ...(edited_ts ? { edited_ts } : {}) };
        didUpdate = true;
        return { ...(prev as any), conversations: { ...conversations, [k]: nextConv } } as AppState;
      }

      return prev;
    });
    patch({ status: didUpdate ? "Сообщение изменено" : "Сообщение изменено (обновится после синхронизации)" });
    if (didUpdate) {
      try {
        void patchHistoryMessageById(state.selfId, id, (prev) => ({
          ...prev,
          text,
          edited: true,
          ...(edited_ts ? { edited_ts } : {}),
        }));
      } catch {
        // ignore
      }
    }
    return;
  }
  if (t === "message_queued") {
    const to = msg?.to ? String(msg.to) : undefined;
    if (!to) return;
    const id = msg?.id ?? null;
    const key = dmKey(to);
    patch((prev) => {
      const curOutbox = ((prev as any).outbox || {}) as any;
      const updated = updateFirstPendingOutgoing(prev, key, (msg) => ({ ...msg, id, status: "queued" }));
      const nextOutbox = ((updated.state as any).outbox || curOutbox) as any;
      const outbox = updated.localId ? removeOutboxEntry(nextOutbox, key, updated.localId) : nextOutbox;
      return applyOutboxSnapshot(updated.state, outbox, { source: "server", reconcilePending: false });
    });
    return;
  }
  if (t === "message_blocked") {
    const to = String(msg?.to ?? "");
    const reason = String(msg?.reason ?? "blocked");
    if (!to) return;
    patch({ status: `Сообщение не отправлено: ${reason}` });
    const key = dmKey(to);
    patch((prev) => {
      const curOutbox = ((prev as any).outbox || {}) as any;
      const updated = updateFirstPendingOutgoing(prev, key, (msg) => ({ ...msg, status: "error" }));
      const nextOutbox = ((updated.state as any).outbox || curOutbox) as any;
      const outbox = updated.localId ? removeOutboxEntry(nextOutbox, key, updated.localId) : nextOutbox;
      return applyOutboxSnapshot(updated.state, outbox, { source: "server", reconcilePending: false });
    });
    patch((prev) =>
      upsertConversation(prev, dmKey(to), { kind: "sys", from: "", to, text: `[blocked] ${reason}`, ts: nowTs(), id: null })
    );
    return;
  }
  if (t === "message_read_ack") {
    const peer = String(msg?.peer ?? "").trim();
    const rawUpTo = msg?.up_to_id;
    const upTo = typeof rawUpTo === "number" && Number.isFinite(rawUpTo) ? rawUpTo : null;
    if (!peer) return;
    patch((prev) => {
      const key = dmKey(peer);
      const conv = prev.conversations[key];
      if (!conv || conv.length === 0) return prev;
      let changed = false;
      const next = conv.map((m) => {
        if (m.kind !== "out") return m;
        if (m.id === undefined || m.id === null) return m;
        if (upTo !== null && Number(m.id) > upTo) return m;
        if (m.status === "read") return m;
        changed = true;
        return { ...m, status: "read" as const };
      });
      if (!changed) return prev;
      return { ...prev, conversations: { ...prev.conversations, [key]: next } };
    });
    return;
  }
  if (t === "reaction_update") {
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : Number(rawId);
    if (!Number.isFinite(id) || id <= 0) return;
    const room = msg?.room ? String(msg.room).trim() : "";
    const peer = msg?.peer ? String(msg.peer).trim() : "";
    const actor = String(msg?.user ?? "").trim();
    const rawEmoji = (msg as any)?.emoji;
    const emoji = typeof rawEmoji === "string" && rawEmoji.trim() ? String(rawEmoji) : null;

    const countsRaw = (msg as any)?.counts;
    if (!countsRaw || typeof countsRaw !== "object") return;
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(countsRaw as Record<string, unknown>)) {
      const e = String(k || "").trim();
      const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : Math.trunc(Number(v) || 0);
      if (!e || n <= 0) continue;
      counts[e] = n;
    }

    patch((prev) => {
      const conversations = (prev as any).conversations || {};
      const candidates: string[] = [];
      if (room) candidates.push(roomKey(room));
      if (peer) candidates.push(dmKey(peer));
      const selected = (prev as any).selected;
      const selectedKey = selected ? (selected.kind === "dm" ? dmKey(String(selected.id || "")) : roomKey(String(selected.id || ""))) : "";
      if (selectedKey && !candidates.includes(selectedKey)) candidates.push(selectedKey);

      const applyToKey = (key: string): AppState | null => {
        const k = String(key || "").trim();
        if (!k) return null;
        const conv = conversations[k];
        if (!Array.isArray(conv) || !conv.length) return null;
        const idx = conv.findIndex((m) => typeof m?.id === "number" && m.id === id);
        if (idx < 0) return null;
        const next = [...conv];
        const cur = next[idx] as any;
        const prevReacts = (cur as any).reactions && typeof (cur as any).reactions === "object" ? (cur as any).reactions : null;
        const prevMine = prevReacts && typeof prevReacts.mine === "string" ? String(prevReacts.mine) : null;
        const selfId = String((prev as any).selfId ?? "").trim();
        const mine = selfId && actor && actor === selfId ? emoji : prevMine;
        const nextReacts = Object.keys(counts).length || mine !== null ? ({ counts, mine } as any) : null;
        next[idx] = { ...cur, reactions: nextReacts };
        return { ...(prev as any), conversations: { ...conversations, [k]: next } } as AppState;
      };

      for (const k of candidates) {
        const next = applyToKey(k);
        if (next) return next;
      }

      // Fallback: msg_id глобально уникален — найдём по всем чатам.
      for (const [k, conv] of Object.entries(conversations)) {
        if (!Array.isArray(conv) || !conv.length) continue;
        const idx = (conv as any[]).findIndex((m) => typeof m?.id === "number" && m.id === id);
        if (idx < 0) continue;
        const nextConv = [...(conv as any[])];
        const cur = nextConv[idx];
        const prevReacts = (cur as any).reactions && typeof (cur as any).reactions === "object" ? (cur as any).reactions : null;
        const prevMine = prevReacts && typeof prevReacts.mine === "string" ? String(prevReacts.mine) : null;
        const selfId = String((prev as any).selfId ?? "").trim();
        const mine = selfId && actor && actor === selfId ? emoji : prevMine;
        const nextReacts = Object.keys(counts).length || mine !== null ? ({ counts, mine } as any) : null;
        nextConv[idx] = { ...(cur as any), reactions: nextReacts };
        return { ...(prev as any), conversations: { ...conversations, [k]: nextConv } } as AppState;
      }

      return prev;
    });
    try {
      void patchHistoryMessageById(state.selfId, id, (prev) => {
        const prevMine = prev.reactions && typeof prev.reactions === "object" && typeof prev.reactions.mine === "string" ? prev.reactions.mine : null;
        const selfId = String(state.selfId ?? "").trim();
        const mine = selfId && actor && actor === selfId ? emoji : prevMine;
        const nextReacts = Object.keys(counts).length || mine !== null ? { counts, ...(mine !== null ? { mine } : {}) } : null;
        return { ...prev, reactions: nextReacts };
      });
    } catch {
      // ignore
    }
    return;
  }
  if (t === "history_result") {
    return;
  }
  if (t === "error") {
    const raw = String(msg?.message ?? "error");
    const friendly = humanizeError(raw);
    patch({ status: `Ошибка: ${friendly}` });

    const sel = getActiveConversationTarget(state);
    if (sel && hasActiveConversationSelection(state)) {
      const sendRelated = new Set([
        "not_in_group",
        "board_post_forbidden",
        "board_check_failed",
        "group_check_failed",
        "broadcast_disabled",
        "message_too_long",
        "bad_text",
        "bad_recipient",
        "rate_limited",
      ]);
      if (sendRelated.has(raw)) {
        const key = sel.kind === "dm" ? dmKey(sel.id) : roomKey(sel.id);
        patch((prev) => {
          const curOutbox = ((prev as any).outbox || {}) as any;
          const updated = updateFirstPendingOutgoing(prev, key, (msg) => ({ ...msg, status: "error" }));
          const nextOutbox = ((updated.state as any).outbox || curOutbox) as any;
          const outbox = updated.localId ? removeOutboxEntry(nextOutbox, key, updated.localId) : nextOutbox;
          return applyOutboxSnapshot(updated.state, outbox, { source: "server", reconcilePending: false });
        });
        patch((prev) =>
          upsertConversation(prev, key, {
            kind: "sys",
            from: "",
            ...(sel.kind === "dm" ? { to: sel.id } : { room: sel.id }),
            text: `[ошибка] ${friendly}`,
            ts: nowTs(),
            id: null,
          })
        );
      }
    }
    return;
  }

  // noop for now
  void gateway;
}
