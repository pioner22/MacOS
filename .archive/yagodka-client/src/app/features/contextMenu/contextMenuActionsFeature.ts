import { sanitizeArchived, saveArchivedForUser, toggleArchived } from "../../../helpers/chat/archives";
import { conversationKey, dmKey, roomKey } from "../../../helpers/chat/conversationKey";
import { resolveVirtualStartForIndex } from "../../../helpers/chat/historyViewportCoordinator";
import { saveChatFoldersForUser, sanitizeChatFoldersSnapshot } from "../../../helpers/chat/folders";
import { sanitizePins, savePinsForUser, togglePin } from "../../../helpers/chat/pins";
import { savePinnedBarHiddenForUser } from "../../../helpers/chat/pinnedBarHidden";
import { isPinnedMessage, savePinnedMessagesForUser, togglePinnedMessage } from "../../../helpers/chat/pinnedMessages";
import { updateOutboxEntry } from "../../../helpers/chat/outbox";
import { ensureChatMessageLoadedById } from "../../../helpers/chat/ensureHistoryMessage";
import { applySidebarFolderMutation } from "../../../helpers/sidebar/sidebarState";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";
import { avatarKindForTarget } from "../avatar/avatarFeature";
import { scheduleSaveOutbox } from "../persistence/localPersistenceTimers";

export interface ContextMenuActionsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;

  closeModal: () => void;
  clearMsgContextSelection: () => void;
  getMsgContextSelection: () => { key: string; idx: number; text: string } | null;

  showToast: (message: string, opts?: any) => void;

  clearComposerHelper: () => void;
  resolveComposerHelperDraft: (st: AppState) => any;
  scheduleFocusComposer: () => void;
  getComposerText: () => string;
  applyComposerInput: (nextInput: string) => void;

  getSendMenuDraft: () => any | null;
  buildSendMenuDraftFromComposer: (st: AppState) => any | null;
  sendChat: (payload: any) => void;
  openSendScheduleModalWithDraft: (draft: any) => void;

  setPage: (page: any) => void;
  openGroupCreateModal: () => void;
  openBoardCreateModal: () => void;
  logout: () => void;

  openUserPage: (id: string) => void;
  openGroupPage: (id: string) => void;
  openBoardPage: (id: string) => void;
  selectTarget: (t: any) => void;

  isChatMessageSelectable: (msg: ChatMessage | null | undefined) => msg is ChatMessage;
  toggleChatSelection: (key: string, msg: ChatMessage) => void;
  setChatSelectionAnchorIdx: (idx: number | null) => void;

  closeMobileSidebar: (opts?: { suppressStickBottomRestore?: boolean }) => void;

  beginFileDownload: (fileId: string) => void;

  openChatSearch: () => void;
  setChatSearchQuery: (query: string) => void;
  openEmojiPopoverForReaction: (target: { key: string; msgId: number }) => void;
  jumpToChatMsgIdx: (idx: number) => void;

  buildHelperDraft: (st: AppState, key: string, msg: ChatMessage) => any;
  openForwardModal: (draft: any) => void;
  beginEditingMessage: (key: string, msgId: number, text: string) => void;

  openMembersAddModal: (targetKind: "group" | "board", targetId: string) => void;
  openMembersRemoveModal: (targetKind: "group" | "board", targetId: string) => void;
  openRenameModal: (targetKind: "group" | "board", targetId: string) => void;
  openConfirmModal: (payload: any) => void;

  maybeSendMessageRead: (peerId: string, upToId?: number | null) => void;

  acceptAuth: (peer: string) => void;
  declineAuth: (peer: string) => void;
  cancelAuth: (peer: string) => void;

  copyText: (text: string) => Promise<boolean>;

  pickAvatarFor?: (kind: any, id: string) => void;
  removeAvatar?: (kind: any, id: string) => void;
  drainOutbox?: () => void;
  ensureVirtualHistoryIndexVisible?: (key: string, convLen: number, idx: number, searchActive: boolean) => void;
}

export interface ContextMenuActionsFeature {
  handleContextMenuAction: (itemId: string) => Promise<void>;
}

