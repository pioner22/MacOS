import type { ActionModalBoardInvite, ActionModalGroupInvite, ActionModalGroupJoinRequest, AppState } from "../../stores/types";
import { dmKey } from "../../helpers/chat/conversationKey";
import { isViewingDmPeer } from "../../helpers/navigation/mainConversationState";
import {
  isDocHidden,
  maybePlaySound,
  showInAppNotification,
  sysActionMessage,
  updateConversationByLocalId,
  upsertConversationByLocalId,
} from "./common";

type PatchFn = (patch: Partial<AppState> | ((prev: AppState) => AppState)) => void;

function resolvePeerLabel(state: AppState, peer: string): string {
  const profile = state.profiles?.[peer];
  const displayName = profile?.display_name ? String(profile.display_name).trim() : "";
  const handleRaw = profile?.handle ? String(profile.handle).trim() : "";
  const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
  return displayName || handle || peer;
}

function isViewingPeerDm(state: AppState, peer: string): boolean {
  return isViewingDmPeer(state, peer);
}

export function handleActionConversationMessage(t: string, msg: any, state: AppState, patch: PatchFn): boolean {
  if (t === "authz_pending") {
    const raw = Array.isArray(msg?.from) ? msg.from : [];
    const pending = raw.map((x: any) => String(x || "").trim()).filter(Boolean);
    if (!pending.length) return true;
    patch((prev) => {
      const prevPending = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      let nextState: any = {
        ...prev,
        pendingIn: Array.from(new Set([...prevPending, ...pending])),
        status: `Ожидают авторизации: ${pending.length}`,
      };
      for (const peer of pending) {
        const localId = `action:auth_in:${peer}`;
        nextState = upsertConversationByLocalId(
          nextState,
          dmKey(peer),
          sysActionMessage(peer, `Входящий запрос на контакт: ${peer}`, { kind: "auth_in", peer }, localId),
          localId
        );
      }
      return nextState;
    });
    return true;
  }

  if (t === "authz_request") {
    const from = String(msg?.from ?? "").trim();
    if (!from) return true;
    const note = String(msg?.note ?? "").trim();
    const hidden = isDocHidden();
    const notifKey = `authz_request:${from}:${note ? note.slice(0, 60) : ""}`;
    const fromLabel = resolvePeerLabel(state, from);
    showInAppNotification(
      state,
      notifKey,
      "Запрос авторизации",
      note ? `${fromLabel}: ${note}` : `От: ${fromLabel}`,
      `yagodka:authz_request:${from}`
    );
    maybePlaySound(state, "auth", notifKey, hidden || !isViewingPeerDm(state, from));
    patch((prev) => {
      const prevPending = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const nextPending = prevPending.includes(from) ? prevPending : [...prevPending, from];
      const localId = `action:auth_in:${from}`;
      let nextState: any = { ...prev, pendingIn: nextPending, status: `Входящий запрос: ${from}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(from),
        sysActionMessage(from, `Входящий запрос на контакт: ${from}`, { kind: "auth_in", peer: from }, localId),
        localId
      );
      return nextState;
    });
    return true;
  }

  if (t === "authz_request_result") {
    const ok = Boolean(msg?.ok);
    const to = String(msg?.to ?? "").trim();
    if (!ok) {
      patch({ status: `Запрос не отправлен: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    if (!to) return true;
    patch((prev) => {
      const prevPending = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
      const nextPending = prevPending.includes(to) ? prevPending : [...prevPending, to];
      const localId = `action:auth_out:${to}`;
      let nextState: any = { ...prev, pendingOut: nextPending, status: `Запрос отправлен: ${to}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(to),
        sysActionMessage(to, `Запрос на контакт отправлен: ${to}`, { kind: "auth_out", peer: to }, localId),
        localId
      );
      return nextState;
    });
    return true;
  }

  if (t === "authz_response_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    if (!ok) {
      patch({ status: `Ответ не принят: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    if (!peer) return true;
    patch((prev) => {
      const prevPending = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const nextPending = prevPending.filter((id: string) => id !== peer);
      const localId = `action:auth_in:${peer}`;
      let nextState: any = { ...prev, pendingIn: nextPending, status: `Ответ отправлен: ${peer}` };
      nextState = updateConversationByLocalId(nextState, dmKey(peer), localId, (m) => ({ ...m, text: `Ответ отправлен: ${peer}`, attachment: null }));
      return nextState;
    });
    return true;
  }

  if (t === "authz_cancel_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    if (!ok) {
      patch({ status: `Отмена не удалась: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    if (!peer) return true;
    patch((prev) => {
      const prevPending = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
      const nextPending = prevPending.filter((id: string) => id !== peer);
      const localId = `action:auth_out:${peer}`;
      let nextState: any = { ...prev, pendingOut: nextPending, status: `Отмена запроса: ${peer}` };
      nextState = updateConversationByLocalId(nextState, dmKey(peer), localId, (m) => ({ ...m, text: `Запрос отменён: ${peer}`, attachment: null }));
      return nextState;
    });
    return true;
  }

  if (t === "authz_accepted") {
    const id = String(msg?.id ?? "").trim();
    if (!id) return true;
    patch((prev) => {
      const prevIn = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const prevOut = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
      let nextState: any = {
        ...prev,
        pendingIn: prevIn.filter((x: string) => x !== id),
        pendingOut: prevOut.filter((x: string) => x !== id),
        status: `Запрос принят: ${id}`,
      };
      nextState = updateConversationByLocalId(nextState, dmKey(id), `action:auth_in:${id}`, (m) => ({ ...m, text: `Запрос принят: ${id}`, attachment: null }));
      nextState = updateConversationByLocalId(nextState, dmKey(id), `action:auth_out:${id}`, (m) => ({ ...m, text: `Запрос принят: ${id}`, attachment: null }));
      return nextState;
    });
    return true;
  }

  if (t === "authz_declined") {
    const id = String(msg?.id ?? "").trim();
    if (!id) return true;
    patch((prev) => {
      const prevIn = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const prevOut = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
      let nextState: any = {
        ...prev,
        pendingIn: prevIn.filter((x: string) => x !== id),
        pendingOut: prevOut.filter((x: string) => x !== id),
        status: `Запрос отклонён: ${id}`,
      };
      nextState = updateConversationByLocalId(nextState, dmKey(id), `action:auth_in:${id}`, (m) => ({ ...m, text: `Запрос отклонён: ${id}`, attachment: null }));
      nextState = updateConversationByLocalId(nextState, dmKey(id), `action:auth_out:${id}`, (m) => ({ ...m, text: `Запрос отклонён: ${id}`, attachment: null }));
      return nextState;
    });
    return true;
  }

  if (t === "authz_cancelled") {
    const peer = String(msg?.peer ?? "").trim();
    if (!peer) return true;
    patch((prev) => {
      const prevIn = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const prevOut = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
      let nextState: any = {
        ...prev,
        pendingIn: prevIn.filter((x: string) => x !== peer),
        pendingOut: prevOut.filter((x: string) => x !== peer),
        status: `Запрос отменён: ${peer}`,
      };
      nextState = updateConversationByLocalId(nextState, dmKey(peer), `action:auth_in:${peer}`, (m) => ({ ...m, text: `Запрос отменён: ${peer}`, attachment: null }));
      nextState = updateConversationByLocalId(nextState, dmKey(peer), `action:auth_out:${peer}`, (m) => ({ ...m, text: `Запрос отменён: ${peer}`, attachment: null }));
      return nextState;
    });
    return true;
  }

  if (t === "group_invite") {
    const group = msg?.group ?? null;
    const groupId = String(msg?.group_id ?? group?.id ?? "").trim();
    const from = String(msg?.from ?? "").trim();
    if (!groupId || !from) return true;
    const label = String(msg?.name ?? group?.name ?? msg?.handle ?? group?.handle ?? groupId).trim() || groupId;
    const notifKey = `group_invite:${groupId}:${from}`;
    showInAppNotification(state, notifKey, `Приглашение в чат: ${label}`, `От: ${resolvePeerLabel(state, from)}`, `yagodka:group_invite:${groupId}:${from}`);
    maybePlaySound(state, "invite", notifKey, isDocHidden() || !isViewingPeerDm(state, from));
    const entry: ActionModalGroupInvite = {
      kind: "group_invite",
      groupId,
      from,
      name: (msg?.name ?? group?.name ?? null) as any,
      handle: (msg?.handle ?? group?.handle ?? null) as any,
      description: (msg?.description ?? group?.description ?? null) as any,
      rules: (msg?.rules ?? group?.rules ?? null) as any,
    };
    patch((prev) => {
      const prevInv = Array.isArray((prev as any).pendingGroupInvites) ? (prev as any).pendingGroupInvites : [];
      const pendingGroupInvites = prevInv.some((inv: any) => inv.groupId === groupId && inv.from === from) ? prevInv : [...prevInv, entry];
      const localId = `action:group_invite:${groupId}:${from}`;
      let nextState: any = { ...prev, pendingGroupInvites, status: `Приглашение в чат: ${String(entry.name || entry.handle || groupId)}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(from),
        sysActionMessage(from, `Приглашение в чат: ${String(entry.name || entry.handle || groupId)}`, entry, localId),
        localId
      );
      return nextState;
    });
    return true;
  }

  if (
    t === "group_invite_response_result" ||
    (t === "group_invite_result" &&
      (Object.prototype.hasOwnProperty.call(msg || {}, "accept") || Boolean(msg?.response)))
  ) {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    const accept = msg?.accept === undefined ? null : Boolean(msg.accept);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const friendly =
        reason === "no_invite"
          ? "Нет активного приглашения (возможно, уже обработано)"
          : reason === "not_found"
            ? "Чат не найден"
            : reason === "bad_args"
              ? "Некорректные данные"
              : reason;
      patch((prev) => ({
        ...prev,
        pendingGroupInvites: gid ? prev.pendingGroupInvites.filter((inv) => inv.groupId !== gid) : prev.pendingGroupInvites,
        status: `Не удалось обработать приглашение: ${friendly}`,
      }));
      return true;
    }
    const status =
      gid && accept === true
        ? `Приглашение принято: ${gid}`
        : gid && accept === false
          ? `Приглашение отклонено: ${gid}`
          : "Приглашение обработано";
    patch((prev) => ({
      ...prev,
      pendingGroupInvites: gid ? prev.pendingGroupInvites.filter((inv) => inv.groupId !== gid) : prev.pendingGroupInvites,
      status,
    }));
    return true;
  }

  if (t === "group_invite_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Приглашение не отправлено: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    const gid = String(msg?.group_id ?? "").trim();
    if (gid) patch({ status: `Приглашение отправлено: ${gid}` });
    return true;
  }

  if (t === "group_join_request") {
    const groupId = String(msg?.group_id ?? "").trim();
    const from = String(msg?.from ?? "").trim();
    if (!groupId || !from) return true;
    const label = String(msg?.name ?? msg?.handle ?? groupId).trim() || groupId;
    const notifKey = `group_join_request:${groupId}:${from}`;
    showInAppNotification(
      state,
      notifKey,
      `Запрос на вступление: ${label}`,
      `От: ${resolvePeerLabel(state, from)}`,
      `yagodka:group_join_request:${groupId}:${from}`
    );
    maybePlaySound(state, "auth", notifKey, isDocHidden() || !isViewingPeerDm(state, from));
    const entry: ActionModalGroupJoinRequest = {
      kind: "group_join_request",
      groupId,
      from,
      name: (msg?.name ?? null) as any,
      handle: (msg?.handle ?? null) as any,
    };
    patch((prev) => {
      const prevReq = Array.isArray((prev as any).pendingGroupJoinRequests) ? (prev as any).pendingGroupJoinRequests : [];
      const pendingGroupJoinRequests = prevReq.some((req: any) => req.groupId === groupId && req.from === from) ? prevReq : [...prevReq, entry];
      const localId = `action:group_join_request:${groupId}:${from}`;
      let nextState: any = { ...prev, pendingGroupJoinRequests, status: `Запрос на вступление: ${String(entry.name || entry.handle || groupId)}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(from),
        sysActionMessage(from, `Запрос на вступление в чат: ${String(entry.name || entry.handle || groupId)}`, entry, localId),
        localId
      );
      return nextState;
    });
    return true;
  }

  if (t === "group_join_request_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Запрос не отправлен: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    const gid = String(msg?.group_id ?? "").trim();
    if (gid) patch({ status: `Запрос отправлен: ${gid}` });
    return true;
  }

  if (t === "group_join_declined") {
    const gid = String(msg?.group_id ?? "").trim();
    if (gid) patch({ status: `Запрос отклонён: ${gid}` });
    return true;
  }

  if (t === "group_join_response_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Ответ не принят: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    const gid = String(msg?.group_id ?? "").trim();
    const peer = String(msg?.peer ?? "").trim();
    if (gid && peer) patch({ status: `Ответ отправлен: ${peer}` });
    return true;
  }

  if (t === "board_invite") {
    const board = msg?.board ?? null;
    const boardId = String(msg?.board_id ?? board?.id ?? "").trim();
    const from = String(msg?.from ?? "").trim();
    if (!boardId || !from) return true;
    const label = String(msg?.name ?? board?.name ?? msg?.handle ?? board?.handle ?? boardId).trim() || boardId;
    const notifKey = `board_invite:${boardId}:${from}`;
    showInAppNotification(state, notifKey, `Приглашение в доску: ${label}`, `От: ${resolvePeerLabel(state, from)}`, `yagodka:board_invite:${boardId}:${from}`);
    maybePlaySound(state, "invite", notifKey, isDocHidden() || !isViewingPeerDm(state, from));
    const entry: ActionModalBoardInvite = {
      kind: "board_invite",
      boardId,
      from,
      name: (msg?.name ?? board?.name ?? null) as any,
      handle: (msg?.handle ?? board?.handle ?? null) as any,
      description: (msg?.description ?? board?.description ?? null) as any,
      rules: (msg?.rules ?? board?.rules ?? null) as any,
    };
    patch((prev) => {
      const prevInv = Array.isArray((prev as any).pendingBoardInvites) ? (prev as any).pendingBoardInvites : [];
      const pendingBoardInvites = prevInv.some((inv: any) => inv.boardId === boardId && inv.from === from) ? prevInv : [...prevInv, entry];
      const localId = `action:board_invite:${boardId}:${from}`;
      let nextState: any = { ...prev, pendingBoardInvites, status: `Приглашение в доску: ${String(entry.name || entry.handle || boardId)}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(from),
        sysActionMessage(from, `Приглашение в доску: ${String(entry.name || entry.handle || boardId)}`, entry, localId),
        localId
      );
      return nextState;
    });
    return true;
  }

  if (t === "board_invite_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Инвайт не отправлен: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    const bid = String(msg?.board_id ?? "").trim();
    if (bid) patch({ status: `Инвайт отправлен: ${bid}` });
    return true;
  }

  if (t === "board_invite_response_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const friendly =
        reason === "no_invite"
          ? "Нет активного приглашения (возможно, уже обработано)"
          : reason === "not_found"
            ? "Доска не найдена"
            : reason === "bad_args"
              ? "Некорректные данные"
              : reason;
      patch({ status: `Не удалось обработать приглашение: ${friendly}` });
      return true;
    }
    const bid = String(msg?.board_id ?? "").trim();
    const accept = msg?.accept === undefined ? null : Boolean(msg.accept);
    if (bid && accept === true) patch({ status: `Приглашение принято: ${bid}` });
    else if (bid && accept === false) patch({ status: `Приглашение отклонено: ${bid}` });
    else patch({ status: "Приглашение обработано" });
    return true;
  }

  return false;
}
