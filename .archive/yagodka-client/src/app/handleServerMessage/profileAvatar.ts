import type { GatewayTransport } from "../../lib/net/gatewayClient";
import type { AppState, UserProfile } from "../../stores/types";
import { clearStoredAvatar, getStoredAvatar, getStoredAvatarRev, storeAvatar, storeAvatarRev, type AvatarTargetKind } from "../../helpers/avatar/avatarStore";
import { upsertProfile } from "../../helpers/roster/rosterSync";

type PatchFn = (p: Partial<AppState> | ((prev: AppState) => AppState)) => void;

function avatarKindFromMessage(msg: any): AvatarTargetKind {
  const raw = String(msg?.kind ?? msg?.target_kind ?? "dm").trim().toLowerCase();
  if (raw === "group" || raw === "board") return raw;
  return "dm";
}

function patchRoomAvatar(prev: AppState, kind: "group" | "board", id: string, rev: number, mime: string | null): AppState {
  if (kind === "group") {
    const groups = (prev.groups || []).map((g) => (g.id === id ? { ...g, avatar_rev: rev, avatar_mime: mime } : g));
    return { ...prev, groups };
  }
  const boards = (prev.boards || []).map((b) => (b.id === id ? { ...b, avatar_rev: rev, avatar_mime: mime } : b));
  return { ...prev, boards };
}

function roomAvatarStatus(kind: "group" | "board", action: "set" | "clear"): string {
  if (kind === "group") return action === "set" ? "Аватар чата обновлён" : "Аватар чата удалён";
  return action === "set" ? "Аватар доски обновлён" : "Аватар доски удалён";
}

function restoreRoomAvatarAfterFailure(kind: "group" | "board", id: string, state: AppState, gateway: GatewayTransport) {
  clearStoredAvatar(kind, id);
  const entry = kind === "group" ? (state.groups || []).find((g) => g.id === id) : (state.boards || []).find((b) => b.id === id);
  if ((entry?.avatar_rev || 0) > 0 && entry?.avatar_mime) gateway.send({ type: "avatar_get", kind, id });
}