export function createContextMenuActionsFeature(deps: ContextMenuActionsFeatureDeps): ContextMenuActionsFeature {
  const {
    store,
    send,
    closeModal,
    clearMsgContextSelection,
    getMsgContextSelection,
    showToast,
    clearComposerHelper,
    resolveComposerHelperDraft,
    scheduleFocusComposer,
    getComposerText,
    applyComposerInput,
    getSendMenuDraft,
    buildSendMenuDraftFromComposer,
    sendChat,
    openSendScheduleModalWithDraft,
    setPage,
    openGroupCreateModal,
    openBoardCreateModal,
    logout,
    openUserPage,
    openGroupPage,
    openBoardPage,
    selectTarget,
    isChatMessageSelectable,
    toggleChatSelection,
    setChatSelectionAnchorIdx,
    closeMobileSidebar,
    beginFileDownload,
    openChatSearch,
    setChatSearchQuery,
    openEmojiPopoverForReaction,
    jumpToChatMsgIdx,
    buildHelperDraft,
    openForwardModal,
    beginEditingMessage,
    openMembersAddModal,
    openMembersRemoveModal,
    openRenameModal,
    openConfirmModal,
    maybeSendMessageRead,
    acceptAuth,
    declineAuth,
    cancelAuth,
    copyText,
    pickAvatarFor,
    removeAvatar,
    drainOutbox,
    ensureVirtualHistoryIndexVisible,
  } = deps;

  let pinnedJumpSeq = 0;

  async function handleContextMenuAction(itemId: string) {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "context_menu") return;
    const t = modal.payload.target;

    const close = () => {
      clearMsgContextSelection();
      closeModal();
    };

    if (itemId.startsWith("pinned_jump:")) {
      const msgId = Math.trunc(Number(itemId.slice("pinned_jump:".length)));
      const key = t.kind === "pinned_messages" ? String(t.id || "").trim() : st.selected ? conversationKey(st.selected) : "";
      if (!key || !Number.isFinite(msgId) || msgId <= 0) {
        close();
        return;
      }
      const conv = st.conversations[key] || [];
      const idx = conv.findIndex((m) => typeof (m as any)?.id === "number" && (m as any).id === msgId);
      close();
      store.set((prev) => ({ ...prev, pinnedMessageActive: { ...prev.pinnedMessageActive, [key]: msgId } }));
      const doJump = (index: number) => {
        const snap = store.get();
        const list = snap.conversations[key] || [];
        const searchActive = Boolean(snap.chatSearchOpen && snap.chatSearchQuery.trim());
        ensureVirtualHistoryIndexVisible?.(key, list.length, index, searchActive);
        if (!ensureVirtualHistoryIndexVisible) {
          const start = resolveVirtualStartForIndex(list.length, index, 160);
          store.set((prev) => ({
            ...prev,
            historyVirtualStart: { ...(prev.historyVirtualStart || {}), [key]: start },
          }));
        }
        window.setTimeout(() => jumpToChatMsgIdx(index), 0);
      };
      if (idx >= 0) {
        doJump(idx);
        return;
      }

      pinnedJumpSeq += 1;
      const seq = pinnedJumpSeq;
      let cancelled = false;
      showToast("Загружаем историю…", {
        kind: "info",
        timeoutMs: 25000,
        actions: [{ id: "cancel", label: "Отменить", onClick: () => { cancelled = true; } }],
      });
      void (async () => {
        const shouldCancel = () => {
          if (cancelled) return true;
          if (seq !== pinnedJumpSeq) return true;
          const snap = store.get();
          const snapKey = snap.selected ? conversationKey(snap.selected) : "";
          return snapKey !== key;
        };
        const res = await ensureChatMessageLoadedById({
          store,
          send,
          chatKey: key,
          msgId,
          maxPages: 10,
          limit: 200,
          stepTimeoutMs: 2600,
          shouldCancel,
        });
        if (shouldCancel()) return;
        if (res.status === "found") {
          showToast("История загружена", { kind: "success", timeoutMs: 2500 });
          doJump(res.idx);
          return;
        }
        if (res.status === "cancelled") {
          showToast("Отменено", { kind: "info", timeoutMs: 2500 });
          return;
        }
        if (res.status === "no_conn") {
          showToast("Нет соединения", { kind: "warn", timeoutMs: 6000 });
          return;
        }
        if (res.status === "timeout") {
          showToast("Не удалось загрузить историю (таймаут)", { kind: "warn", timeoutMs: 7000 });
          return;
        }
        showToast("Сообщение недоступно", { kind: "info", timeoutMs: 6000 });
      })();
      return;
    }

    if (itemId === "pinned_unpin_all") {
      const key = t.kind === "pinned_messages" ? String(t.id || "").trim() : st.selected ? conversationKey(st.selected) : "";
      const ids = key ? st.pinnedMessages[key] : null;
      if (!key || !Array.isArray(ids) || !ids.length) {
        close();
        return;
      }
      close();
      openConfirmModal({
        title: "Открепить все сообщения",
        message: "Открепить все закреплённые сообщения в этом чате?",
        confirmLabel: "Открепить",
        cancelLabel: "Отмена",
        danger: true,
        action: { kind: "pinned_messages_unpin_all", chatKey: key },
      });
      return;
    }

    if (itemId === "composer_helper_cancel") {
      close();
      clearComposerHelper();
      scheduleFocusComposer();
      return;
    }

    if (itemId === "composer_helper_reply_another") {
      close();
      clearComposerHelper();
      showToast("Выберите сообщение и нажмите «Ответить»", { kind: "info" });
      scheduleFocusComposer();
      return;
    }

    if (itemId === "composer_helper_show_message") {
      const helper = resolveComposerHelperDraft(st);
      close();
      if (!helper || helper.kind !== "reply") return;
      const selKey = st.selected ? conversationKey(st.selected) : "";
      if (!selKey || helper.key !== selKey) {
        showToast("Откройте чат, где вы отвечаете", { kind: "warn" });
        return;
      }
      const conv = st.conversations[selKey] || [];
      const msgId = typeof helper.draft.id === "number" && Number.isFinite(helper.draft.id) ? Math.trunc(helper.draft.id) : null;
      const localId = typeof helper.draft.localId === "string" ? helper.draft.localId.trim() : "";
      const idx = msgId !== null ? conv.findIndex((m) => typeof m.id === "number" && m.id === msgId) : localId ? conv.findIndex((m) => String(m.localId || "") === localId) : -1;
      if (idx < 0) {
        showToast("Сообщение пока не загружено", { kind: "info" });
        return;
      }
      const searchActive = Boolean(st.chatSearchOpen && st.chatSearchQuery.trim());
      ensureVirtualHistoryIndexVisible?.(selKey, conv.length, idx, searchActive);
      jumpToChatMsgIdx(idx);
      return;
    }

    if (itemId === "composer_helper_quote") {
      const helper = resolveComposerHelperDraft(st);
      close();
      if (!helper || helper.kind !== "reply") return;
      const selKey = st.selected ? conversationKey(st.selected) : "";
      if (!selKey || helper.key !== selKey) {
        showToast("Откройте чат, где вы отвечаете", { kind: "warn" });
        return;
      }
      if (st.editing) {
        showToast("Сначала завершите редактирование", { kind: "warn" });
        return;
      }
      const conv = st.conversations[selKey] || [];
      const msgId = typeof helper.draft.id === "number" && Number.isFinite(helper.draft.id) ? Math.trunc(helper.draft.id) : null;
      const localId = typeof helper.draft.localId === "string" ? helper.draft.localId.trim() : "";
      const idx = msgId !== null ? conv.findIndex((m) => typeof m.id === "number" && m.id === msgId) : localId ? conv.findIndex((m) => String(m.localId || "") === localId) : -1;
      const msg = idx >= 0 ? conv[idx] : null;
      if (!msg) {
        showToast("Сообщение пока не загружено", { kind: "info" });
        return;
      }
      const rawText = String(msg.text || "").replace(/\r\n?/g, "\n");
      const trimmedText = rawText.trimEnd();
      const text = trimmedText && !trimmedText.startsWith("[file]") ? trimmedText : "";
      const fileName = msg.attachment?.kind === "file" ? String(msg.attachment.name || "").trim() : "";
      const quoteBody = text || fileName;
      if (!quoteBody) {
        showToast("Нечего цитировать", { kind: "warn" });
        return;
      }
      const quoted = quoteBody
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      const prevValue = getComposerText();
      const base = prevValue.trimEnd();
      const nextInput = base ? `${base}\n\n${quoted}\n` : `${quoted}\n`;
      applyComposerInput(nextInput);
      clearComposerHelper();
      scheduleFocusComposer();
      return;
    }

    if (itemId === "composer_send_when_online") {
      const draft = (t.kind === "composer_send" ? getSendMenuDraft() : null) ?? buildSendMenuDraftFromComposer(st);
      close();
      if (!draft) return;
      sendChat({
        mode: "when_online",
        target: draft.target,
        text: draft.text,
        replyDraft: draft.replyDraft,
        forwardDraft: draft.forwardDraft,
        preserveComposer: draft.preserveComposer,
      });
      return;
    }
    if (itemId === "composer_send_silent") {
      const draft = (t.kind === "composer_send" ? getSendMenuDraft() : null) ?? buildSendMenuDraftFromComposer(st);
      close();
      if (!draft) return;
      sendChat({
        silent: true,
        target: draft.target,
        text: draft.text,
        replyDraft: draft.replyDraft,
        forwardDraft: draft.forwardDraft,
        preserveComposer: draft.preserveComposer,
      });
      return;
    }
    if (itemId === "composer_send_schedule") {
      const draft = (t.kind === "composer_send" ? getSendMenuDraft() : null) ?? buildSendMenuDraftFromComposer(st);
      close();
      if (!draft) return;
      openSendScheduleModalWithDraft(draft);
      return;
    }

    if (itemId === "sidebar_profile") {
      close();
      setPage("profile");
      const stSnapshot = store.get();
      if (stSnapshot.authed && stSnapshot.conn === "connected") {
        send({ type: "profile_get" });
      }
      return;
    }
    if (itemId === "sidebar_search") {
      close();
      setPage("search");
      return;
    }
    if (itemId === "sidebar_files") {
      close();
      setPage("files");
      return;
    }
    if (itemId === "sidebar_info") {
      close();
      setPage("help");
      return;
    }
    if (itemId === "sidebar_create_chat") {
      close();
      openGroupCreateModal();
      return;
    }
    if (itemId === "sidebar_create_board") {
      close();
      openBoardCreateModal();
      return;
    }
    if (itemId === "sidebar_login") {
      close();
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        modal: { kind: "auth" },
      }));
      return;
    }
    if (itemId === "sidebar_logout") {
      close();
      logout();
      return;
    }

    if (itemId === "react_picker") {
      if (t.kind !== "message") {
        close();
        return;
      }
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения" });
        close();
        return;
      }
      if (!st.authed) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(t.id)) ? Math.trunc(Number(t.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
      if (!selKey || !msg || msgId === null || msgId <= 0) {
        close();
        return;
      }
      close();
      openEmojiPopoverForReaction({ key: selKey, msgId });
      return;
    }

    if (itemId.startsWith("react:")) {
      if (t.kind !== "message") {
        close();
        return;
      }
      const emoji = String(itemId.slice("react:".length) || "").trim();
      if (!emoji) {
        close();
        return;
      }
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения" });
        close();
        return;
      }
      if (!st.authed) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(t.id)) ? Math.trunc(Number(t.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
      if (!msg || msgId === null || msgId <= 0) {
        close();
        return;
      }
      const mine = typeof msg.reactions?.mine === "string" ? msg.reactions.mine : null;
      const nextEmoji = mine === emoji ? null : emoji;
      send({ type: "reaction_set", id: msgId, emoji: nextEmoji });
      close();
      return;
    }

    if (itemId === "pin_toggle") {
      if (t.kind !== "dm" && t.kind !== "group" && t.kind !== "board") {
        close();
        return;
      }
      const key = t.kind === "dm" ? dmKey(t.id) : roomKey(t.id);
      const next = togglePin(st.pinned, key);
      store.set({ pinned: next });
      if (st.selfId) savePinsForUser(st.selfId, next);
      if (st.conn === "connected" && st.authed) {
        send({ type: "prefs_set", values: { chat_pins: sanitizePins(next) } });
      }
      close();
      return;
    }

    if (itemId === "archive_toggle") {
      if (t.kind !== "dm" && t.kind !== "group" && t.kind !== "board") {
        close();
        return;
      }
      const key = t.kind === "dm" ? dmKey(t.id) : roomKey(t.id);
      const next = toggleArchived(st.archived, key);
      store.set({ archived: next });
      if (st.selfId) saveArchivedForUser(st.selfId, next);
      if (st.conn === "connected" && st.authed) {
        send({ type: "prefs_set", values: { chat_archived: sanitizeArchived(next) } });
      }
      close();
      return;
    }

    if (itemId === "folder_create") {
      close();
      const st2 = store.get();
      if (!st2.authed || !st2.selfId) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      if (st2.chatFolders.length >= 20) {
        showToast("Лимит папок: 20", { kind: "warn" });
        return;
      }
      const titleRaw = window.prompt("Название папки", "");
      if (titleRaw === null) return;
      const title = String(titleRaw || "").trim();
      if (!title) {
        showToast("Пустое название папки", { kind: "warn" });
        return;
      }
      const used = new Set(st2.chatFolders.map((f) => String(f.id || "").trim()).filter(Boolean));
      const makeId = (): string => {
        const base = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
        const id = base.length > 40 ? base.slice(0, 40) : base;
        return /^[a-z0-9_-]{1,40}$/.test(id) ? id : `f_${Date.now().toString(36)}`;
      };
      let fid = makeId();
      for (let i = 0; i < 8 && used.has(fid); i += 1) fid = makeId();
      const includeKey = t.kind === "dm" ? dmKey(t.id) : t.kind === "group" || t.kind === "board" ? roomKey(t.id) : "";
      const nextFolders = [
        ...st2.chatFolders,
        { id: fid, title, include: includeKey ? [includeKey] : [], exclude: [] },
      ];
      const snap = sanitizeChatFoldersSnapshot({ v: 1, active: fid, folders: nextFolders });
      store.set((prev) => applySidebarFolderMutation(prev, snap));
      saveChatFoldersForUser(st2.selfId, snap);
      if (st2.conn === "connected" && st2.authed) {
        send({ type: "prefs_set", values: { chat_folders: snap } });
      }
      showToast("Папка создана", { kind: "success" });
      return;
    }

    if (itemId.startsWith("folder_toggle:")) {
      if (t.kind !== "dm" && t.kind !== "group" && t.kind !== "board") {
        close();
        return;
      }
      const st2 = store.get();
      const fid = String(itemId.slice("folder_toggle:".length) || "").trim().toLowerCase();
      if (!fid) {
        close();
        return;
      }
      const key = t.kind === "dm" ? dmKey(t.id) : roomKey(t.id);
      const nextFolders = st2.chatFolders.map((f) => {
        if (String(f.id || "").trim().toLowerCase() !== fid) return f;
        const has = Array.isArray(f.include) ? f.include.includes(key) : false;
        const nextInclude = has ? f.include.filter((k) => k !== key) : [...(Array.isArray(f.include) ? f.include : []), key];
        return { ...f, include: nextInclude };
      });
      const snap = sanitizeChatFoldersSnapshot({ v: 1, active: st2.sidebarFolderId, folders: nextFolders });
      store.set((prev) => applySidebarFolderMutation(prev, snap));
      if (st2.selfId) saveChatFoldersForUser(st2.selfId, snap);
      if (st2.conn === "connected" && st2.authed) {
        send({ type: "prefs_set", values: { chat_folders: snap } });
      }
      close();
      return;
    }

    if (itemId.startsWith("folder_rename:")) {
      close();
      const st2 = store.get();
      if (!st2.authed || !st2.selfId) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      const fid = String(itemId.slice("folder_rename:".length) || "").trim().toLowerCase();
      if (!fid) return;
      const folder = st2.chatFolders.find((f) => String(f.id || "").trim().toLowerCase() === fid) || null;
      if (!folder) return;
      const titleRaw = window.prompt("Новое название папки", String(folder.title || ""));
      if (titleRaw === null) return;
      const title = String(titleRaw || "").trim();
      if (!title) {
        showToast("Пустое название папки", { kind: "warn" });
        return;
      }
      const nextFolders = st2.chatFolders.map((f) => (String(f.id || "").trim().toLowerCase() === fid ? { ...f, title } : f));
      const snap = sanitizeChatFoldersSnapshot({ v: 1, active: st2.sidebarFolderId, folders: nextFolders });
      store.set((prev) => applySidebarFolderMutation(prev, snap));
      saveChatFoldersForUser(st2.selfId, snap);
      if (st2.conn === "connected" && st2.authed) {
        send({ type: "prefs_set", values: { chat_folders: snap } });
      }
      showToast("Папка переименована", { kind: "success" });
      return;
    }

    if (itemId.startsWith("folder_delete:")) {
      close();
      const st2 = store.get();
      if (!st2.authed || !st2.selfId) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      const fid = String(itemId.slice("folder_delete:".length) || "").trim().toLowerCase();
      if (!fid) return;
      const folder = st2.chatFolders.find((f) => String(f.id || "").trim().toLowerCase() === fid) || null;
      if (!folder) return;
      const ok = window.confirm(`Удалить папку «${String(folder.title || "Папка")}»?`);
      if (!ok) return;
      const nextFolders = st2.chatFolders.filter((f) => String(f.id || "").trim().toLowerCase() !== fid);
      const nextActive = String(st2.sidebarFolderId || "").trim().toLowerCase() === fid ? "all" : st2.sidebarFolderId;
      const snap = sanitizeChatFoldersSnapshot({ v: 1, active: nextActive, folders: nextFolders });
      store.set((prev) => applySidebarFolderMutation(prev, snap));
      saveChatFoldersForUser(st2.selfId, snap);
      if (st2.conn === "connected" && st2.authed) {
        send({ type: "prefs_set", values: { chat_folders: snap } });
      }
      showToast("Папка удалена", { kind: "success" });
      return;
    }

    if (itemId === "msg_profile") {
      if (t.kind !== "message") {
        close();
        return;
      }
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(t.id)) ? Math.trunc(Number(t.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const fromId = msg?.from ? String(msg.from).trim() : "";
      if (fromId) openUserPage(fromId);
      close();
      return;
    }

    if (itemId === "profile") {
      if (t.kind !== "dm") {
        close();
        return;
      }
      openUserPage(t.id);
      close();
      return;
    }

    if (itemId === "avatar_set") {
      const kind = avatarKindForTarget(t.kind);
      if (kind) pickAvatarFor?.(kind, t.id);
      close();
      return;
    }
    if (itemId === "avatar_remove") {
      const kind = avatarKindForTarget(t.kind);
      if (kind) removeAvatar?.(kind, t.id);
      close();
      return;
    }

    if (itemId === "group_profile" && t.kind === "group") {
      openGroupPage(t.id);
      close();
      return;
    }
    if (itemId === "board_profile" && t.kind === "board") {
      openBoardPage(t.id);
      close();
      return;
    }

    if (itemId === "open") {
      if (t.kind === "dm" || t.kind === "group" || t.kind === "board") {
        selectTarget({ kind: t.kind, id: t.id });
      }
      close();
      return;
    }

    if (itemId === "chat_select_messages") {
      const sel = st.selected;
      if (!sel || st.page !== "main") {
        close();
        return;
      }
      if (t.kind !== sel.kind || t.id !== sel.id) {
        close();
        return;
      }
      const key = conversationKey(sel);
      const conv = key ? st.conversations[key] : null;
      if (!key || !Array.isArray(conv) || !conv.length) {
        showToast("Нет сообщений для выбора", { kind: "info" });
        close();
        return;
      }
      const selectionActive = Boolean(st.chatSelection && st.chatSelection.key === key && st.chatSelection.ids?.length);
      if (selectionActive) {
        close();
        return;
      }
      let idx = -1;
      let msg: ChatMessage | null = null;
      for (let i = conv.length - 1; i >= 0; i -= 1) {
        const candidate = conv[i];
        if (isChatMessageSelectable(candidate)) {
          idx = i;
          msg = candidate;
          break;
        }
      }
      if (!msg || idx < 0) {
        showToast("Нет сообщений для выбора", { kind: "info" });
        close();
        return;
      }
      toggleChatSelection(key, msg);
      setChatSelectionAnchorIdx(idx);
      showToast("Выберите сообщения", { kind: "info" });
      close();
      return;
    }

    if (itemId === "invite_user") {
      if (t.kind !== "dm") {
        close();
        return;
      }
      if (st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        close();
        return;
      }
      closeMobileSidebar();
      store.set({ modal: { kind: "invite_user", peer: t.id } });
      return;
    }

    if (itemId === "copy_id") {
      const ok = await copyText(t.id);
      store.set({ status: ok ? `Скопировано: ${t.id}` : `Не удалось скопировать: ${t.id}` });
      showToast(ok ? `Скопировано: ${t.id}` : `Не удалось скопировать: ${t.id}`, { kind: ok ? "success" : "error" });
      close();
      return;
    }

    if (t.kind === "message") {
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(t.id)) ? Math.trunc(Number(t.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
      const msgSelection = getMsgContextSelection();
      const selectedText =
        msgSelection && msgSelection.key === selKey && msgSelection.idx === idx ? msgSelection.text : "";

      if (itemId === "msg_copy") {
        const caption = msg?.attachment?.kind === "file" ? String(msg?.text || "").trim() : "";
        const text = selectedText
          ? selectedText
          : msg?.attachment?.kind === "file"
            ? (caption || String(msg.attachment.name || "файл"))
            : String(msg?.text || "");
        const ok = await copyText(text);
        showToast(ok ? "Скопировано" : "Не удалось скопировать", { kind: ok ? "success" : "error" });
        close();
        return;
      }

      if (itemId === "msg_reactions") {
        if (!selKey || !msg || msgId === null || msgId <= 0) {
          close();
          return;
        }
        close();
        store.set({ modal: { kind: "reactions", chatKey: selKey, msgId } });
        return;
      }

      if (itemId === "msg_quote") {
        if (!selKey || !msg) {
          close();
          return;
        }
        if (st.editing) {
          showToast("Сначала завершите редактирование", { kind: "warn" });
          close();
          return;
        }
        const rawText = String(msg.text || "").replace(/\r\n?/g, "\n");
        const trimmedText = rawText.trimEnd();
        const text = trimmedText && !trimmedText.startsWith("[file]") ? trimmedText : "";
        const fileName = msg.attachment?.kind === "file" ? String(msg.attachment.name || "").trim() : "";
        const quoteBody = selectedText || text || fileName;
        if (!quoteBody) {
          showToast("Нечего цитировать", { kind: "warn" });
          close();
          return;
        }
        const quoted = quoteBody
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        const prevValue = getComposerText();
        const base = prevValue.trimEnd();
        const nextInput = base ? `${base}\n\n${quoted}\n` : `${quoted}\n`;
        store.set({ forwardDraft: null });
        applyComposerInput(nextInput);
        scheduleFocusComposer();
        close();
        return;
      }

      if (itemId === "msg_search_selection") {
        if (!selectedText) {
          close();
          return;
        }
        close();
        openChatSearch();
        setChatSearchQuery(selectedText);
        return;
      }

      if (itemId === "msg_send_now") {
        if (!selKey || !conv || !msg) {
          close();
          return;
        }
        const localId = typeof msg.localId === "string" ? msg.localId.trim() : "";
        if (!localId) {
          close();
          return;
        }
        if (!st.authed) {
          store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
          return;
        }
        const list = st.outbox?.[selKey] || [];
        const has = Array.isArray(list) && list.some((e) => String(e?.localId || "").trim() === localId);
        if (!has) {
          showToast("Не найдено в очереди отправки", { kind: "warn" });
          close();
          return;
        }
        store.set((prev) => {
          const outbox = updateOutboxEntry(prev.outbox, selKey, localId, (e) => {
            const { whenOnline, scheduleAt, ...rest } = e as any;
            return rest;
          });
          const cur = prev.conversations[selKey] || [];
          if (!Array.isArray(cur) || !cur.length) return { ...prev, outbox };
          if (idx < 0 || idx >= cur.length) return { ...prev, outbox };
          const next = [...cur];
          const { scheduleAt: sa, whenOnline: wo, ...msgRest } = next[idx] as any;
          next[idx] = { ...msgRest, status: next[idx].status === "sent" ? next[idx].status : "queued" };
          return { ...prev, outbox, conversations: { ...prev.conversations, [selKey]: next } };
        });
        scheduleSaveOutbox(store);
        drainOutbox?.();
        showToast("Отправляем сейчас", { kind: "info" });
        close();
        return;
      }

      if (itemId === "msg_schedule_edit") {
        if (!selKey || !msg) {
          close();
          return;
        }
        if (!st.selected) {
          close();
          return;
        }
        const localId = typeof msg.localId === "string" ? msg.localId.trim() : "";
        const scheduleAt =
          typeof msg.scheduleAt === "number" && Number.isFinite(msg.scheduleAt) && msg.scheduleAt > 0 ? Math.trunc(msg.scheduleAt) : 0;
        if (!localId || !scheduleAt) {
          close();
          return;
        }
        if (!st.authed) {
          store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
          return;
        }
        close();
        store.set({
          modal: {
            kind: "send_schedule",
            target: st.selected,
            text: String(msg.text || ""),
            suggestedAt: scheduleAt,
            edit: { key: selKey, localId },
            title: "Изменить время",
            confirmLabel: "Сохранить",
          },
        });
        return;
      }

      if (itemId === "msg_download") {
        const fileId = msg?.attachment?.kind === "file" ? String(msg.attachment.fileId || "").trim() : "";
        if (!fileId) {
          showToast("Файл ещё не готов", { kind: "warn" });
          close();
          return;
        }
        close();
        closeMobileSidebar();
        void beginFileDownload(fileId);
        return;
      }

      if (itemId === "msg_copy_link") {
        showToast("Прямые ссылки на защищённые файлы отключены", { kind: "info" });
        close();
        return;
      }

      if (itemId === "msg_view_replies") {
        if (!selKey || !conv || !msg) {
          close();
          return;
        }
        const msgLocalId = typeof msg.localId === "string" ? msg.localId.trim() : "";
        if (msgId === null && !msgLocalId) {
          close();
          return;
        }
        let firstIdx: number | null = null;
        let count = 0;
        for (let i = idx + 1; i < conv.length; i += 1) {
          const ref = conv[i]?.reply;
          if (!ref) continue;
          const refId = typeof ref.id === "number" && Number.isFinite(ref.id) ? ref.id : null;
          const refLocalId = typeof ref.localId === "string" ? ref.localId.trim() : "";
          const matchById = msgId !== null && msgId > 0 && refId === msgId;
          const matchByLocalId = msgLocalId && refLocalId && refLocalId === msgLocalId;
          if (!(matchById || matchByLocalId)) continue;
          count += 1;
          if (firstIdx === null) firstIdx = i;
        }
        if (firstIdx === null) {
          showToast("Ответов нет", { kind: "info" });
          close();
          return;
        }
        close();
        window.setTimeout(() => jumpToChatMsgIdx(firstIdx), 0);
        showToast(`Ответов: ${count}`, { kind: "info" });
        return;
      }

      if (itemId === "msg_translate") {
        const raw = String(msg?.text || "").trim();
        const text = raw && !raw.startsWith("[file]") ? raw : "";
        if (!text) {
          close();
          return;
        }
        const snippet = text.length > 1800 ? text.slice(0, 1800) : text;
        const url = `https://translate.google.com/?sl=auto&tl=ru&text=${encodeURIComponent(snippet)}&op=translate`;
        close();
        try {
          const opened = window.open(url, "_blank", "noopener,noreferrer");
          if (!opened) throw new Error("popup_blocked");
        } catch {
          const ok = await copyText(text);
          showToast(ok ? "Текст скопирован" : "Не удалось открыть переводчик", { kind: ok ? "success" : "error" });
        }
        return;
      }

      if (itemId === "msg_select_toggle") {
        if (!selKey || !msg) {
          close();
          return;
        }
        toggleChatSelection(selKey, msg);
        close();
        return;
      }

      if (itemId === "msg_pin_toggle") {
        if (!selKey || msgId === null || msgId <= 0) {
          close();
          return;
        }
        const wasPinned = isPinnedMessage(st.pinnedMessages, selKey, msgId);
        const nextPinned = togglePinnedMessage(st.pinnedMessages, selKey, msgId);
        const nextIds = nextPinned[selKey] || [];
        const nextActive = { ...st.pinnedMessageActive };
        if (!wasPinned) {
          nextActive[selKey] = msgId;
        } else if (nextActive[selKey] === msgId || !nextIds.includes(nextActive[selKey])) {
          if (nextIds.length) nextActive[selKey] = nextIds[0];
          else delete nextActive[selKey];
        }
        const nextHidden = { ...(st.pinnedBarHidden || {}) };
        delete nextHidden[selKey];
        store.set({ pinnedMessages: nextPinned, pinnedMessageActive: nextActive, pinnedBarHidden: nextHidden, chatSelection: null });
        if (st.selfId) {
          savePinnedMessagesForUser(st.selfId, nextPinned);
          savePinnedBarHiddenForUser(st.selfId, nextHidden);
        }
        showToast(wasPinned ? "Сообщение откреплено" : "Сообщение закреплено", { kind: "success" });
        close();
        return;
      }

      if (itemId === "msg_reply") {
        if (!selKey || !msg) {
          close();
          return;
        }
        const draft = buildHelperDraft(st, selKey, msg);
        if (!draft) {
          close();
          return;
        }
        store.set({ replyDraft: draft, forwardDraft: null });
        scheduleFocusComposer();
        close();
        return;
      }

      if (itemId === "msg_forward") {
        if (!selKey || !msg) {
          close();
          return;
        }
        const draft = buildHelperDraft(st, selKey, msg);
        if (!draft) {
          close();
          return;
        }
        close();
        window.setTimeout(() => openForwardModal(draft), 0);
        return;
      }

      if (itemId === "msg_edit") {
        if (!selKey || !msg || msgId === null || msgId <= 0) {
          close();
          return;
        }
        if (st.conn !== "connected" || !st.authed) {
          store.set({ status: "Нет соединения" });
          close();
          return;
        }
        beginEditingMessage(selKey, msgId, String(msg.text || ""));
        close();
        return;
      }

      if (itemId === "msg_delete_local") {
        if (!selKey || !conv || idx < 0 || idx >= conv.length) {
          close();
          return;
        }
        store.set((prev) => {
          const cur = prev.conversations[selKey];
          if (!cur || idx < 0 || idx >= cur.length) return prev;
          const deleted = cur[idx];
          const nextConv = [...cur.slice(0, idx), ...cur.slice(idx + 1)];
          if (!deleted || typeof deleted.id !== "number") {
            return { ...prev, conversations: { ...prev.conversations, [selKey]: nextConv } };
          }
          const ids = prev.pinnedMessages[selKey];
          if (!Array.isArray(ids) || !ids.includes(deleted.id)) {
            return { ...prev, conversations: { ...prev.conversations, [selKey]: nextConv } };
          }
          const nextList = ids.filter((x) => x !== deleted.id);
          const nextPinned = { ...prev.pinnedMessages };
          const nextActive = { ...prev.pinnedMessageActive };
          if (nextList.length) {
            nextPinned[selKey] = nextList;
            if (nextActive[selKey] === deleted.id || !nextList.includes(nextActive[selKey])) nextActive[selKey] = nextList[0];
          } else {
            delete nextPinned[selKey];
            delete nextActive[selKey];
          }
          if (prev.selfId) savePinnedMessagesForUser(prev.selfId, nextPinned);
          return {
            ...prev,
            conversations: { ...prev.conversations, [selKey]: nextConv },
            pinnedMessages: nextPinned,
            pinnedMessageActive: nextActive,
          };
        });
        showToast("Удалено у вас", { kind: "success" });
        close();
        return;
      }

      if (itemId === "msg_delete") {
        if (msgId === null || msgId <= 0) {
          close();
          return;
        }
        if (st.conn !== "connected" || !st.authed) {
          store.set({ status: "Нет соединения" });
          close();
          return;
        }
        send({ type: "message_delete", id: msgId });
        store.set({ status: "Удаляем сообщение…" });
        close();
        return;
      }

      close();
      return;
    }

    if (st.conn !== "connected" || !st.authed) {
      store.set({ status: "Нет соединения" });
      close();
      return;
    }

    if (itemId === "mark_read" && t.kind === "dm") {
      maybeSendMessageRead(t.id);
      showToast("Отмечено прочитанным", { kind: "success" });
      close();
      return;
    }

    if (itemId === "group_add_members" && t.kind === "group") {
      const g = st.groups.find((x) => x.id === t.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может добавлять участников" });
        close();
        return;
      }
      openMembersAddModal("group", t.id);
      return;
    }
    if (itemId === "board_add_members" && t.kind === "board") {
      const b = st.boards.find((x) => x.id === t.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может добавлять участников" });
        close();
        return;
      }
      openMembersAddModal("board", t.id);
      return;
    }

    if (itemId === "mute_toggle" && (t.kind === "dm" || t.kind === "group" || t.kind === "board")) {
      const nextValue = !st.muted.includes(t.id);
      send({ type: "mute_set", peer: t.id, value: nextValue });
      showToast(nextValue ? `Заглушено: ${t.id}` : `Звук включён: ${t.id}`, {
        kind: "info",
        undo: () => send({ type: "mute_set", peer: t.id, value: !nextValue }),
      });
      close();
      return;
    }
    if (itemId === "block_toggle" && (t.kind === "dm" || t.kind === "auth_in" || t.kind === "auth_out")) {
      const nextValue = !st.blocked.includes(t.id);
      send({ type: "block_set", peer: t.id, value: nextValue });
      showToast(nextValue ? `Заблокировано: ${t.id}` : `Разблокировано: ${t.id}`, {
        kind: nextValue ? "warn" : "info",
        undo: () => send({ type: "block_set", peer: t.id, value: !nextValue }),
      });
      close();
      return;
    }
    if (itemId === "chat_clear" && t.kind === "dm") {
      openConfirmModal({
        title: "Очистить историю?",
        message: `Удалить всю историю переписки с ${t.id}?`,
        confirmLabel: "Очистить",
        danger: true,
        action: { kind: "chat_clear", peer: t.id },
      });
      return;
    }
    if (itemId === "room_clear" && (t.kind === "group" || t.kind === "board")) {
      const entry = t.kind === "group" ? st.groups.find((x) => x.id === t.id) : st.boards.find((x) => x.id === t.id);
      const name = String(entry?.name || t.id);
      const ownerId = String(entry?.owner_id || "").trim();
      const isOwner = Boolean(ownerId && st.selfId && ownerId === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может очистить историю" });
        close();
        return;
      }
      const label = t.kind === "group" ? "чате" : "доске";
      openConfirmModal({
        title: "Очистить историю (для всех)?",
        message: `Удалить всю историю в ${label} «${name}» для всех участников?`,
        confirmLabel: "Очистить",
        danger: true,
        action: { kind: "room_clear", roomId: t.id },
      });
      return;
    }
    if (itemId === "friend_remove" && t.kind === "dm") {
      openConfirmModal({
        title: "Удалить контакт?",
        message: `Удалить контакт ${t.id} из списка?`,
        confirmLabel: "Удалить",
        danger: true,
        action: { kind: "friend_remove", peer: t.id },
      });
      return;
    }
    if (itemId === "group_rename" && t.kind === "group") {
      const g = st.groups.find((x) => x.id === t.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может переименовать чат" });
        close();
        return;
      }
      openRenameModal("group", t.id);
      return;
    }
    if (itemId === "board_rename" && t.kind === "board") {
      const b = st.boards.find((x) => x.id === t.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может переименовать доску" });
        close();
        return;
      }
      openRenameModal("board", t.id);
      return;
    }
    if (itemId === "group_remove_members" && t.kind === "group") {
      const g = st.groups.find((x) => x.id === t.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может удалять участников" });
        close();
        return;
      }
      openMembersRemoveModal("group", t.id);
      return;
    }
    if (itemId === "board_remove_members" && t.kind === "board") {
      const b = st.boards.find((x) => x.id === t.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может удалять участников" });
        close();
        return;
      }
      openMembersRemoveModal("board", t.id);
      return;
    }
    if (itemId === "group_disband" && t.kind === "group") {
      openConfirmModal({
        title: "Удалить чат?",
        message: "Это удалит чат для всех участников. Действие необратимо.",
        confirmLabel: "Удалить чат",
        danger: true,
        action: { kind: "group_disband", groupId: t.id },
      });
      return;
    }
    if (itemId === "board_disband" && t.kind === "board") {
      openConfirmModal({
        title: "Удалить доску?",
        message: "Это удалит доску для всех участников. Действие необратимо.",
        confirmLabel: "Удалить доску",
        danger: true,
        action: { kind: "board_disband", boardId: t.id },
      });
      return;
    }
    if (itemId === "group_leave" && t.kind === "group") {
      openConfirmModal({
        title: "Покинуть чат?",
        message: "Вы перестанете получать сообщения из этого чата.",
        confirmLabel: "Выйти",
        danger: true,
        action: { kind: "group_leave", groupId: t.id },
      });
      return;
    }
    if (itemId === "board_leave" && t.kind === "board") {
      openConfirmModal({
        title: "Покинуть доску?",
        message: "Вы перестанете видеть обновления этой доски.",
        confirmLabel: "Выйти",
        danger: true,
        action: { kind: "board_leave", boardId: t.id },
      });
      return;
    }
    if (itemId === "auth_accept" && t.kind === "auth_in") {
      acceptAuth(t.id);
      close();
      return;
    }
    if (itemId === "auth_decline" && t.kind === "auth_in") {
      declineAuth(t.id);
      close();
      return;
    }
    if (itemId === "auth_cancel" && t.kind === "auth_out") {
      cancelAuth(t.id);
      close();
      return;
    }

    close();
  }

  return { handleContextMenuAction };
}
