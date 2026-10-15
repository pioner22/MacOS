import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { copyText } from "../../helpers/dom/copyText";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { AppState, TargetKind } from "../../stores/types";

export interface RoomPageActions {
  onBack: () => void;
  onOpenChat: (id: string) => void;
  onOpenFiles: () => void;
  onOpenUser: (id: string) => void;
  onGroupJoin: (groupId: string) => void;
  onBoardJoin: (boardId: string) => void;
  onGroupInviteAccept: (groupId: string) => void;
  onGroupInviteDecline: (groupId: string) => void;
  onGroupJoinAccept: (groupId: string, peer: string) => void;
  onGroupJoinDecline: (groupId: string, peer: string) => void;
  onBoardInviteJoin: (boardId: string) => void;
  onBoardInviteDecline: (boardId: string) => void;
  onRemoveMember: (kind: TargetKind, roomId: string, memberId: string) => void;
  onBlockToggle: (memberId: string) => void;
  onWriteToggle: (kind: TargetKind, roomId: string, memberId: string, value: boolean) => void;
  onRefresh: (kind: TargetKind, roomId: string) => void;
  onInfoSave: (kind: TargetKind, roomId: string, description: string, rules: string) => void;
  onLeave: (kind: TargetKind, roomId: string) => void;
  onDisband: (kind: TargetKind, roomId: string) => void;
}

export interface RoomPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

function formatUserLabel(displayName: string, handle: string, fallback: string): string {
  const dn = String(displayName || "").trim();
  if (dn) return dn;
  const h = String(handle || "").trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return fallback || "—";
}

function resolveMemberLabel(state: AppState, id: string): { label: string; handle: string } {
  const pid = String(id || "").trim();
  if (!pid) return { label: "—", handle: "" };
  const p = state.profiles?.[pid];
  if (p) {
    const h = String(p.handle || "").trim();
    return { label: formatUserLabel(p.display_name || "", h, pid), handle: h };
  }
  const friend = state.friends.find((f) => f.id === pid);
  if (friend) {
    const h = String(friend.handle || "").trim();
    return { label: formatUserLabel(friend.display_name || "", h, pid), handle: h };
  }
  return { label: pid, handle: "" };
}

function avatar(kind: TargetKind, id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const node = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  node.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) node.style.backgroundImage = `url(${url})`;
  return node;
}

function formatBytes(size: number): string {
  const value = Number(size || 0);
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = value;
  let idx = 0;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx += 1;
  }
  const precision = v >= 100 || idx === 0 ? 0 : 1;
  return `${v.toFixed(precision)} ${units[idx]}`;
}

function transferTimestamp(localId: string): number {
  const raw = String(localId || "").trim();
  const m = raw.match(/^ft-(\d+)-/);
  if (!m) return 0;
  const ts = Number(m[1]);
  return Number.isFinite(ts) ? ts : 0;
}