export function handleProfileAvatarMessage(
  t: string,
  msg: any,
  state: AppState,
  gateway: GatewayTransport,
  patch: PatchFn
): boolean {
  if (t === "profile") {
    const id = String(msg?.id ?? "");
    if (!id) return true;
    const avatarRev = Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0));
    const avatarMimeRaw = msg?.avatar_mime;
    const avatarMime = typeof avatarMimeRaw === "string" && avatarMimeRaw.trim() ? String(avatarMimeRaw).trim() : null;
    const prof: UserProfile = {
      id,
      display_name: (msg?.display_name ?? null) as any,
      handle: (msg?.handle ?? null) as any,
      bio: (msg?.bio ?? null) as any,
      status: (msg?.status ?? null) as any,
      avatar_rev: avatarRev,
      avatar_mime: (avatarMime ?? null) as any,
      client_version: (msg?.client_version ?? null) as any,
      client_web_version: (msg?.client_web_version ?? null) as any,
    };
    const isFriend = Boolean(state.selfId && id === state.selfId) || state.friends.some((f) => f.id === id);
    if (isFriend) {
      const hasAvatar = Boolean(avatarMime);
      if (!hasAvatar) {
        const storedUrl = getStoredAvatar("dm", id);
        const storedRev = getStoredAvatarRev("dm", id);
        if (storedUrl) {
          clearStoredAvatar("dm", id);
          storeAvatarRev("dm", id, avatarRev);
          patch((prev) => ({ ...prev, avatarsRev: (prev.avatarsRev || 0) + 1 }));
        } else if (storedRev !== avatarRev) {
          storeAvatarRev("dm", id, avatarRev);
        }
      } else {
        const storedRev = getStoredAvatarRev("dm", id);
        const storedUrl = getStoredAvatar("dm", id);
        if (storedRev !== avatarRev || !storedUrl) gateway.send({ type: "avatar_get", id });
      }
    }
    patch((prev) => {
      const next: AppState = upsertProfile(prev, prof, { loaded: true, source: "server", lastServerAt: Date.now() });
      if (id === prev.selfId) {
        const draftsEmpty = !prev.profileDraftDisplayName && !prev.profileDraftHandle && !prev.profileDraftBio && !prev.profileDraftStatus;
        if (prev.page !== "profile" || draftsEmpty) {
          next.profileDraftDisplayName = String(prof.display_name ?? "");
          next.profileDraftHandle = String(prof.handle ?? "");
          next.profileDraftBio = String(prof.bio ?? "");
          next.profileDraftStatus = String(prof.status ?? "");
        }
      }
      return next;
    });
    return true;
  }

  if (t === "profile_updated") {
    const id = String(msg?.id ?? "");
    if (!id) return true;
    const hasAvatarRev = msg?.avatar_rev !== undefined;
    const avatarRev = hasAvatarRev ? Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0)) : null;
    const hasAvatarMime = msg?.avatar_mime !== undefined;
    const avatarMimeRaw = msg?.avatar_mime;
    const avatarMime = typeof avatarMimeRaw === "string" && avatarMimeRaw.trim() ? String(avatarMimeRaw).trim() : null;
    const isFriend = Boolean(state.selfId && id === state.selfId) || state.friends.some((f) => f.id === id);
    if (isFriend && hasAvatarRev) {
      const hasAvatar = Boolean(avatarMime);
      if (hasAvatarMime && !hasAvatar) {
        const storedUrl = getStoredAvatar("dm", id);
        const storedRev = getStoredAvatarRev("dm", id);
        if (storedUrl) {
          clearStoredAvatar("dm", id);
          storeAvatarRev("dm", id, avatarRev || 0);
          patch((prev) => ({ ...prev, avatarsRev: (prev.avatarsRev || 0) + 1 }));
        } else if (storedRev !== (avatarRev || 0)) {
          storeAvatarRev("dm", id, avatarRev || 0);
        }
      } else if (hasAvatar) {
        const storedRev = getStoredAvatarRev("dm", id);
        const storedUrl = getStoredAvatar("dm", id);
        if (storedRev !== avatarRev || !storedUrl) gateway.send({ type: "avatar_get", id });
      }
    }
    patch((prev) => {
      const cur = prev.profiles[id] ?? { id };
      return upsertProfile(prev, {
        ...cur,
        id,
        ...(msg?.display_name === undefined ? {} : { display_name: (msg?.display_name ?? null) as any }),
        ...(msg?.handle === undefined ? {} : { handle: (msg?.handle ?? null) as any }),
        ...(msg?.bio === undefined ? {} : { bio: (msg?.bio ?? null) as any }),
        ...(msg?.status === undefined ? {} : { status: (msg?.status ?? null) as any }),
        ...(msg?.avatar_rev === undefined ? {} : { avatar_rev: (avatarRev ?? 0) as any }),
        ...(msg?.avatar_mime === undefined ? {} : { avatar_mime: (avatarMime ?? null) as any }),
      }, { loaded: true, source: "server", lastServerAt: Date.now(), ...(hasAvatarRev ? { avatarCheckedAt: Date.now() } : {}) });
    });
    return true;
  }

  if (t === "profile_set_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "handle_taken"
          ? "Этот @handle уже занят"
          : reason === "handle_invalid"
            ? "Некорректный @handle (только a-z, 0-9, _; длина 3-16)"
            : reason === "too_long"
              ? "Слишком длинное значение"
              : reason === "empty"
                ? "Поле не должно быть пустым"
                : reason === "no_such_user"
                  ? "Пользователь не найден"
                  : reason === "server_error"
                    ? "Ошибка сервера"
                    : reason;
      patch({ status: `Не удалось сохранить профиль: ${message}` });
      return true;
    }
    patch((prev) => {
      if (!prev.selfId) return { ...prev, status: "Профиль сохранён" };
      const cur = prev.profiles[prev.selfId] ?? { id: prev.selfId };
      const displayName = (msg?.display_name ?? null) as any;
      const handle = (msg?.handle ?? null) as any;
      const bio = (msg?.bio ?? null) as any;
      const statusText = (msg?.status ?? null) as any;
      const next = upsertProfile(prev, { ...cur, display_name: displayName, handle, bio, status: statusText }, {
        loaded: true,
        source: "server",
        lastServerAt: Date.now(),
      });
      return {
        ...next,
        profileDraftDisplayName: String(displayName ?? ""),
        profileDraftHandle: String(handle ?? ""),
        profileDraftBio: String(bio ?? ""),
        profileDraftStatus: String(statusText ?? ""),
        status: "Профиль сохранён",
      };
    });
    return true;
  }

  if (t === "avatar") {
    const kind = avatarKindFromMessage(msg);
    const id = String(msg?.id ?? "").trim();
    if (!id) return true;
    const rev = Math.max(0, Math.trunc(Number(msg?.rev ?? 0) || 0));
    const mime = typeof msg?.mime === "string" && msg.mime.trim() ? String(msg.mime).trim() : null;
    const data = typeof msg?.data === "string" && msg.data.trim() ? String(msg.data).trim() : null;

    if (mime && data) {
      const dataUrl = `data:${mime};base64,${data}`;
      try {
        storeAvatar(kind, id, dataUrl);
      } catch {
        clearStoredAvatar(kind, id);
      }
    } else {
      clearStoredAvatar(kind, id);
    }
    storeAvatarRev(kind, id, rev);

    if (kind === "group" || kind === "board") {
      patch((prev) => ({ ...patchRoomAvatar(prev, kind, id, rev, mime), avatarsRev: (prev.avatarsRev || 0) + 1 }));
      return true;
    }

    patch((prev) => {
      const cur = prev.profiles[id] ?? { id };
      const next = upsertProfile(prev, { ...cur, id, avatar_rev: rev, avatar_mime: mime }, {
        loaded: true,
        source: "server",
        lastServerAt: Date.now(),
        avatarCheckedAt: Date.now(),
      });
      return { ...next, avatarsRev: (prev.avatarsRev || 0) + 1 };
    });
    return true;
  }

  if (t === "avatar_set_result") {
    const kind = avatarKindFromMessage(msg);
    const ok = Boolean(msg?.ok);
    if (kind === "group" || kind === "board") {
      const id = String(msg?.id ?? (kind === "group" ? msg?.group_id : msg?.board_id) ?? "").trim();
      if (!id) {
        patch({ status: `Не удалось обновить аватар: ${String(msg?.reason ?? "bad_args")}` });
        return true;
      }
      if (!ok) {
        restoreRoomAvatarAfterFailure(kind, id, state, gateway);
        patch((prev) => ({ ...prev, avatarsRev: (prev.avatarsRev || 0) + 1, status: `Не удалось обновить аватар: ${String(msg?.reason ?? "ошибка")}` }));
        return true;
      }
      const rev = Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0));
      const mime = typeof msg?.avatar_mime === "string" && msg.avatar_mime.trim() ? String(msg.avatar_mime).trim() : null;
      storeAvatarRev(kind, id, rev);
      patch((prev) => ({ ...patchRoomAvatar(prev, kind, id, rev, mime), avatarsRev: (prev.avatarsRev || 0) + 1, status: roomAvatarStatus(kind, "set") }));
      return true;
    }
    if (!ok) {
      const selfId = String(state.selfId || "").trim();
      if (selfId) {
        clearStoredAvatar("dm", selfId);
        const profile = state.profiles?.[selfId];
        if ((profile?.avatar_rev || 0) > 0 && profile?.avatar_mime) gateway.send({ type: "avatar_get", id: selfId });
        patch((prev) => ({ ...prev, avatarsRev: (prev.avatarsRev || 0) + 1, status: `Не удалось обновить аватар: ${String(msg?.reason ?? "ошибка")}` }));
      } else patch({ status: `Не удалось обновить аватар: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    const rev = Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0));
    patch((prev) => {
      if (!prev.selfId) return prev;
      storeAvatarRev("dm", prev.selfId, rev);
      const cur = prev.profiles[prev.selfId] ?? { id: prev.selfId };
      const next = upsertProfile(prev, { ...cur, id: prev.selfId, avatar_rev: rev }, {
        loaded: true,
        source: "server",
        lastServerAt: Date.now(),
        avatarCheckedAt: Date.now(),
      });
      return { ...next, avatarsRev: (prev.avatarsRev || 0) + 1, status: "Аватар обновлён" };
    });
    return true;
  }

  if (t === "avatar_clear_result") {
    const kind = avatarKindFromMessage(msg);
    const ok = Boolean(msg?.ok);
    if (kind === "group" || kind === "board") {
      const id = String(msg?.id ?? (kind === "group" ? msg?.group_id : msg?.board_id) ?? "").trim();
      if (!ok) {
        patch({ status: `Не удалось удалить аватар: ${String(msg?.reason ?? "ошибка")}` });
        return true;
      }
      if (!id) return true;
      const rev = Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0));
      clearStoredAvatar(kind, id);
      storeAvatarRev(kind, id, rev);
      patch((prev) => ({ ...patchRoomAvatar(prev, kind, id, rev, null), avatarsRev: (prev.avatarsRev || 0) + 1, status: roomAvatarStatus(kind, "clear") }));
      return true;
    }
    if (!ok) {
      patch({ status: `Не удалось удалить аватар: ${String(msg?.reason ?? "ошибка")}` });
      return true;
    }
    const rev = Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0));
    patch((prev) => {
      if (!prev.selfId) return prev;
      clearStoredAvatar("dm", prev.selfId);
      storeAvatarRev("dm", prev.selfId, rev);
      const cur = prev.profiles[prev.selfId] ?? { id: prev.selfId };
      const next = upsertProfile(prev, { ...cur, id: prev.selfId, avatar_rev: rev, avatar_mime: null }, {
        loaded: true,
        source: "server",
        lastServerAt: Date.now(),
        avatarCheckedAt: Date.now(),
      });
      return { ...next, avatarsRev: (prev.avatarsRev || 0) + 1, status: "Аватар удалён" };
    });
    return true;
  }

  return false;
}
