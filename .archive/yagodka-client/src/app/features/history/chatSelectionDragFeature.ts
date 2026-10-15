import { messageSelectionKey } from "../../../helpers/chat/chatSelection";
import { conversationKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

type ChatSelectionDragState = {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  startIdx: number;
  lastIdx: number;
  mode: "add" | "remove";
  started: boolean;
};

const CHAT_SELECTION_CLICK_SUPPRESS_MS = 600;

export interface ChatSelectionDragFeatureDeps {
  store: Store<AppState>;
  chat: HTMLElement;
  isChatMessageSelectable: (msg: ChatMessage | null | undefined) => boolean;
  setChatSelectionValueAtIdx: (key: string, idx: number, value: boolean) => void;
  setChatSelectionAnchorIdx: (idx: number) => void;
  suppressMsgSelectToggleClickFor: (ms: number) => void;
}

export interface ChatSelectionDragFeature {
  installEventListeners: () => void;
  dispose: () => void;
}

export function createChatSelectionDragFeature(deps: ChatSelectionDragFeatureDeps): ChatSelectionDragFeature {
  const {
    store,
    chat,
    isChatMessageSelectable,
    setChatSelectionValueAtIdx,
    setChatSelectionAnchorIdx,
    suppressMsgSelectToggleClickFor,
  } = deps;

  let listenersInstalled = false;
  let chatSelectionDrag: ChatSelectionDragState | null = null;

  const onPointerDown = (e: Event) => {
    const st = store.get();
    if (st.modal) return;
    const ev = e as PointerEvent;
    if (ev.pointerType !== "mouse") return;
    if (ev.button !== 0) return;
    const btn = (ev.target as HTMLElement | null)?.closest("button[data-action='msg-select-toggle']") as HTMLButtonElement | null;
    if (!btn) return;
    const key = st.selected ? conversationKey(st.selected) : "";
    if (!key) return;
    const selection = st.chatSelection;
    if (!selection || selection.key !== key || !Array.isArray(selection.ids) || !selection.ids.length) return;
    const idxRaw = String(btn.getAttribute("data-msg-idx") || "").trim();
    const idx = Number.isFinite(Number(idxRaw)) ? Math.trunc(Number(idxRaw)) : -1;
    const conv = key ? st.conversations[key] : null;
    const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
    if (!isChatMessageSelectable(msg)) return;
    const selId = messageSelectionKey(msg);
    if (!selId) return;
    const isSelected = selection.ids.includes(selId);
    chatSelectionDrag = {
      key,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      startIdx: idx,
      lastIdx: idx,
      mode: isSelected ? "remove" : "add",
      started: false,
    };
    setChatSelectionAnchorIdx(idx);
    try {
      chat.setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
  };

  const onPointerMove = (e: Event) => {
    if (!chatSelectionDrag) return;
    const ev = e as PointerEvent;
    if (ev.pointerId !== chatSelectionDrag.pointerId) return;
    const dx = ev.clientX - chatSelectionDrag.startX;
    const dy = ev.clientY - chatSelectionDrag.startY;
    const moved = dx * dx + dy * dy;
    if (!chatSelectionDrag.started) {
      if (moved < 36) return;
      chatSelectionDrag.started = true;
      suppressMsgSelectToggleClickFor(CHAT_SELECTION_CLICK_SUPPRESS_MS);
      setChatSelectionValueAtIdx(chatSelectionDrag.key, chatSelectionDrag.startIdx, chatSelectionDrag.mode === "add");
    }
    const elAt = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const row = elAt?.closest("[data-msg-idx]") as HTMLElement | null;
    if (!row) return;
    const idx = Math.trunc(Number(row.getAttribute("data-msg-idx") || ""));
    if (!Number.isFinite(idx) || idx < 0) return;
    if (idx === chatSelectionDrag.lastIdx) return;
    chatSelectionDrag.lastIdx = idx;
    setChatSelectionValueAtIdx(chatSelectionDrag.key, idx, chatSelectionDrag.mode === "add");
    setChatSelectionAnchorIdx(idx);
    ev.preventDefault();
  };

  const stopDrag = (e: Event) => {
    if (!chatSelectionDrag) return;
    const ev = e as PointerEvent;
    if (ev.pointerId !== chatSelectionDrag.pointerId) return;
    if (chatSelectionDrag.started) suppressMsgSelectToggleClickFor(CHAT_SELECTION_CLICK_SUPPRESS_MS);
    try {
      chat.releasePointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
    chatSelectionDrag = null;
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    chat.addEventListener("pointerdown", onPointerDown, true);
    chat.addEventListener("pointermove", onPointerMove, true);
    chat.addEventListener("pointerup", stopDrag, true);
    chat.addEventListener("pointercancel", stopDrag, true);
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    chat.removeEventListener("pointerdown", onPointerDown, true);
    chat.removeEventListener("pointermove", onPointerMove, true);
    chat.removeEventListener("pointerup", stopDrag, true);
    chat.removeEventListener("pointercancel", stopDrag, true);
    chatSelectionDrag = null;
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
  };
}
