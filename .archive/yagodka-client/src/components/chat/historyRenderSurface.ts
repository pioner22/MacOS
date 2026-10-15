import { messageSelectionKey } from "../../helpers/chat/chatSelection";
import type { AppState, ChatMessage, ConversationHistoryEmptyNotice } from "../../stores/types";
import { el } from "../../helpers/dom/el";
import { applyHistoryGroupGeometry } from "./historyGroupGeometry";
import { buildHistoryLayoutBlocks } from "./historyLayoutModel";
import { renderDateSeparator, renderUnreadSeparator } from "./historySeparatorShell";
import { renderDeferredAlbumLine } from "./chatDeferredMediaRuntime";
import { messageLine, skeletonMsg, type AlbumItem } from "./renderChatHelpers";

export interface BuildHistoryRenderSurfaceOptions {
  state: AppState;
  msgs: ChatMessage[];
  key: string;
  mobileUi: boolean;
  boardUi: boolean;
  friendLabels?: Map<string, string>;
  selectionCount: number;
  selectionSet: Set<string> | null;
  hitSet: Set<number> | null;
  activeMsgIdx: number | null;
  historyLoaded: boolean;
  historyEmptyNotice?: ConversationHistoryEmptyNotice | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadingMoreSlotCount: number;
  loadingInitial: boolean;
  virtualEnabled: boolean;
  virtualStart: number;
  virtualEnd: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  unreadInsertIdx: number;
  unreadCount: number;
  albumLayout: { maxWidth: number; minWidth: number; spacing: number };
}

export interface HistoryRenderSurfaceResult {
  lines: HTMLElement[];
  isEmptyState: boolean;
}

function resolveAlbumSelectionState(items: AlbumItem[], selectionSet: Set<string> | null) {
  let selectedCount = 0;
  let selectableCount = 0;
  for (const item of items) {
    const selKey = messageSelectionKey(item.msg);
    if (!selKey) continue;
    selectableCount += 1;
    if (selectionSet && selectionSet.has(selKey)) selectedCount += 1;
  }
  const anySelected = selectedCount > 0;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;
  const partial = anySelected && !allSelected;
  return { anySelected, allSelected, partial };
}

function contextMenuMessageIdx(state: AppState, key: string): number | null {
  const modal = state.modal;
  if (!modal || modal.kind !== "context_menu" || modal.payload.target.kind !== "message") return null;
  if (!state.selected || conversationKeyForState(state) !== key) return null;
  const idx = Math.trunc(Number(modal.payload.target.id));
  return Number.isFinite(idx) && idx >= 0 ? idx : null;
}

function conversationKeyForState(state: AppState): string {
  const selected = state.selected;
  if (!selected) return "";
  return selected.kind === "dm" ? `dm:${selected.id}` : `room:${selected.id}`;
}

function renderHistoryEmptyNotice(state: AppState, notice: ConversationHistoryEmptyNotice): HTMLElement {
  const selfId = String(state.selfId || "").trim();
  const by = String(notice.by || "").trim();
  const remote = Boolean(by && selfId && by !== selfId);
  const scope = notice.scope;
  const title =
    notice.kind === "message_deleted"
      ? scope === "room"
        ? remote
          ? "Сообщение удалено участником"
          : "Сообщение удалено"
        : remote
          ? "Сообщение удалено собеседником"
          : "Сообщение удалено"
      : scope === "room"
        ? remote
          ? "История очищена участником"
          : "История очищена"
        : remote
          ? "История очищена собеседником"
          : "История очищена";
  const sub = notice.kind === "message_deleted" ? "История чата сейчас пуста" : "Сообщения удалены с обеих сторон";
  return el(
    "div",
    {
      class: "chat-empty chat-empty-cleared",
      role: "status",
      "aria-live": "polite",
      "data-empty-notice": notice.kind,
    },
    [
      el("span", { class: "chat-empty-cleared-mark", "aria-hidden": "true" }, [""]),
      el("span", { class: "chat-empty-copy" }, [
        el("span", { class: "chat-empty-title" }, [title]),
        el("span", { class: "chat-empty-sub" }, [sub]),
      ]),
    ]
  );
}