function formatGroupTime(ts: number): string {
  if (!ts) return "";
  const dt = new Date(ts);
  const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  const yesterday = (() => {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    return dt.toDateString() === y.toDateString();
  })();
  const time = dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Сегодня ${time}`;
  if (yesterday) return `Вчера ${time}`;
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) + ` · ${time}`;
}

export function createRoomPage(kind: TargetKind, actions: RoomPageActions): RoomPage {
  const mobileUi = isMobileLikeUi();
  const titleText = kind === "group" ? "Чат" : "Доска";
  const title = el("div", { class: "chat-title" }, [titleText]);

  const profileName = el("div", { class: "profile-name" }, ["—"]);
  const profileHandle = el("div", { class: "profile-handle" }, ["—"]);
  const profileId = el("div", { class: "profile-id" }, [""]);

  const avatarView = el("div", { class: "avatar avatar-xl profile-avatar-btn", role: "img", "aria-label": `Аватар ${titleText.toLowerCase()}` });
  const headTop = el("div", { class: "profile-head-top" }, [avatarView, el("div", { class: "profile-head-main" }, [profileName, profileHandle, profileId])]);
  const head = el("div", { class: "profile-card profile-head" }, [headTop]);

  const ownerValue = el("div", { class: "profile-field-value" }, ["—"]);
  const handleValue = el("div", { class: "profile-field-value" }, ["—"]);
  const postValue = el("div", { class: "profile-field-value" }, ["—"]);
  const about = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, [titleText]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Владелец"]), ownerValue]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Писать"]), postValue]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Ссылка"]), handleValue]),
  ]);

  const descriptionLabel = el("div", { class: "profile-field-label" }, ["Описание"]);
  const descriptionValue = el("div", { class: "profile-field-value profile-text" }, ["—"]);
  const descriptionInput = el("textarea", {
    class: "modal-input profile-textarea",
    id: `${kind}-description`,
    rows: "4",
    maxlength: "2000",
    placeholder: "Описание чата/доски",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
  }) as HTMLTextAreaElement;
  const descriptionField = el("div", { class: "profile-field" }, [descriptionLabel, descriptionValue, descriptionInput]);

  const rulesLabel = el("div", { class: "profile-field-label" }, ["Правила"]);
  const rulesValue = el("div", { class: "profile-field-value profile-text" }, ["—"]);
  const rulesInput = el("textarea", {
    class: "modal-input profile-textarea",
    id: `${kind}-rules`,
    rows: "5",
    maxlength: "2000",
    placeholder: "Правила и рекомендации",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
  }) as HTMLTextAreaElement;
  const rulesField = el("div", { class: "profile-field" }, [rulesLabel, rulesValue, rulesInput]);

  const btnInfoSave = el("button", { class: "btn btn-primary", type: "button" }, ["Сохранить"]);
  const infoActions = el("div", { class: "profile-actions" }, [btnInfoSave]);
  const infoCard = el("div", { class: "profile-card" }, [
    el("div", { class: "profile-card-title" }, ["Описание и правила"]),
    descriptionField,
    rulesField,
    infoActions,
  ]);

  const accessTitle = el("div", { class: "profile-card-title" }, ["Роли и доступ"]);
  const roleValue = el("div", { class: "profile-field-value" }, ["—"]);
  const memberValue = el("div", { class: "profile-field-value" }, ["—"]);
  const accessCard = el("div", { class: "profile-card" }, [
    accessTitle,
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Ваша роль"]), roleValue]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Участник"]), memberValue]),
  ]);

  const inviteTitle = el("div", { class: "profile-card-title" }, ["Инвайт‑ссылка"]);
  const inviteLinkValue = el("div", { class: "profile-field-value profile-text" }, ["—"]);
  const inviteIdValue = el("div", { class: "profile-field-value profile-text" }, ["—"]);
  const btnCopyInvite = el("button", { class: "btn", type: "button" }, ["Копировать"]);
  const inviteActions = el("div", { class: "profile-actions" }, [btnCopyInvite]);
  const inviteCard = el("div", { class: "profile-card" }, [
    inviteTitle,
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["Ссылка"]), inviteLinkValue]),
    el("div", { class: "profile-field" }, [el("div", { class: "profile-field-label" }, ["ID"]), inviteIdValue]),
    inviteActions,
  ]);

  const inviteInTitle = el("div", { class: "profile-card-title" }, ["Приглашение"]);
  const inviteInText = el("div", { class: "profile-field-value profile-text" }, ["—"]);
  const btnInviteAccept = el("button", { class: "btn btn-primary", type: "button" }, ["Принять"]);
  const btnInviteDecline = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
  const inviteInActions = el("div", { class: "profile-actions" }, [btnInviteAccept, btnInviteDecline]);
  const inviteInCard = el("div", { class: "profile-card hidden" }, [inviteInTitle, inviteInText, inviteInActions]);

  const reqTitle = el("div", { class: "profile-card-title" }, ["Заявки на вступление"]);
  const reqCount = el("div", { class: "profile-members-count" }, ["0"]);
  const reqHead = el("div", { class: "profile-members-head" }, [reqTitle, reqCount]);
  const reqList = el("div", { class: "members-list" }, []);
  const reqCard = el("div", { class: "profile-card hidden" }, [reqHead, reqList]);

  const mediaTitle = el("div", { class: "profile-card-title" }, ["Общие медиа"]);
  const mediaCount = el("div", { class: "profile-members-count" }, ["0"]);
  const mediaHead = el("div", { class: "profile-members-head" }, [mediaTitle, mediaCount]);
  const mediaList = el("div", { class: "members-list" }, []);
  const btnOpenFiles = el("button", { class: "btn", type: "button" }, ["Открыть «Файлы»"]);
  const mediaActions = el("div", { class: "profile-actions" }, [btnOpenFiles]);
  const mediaCard = el("div", { class: "profile-card hidden" }, [mediaHead, mediaList, mediaActions]);

  const membersTitle = el("div", { class: "profile-card-title" }, ["Участники"]);
  const membersCount = el("div", { class: "profile-members-count" }, ["0"]);
  const membersHead = el("div", { class: "profile-members-head" }, [membersTitle, membersCount]);
  const membersList = el("div", { class: "members-list" }, []);
  const membersCard = el("div", { class: "profile-card" }, [membersHead, membersList]);

  const btnJoin = el("button", { class: "btn btn-primary", type: "button" }, [kind === "group" ? "Запросить вступление" : "Вступить"]);
  const btnLeave = el("button", { class: "btn", type: "button" }, [`Покинуть ${titleText.toLowerCase()}`]);
  const btnDisband = el("button", { class: "btn btn-danger", type: "button" }, [`Удалить ${titleText.toLowerCase()} (для всех)`]);
  const manageActions = el("div", { class: "profile-actions" }, [btnJoin, btnLeave, btnDisband]);
  const manageCard = el("div", { class: "profile-card" }, [el("div", { class: "profile-card-title" }, ["Управление"]), manageActions]);

  const btnChat = el("button", { class: "btn btn-primary", type: "button" }, ["Открыть чат"]);
  const btnRefresh = el("button", { class: "btn", type: "button" }, ["Обновить"]);
  const actionsRow = el("div", { class: "page-actions" }, [btnChat, btnRefresh]);

  const hint = mobileUi ? null : el("div", { class: "msg msg-sys page-hint" }, ["Esc — назад"]);

  const root = el("div", { class: "page page-profile page-room" }, [
    title,
    head,
    about,
    accessCard,
    inviteCard,
    inviteInCard,
    reqCard,
    mediaCard,
    infoCard,
    membersCard,
    manageCard,
    actionsRow,
    ...(hint ? [hint] : []),
  ]);

  let currentRoomId = "";
  let currentIsOwner = false;
  let lastRoomKey = "";
  let lastDescription = "";
  let lastRules = "";
  let draftDescription = "";
  let draftRules = "";

  const normalizeInfo = (value: string) => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  const updateInfoSaveState = () => {
    const dirty = normalizeInfo(draftDescription) !== normalizeInfo(lastDescription) || normalizeInfo(draftRules) !== normalizeInfo(lastRules);
    btnInfoSave.disabled = !currentIsOwner || !currentRoomId || !dirty;
  };

  btnChat.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    actions.onOpenChat(roomId);
  });

  btnRefresh.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    actions.onRefresh(kind, roomId);
  });

  btnOpenFiles.addEventListener("click", () => actions.onOpenFiles());

  btnCopyInvite.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    const handleRaw = String(root.getAttribute("data-room-handle") || "").trim();
    const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
    const value = handle || roomId;
    const prev = btnCopyInvite.textContent || "";
    btnCopyInvite.textContent = "Копируем…";
    void copyText(value).then((ok) => {
      btnCopyInvite.textContent = ok ? "Скопировано" : "Не удалось";
      window.setTimeout(() => {
        btnCopyInvite.textContent = prev || "Копировать";
      }, 1200);
    });
  });

  btnJoin.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    if (kind === "group") actions.onGroupJoin(roomId);
    else actions.onBoardJoin(roomId);
  });

  btnInviteAccept.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    if (kind === "group") actions.onGroupInviteAccept(roomId);
    else actions.onBoardInviteJoin(roomId);
  });

  btnInviteDecline.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    if (kind === "group") actions.onGroupInviteDecline(roomId);
    else actions.onBoardInviteDecline(roomId);
  });

  btnLeave.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    actions.onLeave(kind, roomId);
  });

  btnDisband.addEventListener("click", () => {
    const roomId = String(root.getAttribute("data-room-id") || "").trim();
    if (!roomId) return;
    actions.onDisband(kind, roomId);
  });

  descriptionInput.addEventListener("input", () => {
    draftDescription = descriptionInput.value;
    updateInfoSaveState();
  });

  rulesInput.addEventListener("input", () => {
    draftRules = rulesInput.value;
    updateInfoSaveState();
  });

  btnInfoSave.addEventListener("click", () => {
    if (!currentRoomId) return;
    const description = normalizeInfo(draftDescription);
    const rules = normalizeInfo(draftRules);
    actions.onInfoSave(kind, currentRoomId, description, rules);
  });

  function renderMembers(state: AppState, roomId: string, ownerId: string) {
    const entry = kind === "group" ? state.groups.find((g) => g.id === roomId) : state.boards.find((b) => b.id === roomId);
    const members = entry?.members ? [...entry.members] : [];
    if (ownerId && !members.includes(ownerId)) members.unshift(ownerId);
    const uniqMembers = Array.from(new Set(members.map((m) => String(m || "").trim()).filter(Boolean)));

    membersCount.textContent = String(uniqMembers.length);
    if (!uniqMembers.length) {
      membersList.replaceChildren(el("div", { class: "members-empty" }, ["Список участников пока пуст"]));
      return;
    }

    const me = String(state.selfId || "").trim();
    const isOwner = Boolean(ownerId && me && ownerId === me);
    const blockedSet = new Set(state.blocked || []);
    const groupEntry = kind === "group" ? (entry as AppState["groups"][number] | undefined) : undefined;
    const postBannedSet = new Set(
      (groupEntry?.post_banned || []).map((m) => String(m || "").trim()).filter(Boolean)
    );

    const rows = uniqMembers.map((mid) => {
      const memberId = String(mid || "").trim();
      const labels = resolveMemberLabel(state, memberId);
      const row = el("div", { class: "member-row", "data-member-id": memberId }, []);
      const main = el("div", { class: "member-main" }, [
        avatar("dm", memberId),
        el("div", { class: "member-meta" }, [
          el("div", { class: "member-name" }, [labels.label]),
          el("div", { class: "member-sub" }, [labels.handle ? (labels.handle.startsWith("@") ? labels.handle : `@${labels.handle}`) : `ID: ${memberId}`]),
        ]),
      ]);

      const badges: HTMLElement[] = [];
      if (memberId === ownerId) badges.push(el("span", { class: "member-badge" }, ["Владелец"]));
      if (me && memberId === me) badges.push(el("span", { class: "member-badge member-badge-self" }, ["Вы"]));
      if (blockedSet.has(memberId)) badges.push(el("span", { class: "member-badge member-badge-warn" }, ["Заблокирован"]));
      if (kind === "group" && postBannedSet.has(memberId))
        badges.push(el("span", { class: "member-badge member-badge-muted" }, ["Запрет писать"]));

      const badgeWrap = badges.length ? el("div", { class: "member-badges" }, badges) : null;
      if (badgeWrap) main.append(badgeWrap);

      const actionsWrap = el("div", { class: "member-actions" }, []);
      const btnProfile = el("button", { class: "btn", type: "button" }, ["Профиль"]);
      btnProfile.addEventListener("click", () => actions.onOpenUser(memberId));
      actionsWrap.append(btnProfile);

      if (memberId !== me) {
        const blocked = blockedSet.has(memberId);
        const btnBlock = el("button", { class: blocked ? "btn btn-active" : "btn", type: "button" }, [blocked ? "Разблокировать" : "Блокировать"]);
        btnBlock.addEventListener("click", () => actions.onBlockToggle(memberId));
        actionsWrap.append(btnBlock);
      }

      if (isOwner && kind === "group" && memberId && memberId !== ownerId) {
        const banned = postBannedSet.has(memberId);
        const btnWrite = el("button", { class: banned ? "btn btn-active" : "btn", type: "button" }, [banned ? "Разрешить писать" : "Запретить писать"]);
        btnWrite.addEventListener("click", () => actions.onWriteToggle(kind, roomId, memberId, !banned));
        actionsWrap.append(btnWrite);
      }

      if (isOwner && memberId && memberId !== ownerId) {
        const btnRemove = el("button", { class: "btn btn-danger", type: "button" }, ["Удалить"]);
        btnRemove.addEventListener("click", () => actions.onRemoveMember(kind, roomId, memberId));
        actionsWrap.append(btnRemove);
      }

      row.append(main, actionsWrap);
      return row;
    });
    membersList.replaceChildren(...rows);
  }

  function update(state: AppState) {
    const roomId = String(kind === "group" ? state.groupViewId || "" : state.boardViewId || "").trim();

    const entry = kind === "group" ? state.groups.find((g) => g.id === roomId) : state.boards.find((b) => b.id === roomId);
    const name = String(entry?.name || roomId || "—");
    const handle = String(entry?.handle || "").trim();
    const handleDisplay = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "";
    const ownerId = String(entry?.owner_id || "").trim();
    const description = String(entry?.description || "");
    const rules = String(entry?.rules || "");
    const roomKey = `${kind}:${roomId}`;
    const me = String(state.selfId || "").trim();
    const isOwner = Boolean(ownerId && me && String(ownerId) === String(me));
    const members = Array.isArray(entry?.members) ? entry?.members || [] : [];
    const isMember = Boolean(me && (isOwner || members.includes(me)));

    profileName.textContent = name || "—";
    profileHandle.textContent = handleDisplay || "Ссылка не задана";
    profileId.textContent = roomId ? `ID: ${roomId}` : "";
    root.setAttribute("data-room-handle", handleDisplay);

    ownerValue.textContent = ownerId || "—";
    handleValue.textContent = handleDisplay || "—";
    if (!roomId) {
      postValue.textContent = "—";
    } else if (kind === "board") {
      postValue.textContent = "Только владелец";
    } else {
      const groupEntry = entry as AppState["groups"][number] | undefined;
      const bannedCount = Array.isArray(groupEntry?.post_banned) ? groupEntry?.post_banned?.length || 0 : 0;
      postValue.textContent = bannedCount > 0 ? "Ограничено" : "Все участники";
    }

    roleValue.textContent = isOwner ? "Владелец" : isMember ? "Участник" : "Гость";
    memberValue.textContent = isMember ? "Да" : "Нет";

    inviteLinkValue.textContent = handleDisplay || "Ссылка не задана";
    inviteIdValue.textContent = roomId || "—";
    (btnCopyInvite as HTMLButtonElement).disabled = !roomId;

    const inviteIn =
      kind === "group"
        ? state.pendingGroupInvites.find((inv) => inv.groupId === roomId) || null
        : state.pendingBoardInvites.find((inv) => inv.boardId === roomId) || null;
    const inviteFrom = String(inviteIn?.from || "").trim();
    const inviteFromLabel = inviteFrom ? resolveMemberLabel(state, inviteFrom).label : "";
    inviteInText.textContent = inviteIn ? `От: ${inviteFromLabel || inviteFrom || "—"}` : "—";
    const canHandleInvite = Boolean(inviteIn && roomId && !isMember);
    inviteInCard.classList.toggle("hidden", !canHandleInvite);
    (btnInviteAccept as HTMLButtonElement).disabled = !canHandleInvite;
    (btnInviteDecline as HTMLButtonElement).disabled = !canHandleInvite;

    const url = roomId ? getStoredAvatar(kind, roomId) : null;
    avatarView.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${roomId || "anon"}`)));
    avatarView.classList.toggle("avatar-img", Boolean(url));
    avatarView.textContent = url ? "" : avatarMonogram(kind, roomId);
    (avatarView as HTMLElement).style.backgroundImage = url ? `url(${url})` : "";

    renderMembers(state, roomId, ownerId);

    if (kind === "group" && roomId && isOwner) {
      const reqs = state.pendingGroupJoinRequests.filter((req) => req.groupId === roomId);
      reqCount.textContent = String(reqs.length);
      if (!reqs.length) {
        reqList.replaceChildren(el("div", { class: "members-empty" }, ["Нет заявок"]));
      } else {
        const rows = reqs.map((req) => {
          const peer = String(req.from || "").trim();
          const labels = resolveMemberLabel(state, peer);
          const row = el("div", { class: "member-row", "data-member-id": peer }, []);
          const main = el("div", { class: "member-main" }, [
            avatar("dm", peer),
            el("div", { class: "member-meta" }, [
              el("div", { class: "member-name" }, [labels.label]),
              el("div", { class: "member-sub" }, [
                labels.handle ? (labels.handle.startsWith("@") ? labels.handle : `@${labels.handle}`) : `ID: ${peer}`,
              ]),
            ]),
          ]);
          const actionsWrap = el("div", { class: "member-actions" }, []);
          const btnAccept = el("button", { class: "btn btn-primary", type: "button" }, ["Принять"]);
          const btnDecline = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
          btnAccept.addEventListener("click", () => actions.onGroupJoinAccept(roomId, peer));
          btnDecline.addEventListener("click", () => actions.onGroupJoinDecline(roomId, peer));
          actionsWrap.append(btnAccept, btnDecline);
          row.append(main, actionsWrap);
          return row;
        });
        reqList.replaceChildren(...rows);
      }
      reqCard.classList.remove("hidden");
    } else {
      reqCard.classList.add("hidden");
      reqList.replaceChildren();
      reqCount.textContent = "0";
    }

    if (roomId) {
      const media = state.fileTransfers.filter((t) => String(t.room || "").trim() === roomId);
      mediaCount.textContent = String(media.length);
      const recent = [...media].sort((a, b) => transferTimestamp(b.localId) - transferTimestamp(a.localId)).slice(0, 6);
      if (!recent.length) {
        mediaList.replaceChildren(el("div", { class: "members-empty" }, ["Пока нет файлов/медиа"]));
      } else {
        const rows = recent.map((t) => {
          const ts = transferTimestamp(t.localId);
          const subtitle = [formatGroupTime(ts), t.size > 0 ? formatBytes(t.size) : "", t.status ? String(t.status) : ""]
            .filter(Boolean)
            .join(" · ");
          const row = el("div", { class: "member-row" }, []);
          const main = el("div", { class: "member-main" }, [
            el("div", { class: "member-meta" }, [
              el("div", { class: "member-name" }, [String(t.name || "—")]),
              el("div", { class: "member-sub" }, [subtitle || "—"]),
            ]),
          ]);
          row.append(main);
          return row;
        });
        mediaList.replaceChildren(...rows);
      }
      mediaCard.classList.remove("hidden");
      (btnOpenFiles as HTMLButtonElement).disabled = false;
    } else {
      mediaCard.classList.add("hidden");
      mediaList.replaceChildren();
      mediaCount.textContent = "0";
      (btnOpenFiles as HTMLButtonElement).disabled = true;
    }

    (btnChat as HTMLButtonElement).disabled = !roomId;
    (btnRefresh as HTMLButtonElement).disabled = !roomId;
    const canJoin = Boolean(roomId && !isMember && !inviteIn);
    const canLeave = Boolean(roomId && isMember && !isOwner);
    const canDisband = Boolean(roomId && isOwner);
    btnJoin.classList.toggle("hidden", !canJoin);
    btnLeave.classList.toggle("hidden", !canLeave);
    btnDisband.classList.toggle("hidden", !canDisband);
    manageCard.classList.toggle("hidden", !canJoin && !canLeave && !canDisband);
    (btnJoin as HTMLButtonElement).disabled = !canJoin;
    (btnLeave as HTMLButtonElement).disabled = !canLeave;
    (btnDisband as HTMLButtonElement).disabled = !canDisband;

    currentRoomId = roomId;
    currentIsOwner = isOwner;
    root.setAttribute("data-room-id", roomId);

    if (roomKey !== lastRoomKey) {
      lastRoomKey = roomKey;
      lastDescription = description;
      lastRules = rules;
      draftDescription = description;
      draftRules = rules;
      descriptionInput.value = description;
      rulesInput.value = rules;
    } else {
      if (document.activeElement !== descriptionInput && description !== lastDescription) {
        lastDescription = description;
        draftDescription = description;
        descriptionInput.value = description;
      }
      if (document.activeElement !== rulesInput && rules !== lastRules) {
        lastRules = rules;
        draftRules = rules;
        rulesInput.value = rules;
      }
    }

    descriptionValue.textContent = description || "Описание не задано";
    rulesValue.textContent = rules || "Правила не заданы";
    descriptionInput.classList.toggle("hidden", !isOwner);
    rulesInput.classList.toggle("hidden", !isOwner);
    descriptionValue.classList.toggle("hidden", isOwner);
    rulesValue.classList.toggle("hidden", isOwner);
    infoActions.classList.toggle("hidden", !isOwner);
    updateInfoSaveState();
  }

  return {
    root,
    update,
    focus: () => {
      if (window.matchMedia && window.matchMedia("(max-width: 600px)").matches) return;
      btnChat.focus();
    },
  };
}
