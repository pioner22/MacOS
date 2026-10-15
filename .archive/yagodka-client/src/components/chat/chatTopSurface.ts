import { el } from "../../helpers/dom/el";
import { CHAT_SEARCH_FILTERS } from "../../helpers/chat/chatSearch";
import { messageSelectionKey } from "../../helpers/chat/chatSelection";
import { isPinnedMessage } from "../../helpers/chat/pinnedMessages";
import { hasActiveConversationSelection } from "../../helpers/navigation/mainConversationState";
import type { AppState, ChatMessage } from "../../stores/types";
import { formatSelectionCount } from "./renderChatHelpers";

export function renderChatSearchBarSurface(state: AppState, chatSearchEnabled: boolean): HTMLElement | null {
  if (!hasActiveConversationSelection(state) || !state.chatSearchOpen || !chatSearchEnabled) return null;
  const input = el("input", {
    class: "modal-input chat-search-input",
    id: "chat-search-input",
    type: "search",
    placeholder: "Найти в чате…",
    "data-ios-assistant": "off",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "search",
  }) as HTMLInputElement;
  input.value = state.chatSearchQuery || "";

  const row = el("div", { class: "chat-search-row" }, [input]);
  const filters: HTMLElement[] = [];
  const counts = state.chatSearchCounts || { all: 0, media: 0, files: 0, links: 0, music: 0, voice: 0 };
  const hasQuery = Boolean((state.chatSearchQuery || "").trim());
  if (hasQuery) {
    for (const item of CHAT_SEARCH_FILTERS) {
      const count = item.id === "all" ? counts.all : counts[item.id] || 0;
      const active = item.id === state.chatSearchFilter;
      const disabled = item.id !== "all" && count === 0;
      const btn = el(
        "button",
        {
          class: `chat-search-filter${active ? " is-active" : ""}`,
          type: "button",
          role: "tab",
          "aria-selected": active ? "true" : "false",
          "data-action": "chat-search-filter",
          "data-filter": item.id,
          ...(disabled ? { disabled: "true" } : {}),
        },
        [item.label, el("span", { class: "chat-search-filter-count" }, [String(count)])]
      );
      filters.push(btn);
    }
  }
  const filterRow = filters.length ? el("div", { class: "chat-search-filters", role: "tablist" }, filters) : null;
  return el("div", { class: "chat-search" }, [row, ...(filterRow ? [filterRow] : [])]);
}

export function renderChatSelectionBarSurface(params: {
  state: AppState;
  msgs: ChatMessage[];
  selectionSet: Set<string> | null;
  selectionCount: number;
  key: string;
}): HTMLElement | null {
  const { state, msgs, selectionSet, selectionCount, key } = params;
  if (selectionCount <= 0) return null;

  const selectedMsgs =
    selectionSet && selectionSet.size
      ? msgs.filter((msg) => {
          const selKey = messageSelectionKey(msg);
          return Boolean(selKey && selectionSet.has(selKey));
        })
      : [];

  const canCopy = selectedMsgs.some((msg) => {
    if (!msg) return false;
    const raw = String(msg.text || "").trim();
    if (raw && !raw.startsWith("[file]")) return true;
    const attachment = msg.attachment;
    if (attachment?.kind === "file") return Boolean(String(attachment.name || "").trim());
    return false;
  });

  const fileIds = (() => {
    const out = new Set<string>();
    for (const msg of selectedMsgs) {
      const fileId = msg?.attachment?.kind === "file" ? String(msg.attachment.fileId || "").trim() : "";
      if (fileId) out.add(fileId);
    }
    return out;
  })();

  const scheduledCount = selectedMsgs.filter((msg) => {
    const at = typeof msg?.scheduleAt === "number" && Number.isFinite(msg.scheduleAt) ? Math.trunc(msg.scheduleAt) : 0;
    return at > Date.now() + 1200;
  }).length;

  const pinCandidates = selectedMsgs
    .map((msg) => (typeof msg.id === "number" && Number.isFinite(msg.id) ? Math.trunc(msg.id) : 0))
    .filter((id) => id > 0);
  const canPin = pinCandidates.length === 1;
  const allPinned = canPin && pinCandidates.every((id) => isPinnedMessage(state.pinnedMessages, key, id));
  const pinLabel = allPinned ? "📍" : "📌";
  const pinTitle = allPinned ? "Открепить" : "Закрепить";

  const cancelBtn = el(
    "button",
    {
      class: "btn chat-selection-cancel",
      type: "button",
      "data-action": "chat-selection-cancel",
      "aria-label": "Отменить выбор",
    },
    ["×"]
  );
  const countNode = el("div", { class: "chat-selection-count" }, [formatSelectionCount(selectionCount)]);
  const forwardBtn = el(
    "button",
    {
      class: "btn chat-selection-action",
      type: "button",
      "data-action": "chat-selection-forward",
      "aria-label": "Переслать выбранные сообщения",
      title: "Переслать",
    },
    ["↪"]
  );
  const copyBtn = el(
    "button",
    {
      class: "btn chat-selection-action",
      type: "button",
      "data-action": "chat-selection-copy",
      "aria-label": "Скопировать выбранные сообщения",
      title: "Скопировать",
      ...(canCopy ? {} : { disabled: "true" }),
    },
    ["📋"]
  );
  const downloadBtn =
    fileIds.size > 0
      ? el(
          "button",
          {
            class: "btn chat-selection-action",
            type: "button",
            "data-action": "chat-selection-download",
            "aria-label": "Скачать выбранные файлы",
            title: "Скачать",
          },
          ["⬇️"]
        )
      : null;
  const sendNowBtn =
    scheduledCount > 0
      ? el(
          "button",
          {
            class: "btn chat-selection-action",
            type: "button",
            "data-action": "chat-selection-send-now",
            "aria-label": "Отправить сейчас выбранные сообщения из очереди",
            title: "Отправить сейчас",
          },
          ["⚡"]
        )
      : null;
  const deleteBtn = el(
    "button",
    {
      class: "btn chat-selection-action chat-selection-danger",
      type: "button",
      "data-action": "chat-selection-delete",
      "aria-label": "Удалить выбранные сообщения",
      title: "Удалить",
    },
    ["🗑️"]
  );
  const pinBtn = canPin
    ? el(
        "button",
        {
          class: "btn chat-selection-action",
          type: "button",
          "data-action": "chat-selection-pin",
          "aria-label": pinTitle,
          title: pinTitle,
        },
        [pinLabel]
      )
    : null;

  const actions = el("div", { class: "chat-selection-actions" }, [
    forwardBtn,
    copyBtn,
    ...(downloadBtn ? [downloadBtn] : []),
    ...(sendNowBtn ? [sendNowBtn] : []),
    deleteBtn,
    ...(pinBtn ? [pinBtn] : []),
  ]);
  const left = el("div", { class: "chat-selection-container-left" }, [cancelBtn, countNode]);
  const right = el("div", { class: "chat-selection-container-right" }, [actions]);
  return el("div", { class: "chat-selection-inner" }, [left, right]);
}
