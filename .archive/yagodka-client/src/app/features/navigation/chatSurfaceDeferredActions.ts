import { conversationKey } from "../../../helpers/chat/conversationKey";
import { ensureChatMessageLoadedById } from "../../../helpers/chat/ensureHistoryMessage";
import { resolveVirtualStartForIndex } from "../../../helpers/chat/historyViewportCoordinator";
import { getActiveConversationKey } from "../../../helpers/navigation/mainConversationState";
import { formatTime } from "../../../helpers/time";
import type { ContextMenuItem } from "../../../stores/types";
import type { ChatSearchFilter } from "../../../helpers/chat/chatSearch";
import type { ChatSurfaceDeferredDeps } from "./chatSurfaceEventsFeature";

export function createChatSurfaceDeferredActions(deps: ChatSurfaceDeferredDeps) {
  const {
    store,
    pinnedMessagesUiActions,
    openChatSearch,
    closeChatSearch,
    stepChatSearch,
    setChatSearchDate,
    setChatSearchFilter,
    toggleChatSearchResults,
    handleSearchResultClick,
    closeMobileSidebar,
    authRequestsActions,
    groupBoardJoinActions,
    roomInviteResponsesActions,
    send,
    showToast,
    fileOffersAccept,
    beginFileDownload,
    forwardViewerSelectionActions,
    openEmojiPopoverForReaction,
    closeModal,
    requireConnectedAndAuthed,
  } = deps;

  let pinnedJumpSeq = 0;

  const findSelectedMessage = (actionEl: HTMLElement) => {
    const st = store.get();
    const row = actionEl.closest("[data-msg-idx]") as HTMLElement | null;
    const idx = row ? Math.trunc(Number(row.getAttribute("data-msg-idx") || "")) : -1;
    const key = getActiveConversationKey(st);
    const conv = key ? st.conversations[key] : null;
    const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
    const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
    return { st, key, conv, msg, msgId };
  };

  const blockPeer = (peer: string): boolean => {
    const id = String(peer || "").trim();
    if (!id) return false;
    const st = store.get();
    if (st.conn === "connected" && st.authed) {
      send({ type: "block_set", peer: id, value: true });
      showToast(`Заблокировано: ${id}`, { kind: "warn" });
      return true;
    }
    store.set({ status: "Нет соединения" });
    return false;
  };

  const handleChatClick = (action: string, actionEl: HTMLElement): void => {
    if (action === "modal-react-set") {
      const st = store.get();
      const modal = st.modal;
      if (!modal || modal.kind !== "reactions") return;
      if (!requireConnectedAndAuthed(st)) return;
      const chatKey = String(modal.chatKey || "").trim();
      const msgId = typeof modal.msgId === "number" && Number.isFinite(modal.msgId) ? Math.trunc(modal.msgId) : 0;
      const emoji = String(actionEl.getAttribute("data-emoji") || "").trim();
      if (!chatKey || !msgId || !emoji) return;
      const conv = st.conversations?.[chatKey] || [];
      const msg = conv.find((m) => typeof m?.id === "number" && Number.isFinite(m.id) && m.id === msgId) || null;
      const mine = typeof msg?.reactions?.mine === "string" ? msg.reactions.mine : null;
      send({ type: "reaction_set", id: msgId, emoji: mine === emoji ? null : emoji });
      return;
    }

    if (action === "modal-react-picker") {
      const st = store.get();
      const modal = st.modal;
      if (!modal || modal.kind !== "reactions") return;
      if (!requireConnectedAndAuthed(st)) return;
      const chatKey = String(modal.chatKey || "").trim();
      const msgId = typeof modal.msgId === "number" && Number.isFinite(modal.msgId) ? Math.trunc(modal.msgId) : 0;
      if (!chatKey || !msgId) return;
      closeModal();
      openEmojiPopoverForReaction({ key: chatKey, msgId });
      return;
    }

    if (action === "msg-react-add") {
      const { st, key, msg, msgId } = findSelectedMessage(actionEl);
      if (!requireConnectedAndAuthed(st)) return;
      if (!key || !msg || msgId === null || msgId <= 0) return;
      openEmojiPopoverForReaction({ key, msgId });
      return;
    }

    if (action === "msg-react-more") {
      const { key, msg, msgId } = findSelectedMessage(actionEl);
      if (!key || !msg || msgId === null || msgId <= 0) return;
      store.set({ modal: { kind: "reactions", chatKey: key, msgId } });
      return;
    }

    if (action === "msg-react") {
      const { st, msg, msgId } = findSelectedMessage(actionEl);
      if (!requireConnectedAndAuthed(st)) return;
      const emoji = String(actionEl.getAttribute("data-emoji") || "").trim();
      if (!emoji || !msg || msgId === null || msgId <= 0) return;
      const mine = typeof msg.reactions?.mine === "string" ? msg.reactions.mine : null;
      send({ type: "reaction_set", id: msgId, emoji: mine === emoji ? null : emoji });
      return;
    }

    if (action === "chat-pinned-hide") {
      if (pinnedMessagesUiActions.unpinActiveForSelected()) showToast("Сообщение откреплено", { kind: "success" });
      return;
    }

    if (action === "chat-pinned-list") {
      const st = store.get();
      if (st.modal) return;
      const key = getActiveConversationKey(st);
      const ids = key ? st.pinnedMessages[key] : null;
      if (!key || !Array.isArray(ids) || !ids.length) return;
      const conv = st.conversations[key] || [];
      const selfId = st.selfId ? String(st.selfId).trim() : "";
      const profiles = st.profiles || {};
      const userLabel = (uidRaw: string): string => {
        const uid = String(uidRaw || "").trim();
        if (!uid) return "—";
        if (selfId && uid === selfId) return "Вы";
        const p = profiles[uid];
        const display = p?.display_name ? String(p.display_name).trim() : "";
        if (display) return display;
        const handle = p?.handle ? String(p.handle).trim() : "";
        if (handle) return handle.startsWith("@") ? handle : `@${handle}`;
        return uid;
      };
      const formatPreview = (id: number): { label: string; subLabel: string; meta?: string } => {
        const msg = conv.find((m) => typeof m.id === "number" && m.id === id) || null;
        if (!msg) return { label: `Сообщение #${id}`, subLabel: "Не загружено" };
        const rawText = String((msg as any)?.text || "").replace(/\s+/g, " ").trim();
        const text = rawText && !rawText.startsWith("[file]") ? rawText : "";
        const att = (msg as any)?.attachment;
        const base = text || (att?.kind === "file" ? `Файл: ${String(att.name || "файл")}` : "") || `Сообщение #${id}`;
        const label = base.length > 90 ? `${base.slice(0, 87)}…` : base;
        const from = String((msg as any)?.from || "").trim();
        const subLabel = from ? userLabel(from) : "—";
        const ts = typeof (msg as any)?.ts === "number" && Number.isFinite((msg as any).ts) ? formatTime((msg as any).ts) : "";
        return { label, subLabel, ...(ts ? { meta: ts } : {}) };
      };
      const items: ContextMenuItem[] = ids.map((id) => {
        const preview = formatPreview(id);
        return {
          id: `pinned_jump:${id}`,
          label: preview.label,
          subLabel: preview.subLabel,
          ...(preview.meta ? { meta: preview.meta } : {}),
          icon: "📌",
        };
      });
      if (ids.length > 1) {
        items.push({ id: "sep-unpin-all", label: "", separator: true });
        items.push({ id: "pinned_unpin_all", label: "Открепить все", icon: "🗑️", danger: true });
      }
      const rect = actionEl.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.bottom + 6);
      store.set({
        modal: {
          kind: "context_menu",
          payload: {
            x,
            y,
            title: ids.length > 1 ? `Закреплённые (${ids.length})` : "Закреплённое",
            target: { kind: "pinned_messages", id: key },
            items,
          },
        },
      });
      return;
    }

    if (action === "chat-pinned-jump") {
      if (pinnedMessagesUiActions.jumpToActiveForSelected()) return;
      const st = store.get();
      const key = getActiveConversationKey(st);
      const ids = key ? st.pinnedMessages[key] : null;
      if (!key || !Array.isArray(ids) || !ids.length) return;
      const activeRaw = st.pinnedMessageActive?.[key];
      const activeId = typeof activeRaw === "number" && ids.includes(activeRaw) ? activeRaw : ids[0];
      if (typeof activeId !== "number" || !Number.isFinite(activeId) || activeId <= 0) return;

      if (st.pinnedMessageActive?.[key] !== activeId) {
        store.set((prev) => ({ ...prev, pinnedMessageActive: { ...prev.pinnedMessageActive, [key]: activeId } }));
      }

      const jumpWithVirtualStart = (idx: number) => {
        const start = resolveVirtualStartForIndex((store.get().conversations[key] || []).length, idx, 160);
        store.set((prev) => ({
          ...prev,
          historyVirtualStart: { ...(prev.historyVirtualStart || {}), [key]: start },
        }));
        window.setTimeout(() => {
          pinnedMessagesUiActions.jumpToActiveForSelected();
        }, 0);
      };

      const conv = st.conversations[key] || [];
      const idx = conv.findIndex((m) => typeof m?.id === "number" && Number.isFinite(m.id) && m.id === activeId);
      if (idx >= 0) {
        jumpWithVirtualStart(idx);
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
          const snapKey = getActiveConversationKey(snap);
          return snapKey !== key;
        };
        const res = await ensureChatMessageLoadedById({
          store,
          send,
          chatKey: key,
          msgId: activeId,
          maxPages: 10,
          limit: 200,
          stepTimeoutMs: 2600,
          shouldCancel,
        });
        if (shouldCancel()) return;
        if (res.status === "found") {
          showToast("История загружена", { kind: "success", timeoutMs: 2500 });
          jumpWithVirtualStart(res.idx);
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

    if (action === "chat-pinned-prev") {
      pinnedMessagesUiActions.activatePrevForSelected();
      return;
    }

    if (action === "chat-pinned-next") {
      pinnedMessagesUiActions.activateNextForSelected();
      return;
    }

    if (action === "chat-search-open") {
      openChatSearch();
      return;
    }
    if (action === "chat-search-close") {
      closeChatSearch();
      return;
    }
    if (action === "chat-search-prev") {
      stepChatSearch(-1);
      return;
    }
    if (action === "chat-search-next") {
      stepChatSearch(1);
      return;
    }
    if (action === "chat-search-date-clear") {
      setChatSearchDate("");
      return;
    }
    if (action === "chat-search-filter") {
      const filter = String(actionEl.getAttribute("data-filter") || "all") as ChatSearchFilter;
      setChatSearchFilter(filter);
      return;
    }
    if (action === "chat-search-results-toggle") {
      toggleChatSearchResults();
      return;
    }
    if (action === "chat-search-result") {
      if (actionEl instanceof HTMLButtonElement) {
        handleSearchResultClick(actionEl);
      }
      return;
    }

    if (action === "auth-accept") {
      const peer = String(actionEl.getAttribute("data-peer") || "").trim();
      if (!peer) return;
      closeMobileSidebar();
      authRequestsActions.acceptAuth(peer);
      return;
    }
    if (action === "auth-decline") {
      const peer = String(actionEl.getAttribute("data-peer") || "").trim();
      if (!peer) return;
      closeMobileSidebar();
      authRequestsActions.declineAuth(peer);
      return;
    }
    if (action === "auth-cancel") {
      const peer = String(actionEl.getAttribute("data-peer") || "").trim();
      if (!peer) return;
      closeMobileSidebar();
      authRequestsActions.cancelAuth(peer);
      return;
    }

    if (action === "group-invite-accept") {
      const groupId = String(actionEl.getAttribute("data-group-id") || "").trim();
      if (!groupId) return;
      const from = String(actionEl.getAttribute("data-from") || "").trim();
      closeMobileSidebar();
      groupBoardJoinActions.acceptGroupInvite(groupId, from);
      return;
    }
    if (action === "group-invite-decline") {
      const groupId = String(actionEl.getAttribute("data-group-id") || "").trim();
      if (!groupId) return;
      const from = String(actionEl.getAttribute("data-from") || "").trim();
      closeMobileSidebar();
      groupBoardJoinActions.declineGroupInvite(groupId, from);
      return;
    }
    if (action === "group-invite-block") {
      const groupId = String(actionEl.getAttribute("data-group-id") || "").trim();
      if (!groupId) return;
      const fromAttr = String(actionEl.getAttribute("data-from") || "").trim();
      const from = fromAttr || String(store.get().pendingGroupInvites.find((x) => x.groupId === groupId)?.from || "").trim();
      closeMobileSidebar();
      if (from) blockPeer(from);
      groupBoardJoinActions.declineGroupInvite(groupId, from);
      return;
    }

    if (action === "group-join-accept") {
      const groupId = String(actionEl.getAttribute("data-group-id") || "").trim();
      const peer = String(actionEl.getAttribute("data-peer") || "").trim();
      if (!groupId || !peer) return;
      closeMobileSidebar();
      roomInviteResponsesActions.acceptGroupJoin(groupId, peer);
      return;
    }
    if (action === "group-join-decline") {
      const groupId = String(actionEl.getAttribute("data-group-id") || "").trim();
      const peer = String(actionEl.getAttribute("data-peer") || "").trim();
      if (!groupId || !peer) return;
      closeMobileSidebar();
      roomInviteResponsesActions.declineGroupJoin(groupId, peer);
      return;
    }

    if (action === "board-invite-accept") {
      const boardId = String(actionEl.getAttribute("data-board-id") || "").trim();
      if (!boardId) return;
      closeMobileSidebar();
      roomInviteResponsesActions.joinBoardFromInvite(boardId);
      return;
    }
    if (action === "board-invite-decline") {
      const boardId = String(actionEl.getAttribute("data-board-id") || "").trim();
      if (!boardId) return;
      closeMobileSidebar();
      roomInviteResponsesActions.declineBoardInvite(boardId);
      return;
    }
    if (action === "board-invite-block") {
      const boardId = String(actionEl.getAttribute("data-board-id") || "").trim();
      if (!boardId) return;
      const fromAttr = String(actionEl.getAttribute("data-from") || "").trim();
      const from = fromAttr || String(store.get().pendingBoardInvites.find((x) => x.boardId === boardId)?.from || "").trim();
      closeMobileSidebar();
      if (from) blockPeer(from);
      roomInviteResponsesActions.declineBoardInvite(boardId);
      return;
    }

    if (action === "file-accept") {
      const fileId = String(actionEl.getAttribute("data-file-id") || "").trim();
      if (!fileId) return;
      closeMobileSidebar();
      fileOffersAccept(fileId);
      return;
    }
    if (action === "file-download") {
      const fileId = String(actionEl.getAttribute("data-file-id") || "").trim();
      if (!fileId) return;
      closeMobileSidebar();
      beginFileDownload(fileId);
    }
  };

  const handleSelectionBarClick = (action: string): void => {
    if (action === "chat-selection-forward") {
      forwardViewerSelectionActions.handleChatSelectionForward();
      return;
    }
    if (action === "chat-selection-copy") {
      void forwardViewerSelectionActions.handleChatSelectionCopy();
      return;
    }
    if (action === "chat-selection-download") {
      void forwardViewerSelectionActions.handleChatSelectionDownload();
      return;
    }
    if (action === "chat-selection-send-now") {
      forwardViewerSelectionActions.handleChatSelectionSendNow();
      return;
    }
    if (action === "chat-selection-delete") {
      forwardViewerSelectionActions.handleChatSelectionDelete();
      return;
    }
    if (action === "chat-selection-pin") {
      forwardViewerSelectionActions.handleChatSelectionPin();
    }
  };

  return {
    handleChatClick,
    handleSelectionBarClick,
  };
}