export function buildHistoryRenderSurface(opts: BuildHistoryRenderSurfaceOptions): HistoryRenderSurfaceResult {
  const {
    state,
    msgs,
    key,
    mobileUi,
    boardUi,
    friendLabels,
    selectionCount,
    selectionSet,
    hitSet,
    activeMsgIdx,
    historyLoaded,
    historyEmptyNotice,
    hasMore,
    loadingMore,
    loadingMoreSlotCount,
    loadingInitial,
    virtualEnabled,
    virtualStart,
    virtualEnd,
    topSpacerHeight,
    bottomSpacerHeight,
    unreadInsertIdx,
    unreadCount,
    albumLayout,
  } = opts;
  const activeContextMsgIdx = contextMenuMessageIdx(state, key);

  const lineItems: HTMLElement[] = [];
  const lines: HTMLElement[] = [];

  const historyBlocks = buildHistoryLayoutBlocks({
    msgs,
    state,
    mobileUi,
    boardUi,
    virtualStart,
    virtualEnd,
    unreadInsertIdx,
    unreadCount,
  });
  for (const block of historyBlocks) {
    if (block.kind === "date") {
      lineItems.push(renderDateSeparator(block.ts));
      continue;
    }
    if (block.kind === "unread") {
      lineItems.push(renderUnreadSeparator(block.unreadCount));
      continue;
    }
    if (block.kind === "album") {
      const groupCounts = resolveAlbumSelectionState(block.items, selectionSet);
      const line = renderDeferredAlbumLine({
        state,
        items: block.items,
        friendLabels,
        opts: {
          selectionMode: selectionCount > 0,
          selected: groupCounts.allSelected,
          partial: groupCounts.partial,
          groupStartIdx: block.startIdx,
          groupEndIdx: block.endIdx,
          albumLayout,
        },
      });
      const lastItem = block.items[block.items.length - 1];
      const groupMsgId = Number(lastItem?.msg?.id ?? NaN);
      const groupMsgKey = lastItem ? messageSelectionKey(lastItem.msg) : "";
      applyHistoryGroupGeometry(line, block.continues, block.tail);
      if (groupCounts.anySelected) line.classList.add("msg-selected");
      if (hitSet && block.items.some((item) => hitSet.has(item.idx))) line.classList.add("msg-hit");
      if (activeMsgIdx !== null && block.items.some((item) => item.idx === activeMsgIdx)) line.classList.add("msg-hit-active");
      if (activeContextMsgIdx !== null && block.items.some((item) => item.idx === activeContextMsgIdx)) line.classList.add("msg-context-active");
      line.setAttribute("data-msg-idx", String(block.endIdx));
      line.setAttribute("data-msg-group-start", String(block.startIdx));
      line.setAttribute("data-msg-group-end", String(block.endIdx));
      if (Number.isFinite(groupMsgId)) line.setAttribute("data-msg-id", String(groupMsgId));
      if (groupMsgKey) line.setAttribute("data-msg-key", groupMsgKey);
      lineItems.push(line);
      continue;
    }

    const msg = msgs[block.msgIdx];
    const msgKey = messageSelectionKey(msg);
    const selected = Boolean(selectionSet && msgKey && selectionSet.has(msgKey));
    const line = messageLine(state, msg, friendLabels, {
      mobileUi,
      boardUi,
      msgIdx: block.msgIdx,
      selectionMode: selectionCount > 0,
      selected,
    });
    applyHistoryGroupGeometry(line, block.continues, block.tail);
    line.setAttribute("data-msg-idx", String(block.msgIdx));
    const msgId = Number(msg.id ?? NaN);
    if (Number.isFinite(msgId)) line.setAttribute("data-msg-id", String(msgId));
    if (msgKey) line.setAttribute("data-msg-key", msgKey);
    if (selected) line.classList.add("msg-selected");
    if (hitSet?.has(block.msgIdx)) line.classList.add("msg-hit");
    if (activeMsgIdx === block.msgIdx) line.classList.add("msg-hit-active");
    if (activeContextMsgIdx === block.msgIdx) line.classList.add("msg-context-active");
    lineItems.push(line);
  }

  if (key && hasMore && loadingMore) {
    const loader = el("div", { class: "chat-history-loader", role: "status", "aria-live": "polite" }, ["Загрузка…"]);
    const loadingNodes: HTMLElement[] = [el("div", { class: "chat-history-more-wrap" }, [loader])];
    const slotCount = Math.max(0, Math.trunc(Number(loadingMoreSlotCount || 0) || 0));
    for (let i = 0; i < slotCount; i += 1) {
      const slot = skeletonMsg(i % 2 === 0 ? "in" : "out", i);
      slot.classList.add("chat-history-slot");
      slot.setAttribute("data-history-slot", String(i));
      loadingNodes.push(slot);
    }
    lineItems.unshift(...loadingNodes);
  }

  if (key && !historyLoaded && !loadingInitial && lineItems.length) {
    const retry = el(
      "button",
      {
        class: "btn chat-history-more",
        type: "button",
        "data-action": "chat-history-retry",
        "aria-label": "Повторить загрузку истории",
      },
      ["Повторить загрузку"]
    );
    lineItems.unshift(el("div", { class: "chat-history-more-wrap" }, [retry]));
  }

  let isEmptyState = false;
  if (!lineItems.length) {
    if (historyEmptyNotice) {
      lines.push(renderHistoryEmptyNotice(state, historyEmptyNotice));
      isEmptyState = true;
    } else if (!historyLoaded) {
      if (loadingInitial) {
        for (let i = 0; i < 7; i += 1) {
          lines.push(skeletonMsg(i % 2 === 0 ? "in" : "out", i));
        }
      } else {
        lines.push(
          el("div", { class: "chat-empty chat-empty-retry" }, [
            el("div", { class: "chat-empty-title" }, ["История не загружена"]),
            el("div", { class: "chat-empty-sub" }, ["Проверьте соединение и попробуйте снова"]),
            el(
              "button",
              { class: "btn chat-history-more", type: "button", "data-action": "chat-history-retry", "aria-label": "Повторить загрузку истории" },
              ["Повторить загрузку"]
            ),
          ])
        );
        isEmptyState = true;
      }
    } else {
      lines.push(el("div", { class: "chat-empty" }, [el("div", { class: "chat-empty-title" }, ["Пока нет сообщений"])]));
      isEmptyState = true;
    }
  } else {
    if (virtualEnabled && topSpacerHeight > 0) {
      const spacer = el("div", { class: "chat-virtual-spacer", "data-virtual-spacer": "top", "aria-hidden": "true" });
      spacer.style.height = `${topSpacerHeight}px`;
      lines.push(spacer);
    }
    lines.push(...lineItems);
    if (virtualEnabled && bottomSpacerHeight > 0) {
      const spacer = el("div", { class: "chat-virtual-spacer", "data-virtual-spacer": "bottom", "aria-hidden": "true" });
      spacer.style.height = `${bottomSpacerHeight}px`;
      lines.push(spacer);
    }
  }

  return { lines, isEmptyState };
}
