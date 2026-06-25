import { conversationKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState, ContextMenuTargetKind } from "../../../stores/types";

const CHAT_LONG_PRESS_DELAY_MS = 520;
const CHAT_LONG_PRESS_MOVE_CANCEL_PX = 12;
const CHAT_LONG_PRESS_CLICK_SUPPRESS_MS = 1200;

export interface ChatLongPressContextMenuFeatureDeps {
  store: Store<AppState>;
  chat: HTMLElement;
  chatHost: HTMLElement;
  suppressChatClickFor: (ms: number) => void;
  openContextMenu: (target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) => void;
}

export interface ChatLongPressContextMenuFeature {
  installEventListeners: () => void;
  dispose: () => void;
  clearLongPress: () => void;
}

export function createChatLongPressContextMenuFeature(
  deps: ChatLongPressContextMenuFeatureDeps
): ChatLongPressContextMenuFeature {
  const { store, chat, chatHost, suppressChatClickFor, openContextMenu } = deps;

  let listenersInstalled = false;
  let msgLongPressTimer: number | null = null;
  let msgLongPressStartX = 0;
  let msgLongPressStartY = 0;
  let msgLongPressIdx = "";

  const clearLongPress = () => {
    if (msgLongPressTimer === null) return;
    window.clearTimeout(msgLongPressTimer);
    msgLongPressTimer = null;
  };

  const onPointerDown = (e: Event) => {
    const st = store.get();
    if (st.modal) return;
    if (!st.selected) return;
    if (st.chatSelection && st.selected && st.chatSelection.key === conversationKey(st.selected)) return;
    const ev = e as PointerEvent;
    // Only long-press for touch/pen (mouse has right click).
    if (ev.pointerType === "mouse") return;
    if (ev.button !== 0) return;
    const row = (ev.target as HTMLElement | null)?.closest("[data-msg-idx]") as HTMLElement | null;
    if (!row) return;
    const idx = String(row.getAttribute("data-msg-idx") || "").trim();
    if (!idx) return;

    clearLongPress();
    msgLongPressStartX = ev.clientX;
    msgLongPressStartY = ev.clientY;
    msgLongPressIdx = idx;
    msgLongPressTimer = window.setTimeout(() => {
      msgLongPressTimer = null;
      // Long-press often triggers a follow-up click; suppress it to avoid accidental open/jump.
      suppressChatClickFor(CHAT_LONG_PRESS_CLICK_SUPPRESS_MS);
      const stSnapshot = store.get();
      if (!stSnapshot.selected) return;
      const selKey = conversationKey(stSnapshot.selected);
      if (!selKey) return;
      const idxNum = Math.trunc(Number(msgLongPressIdx));
      if (!Number.isFinite(idxNum) || idxNum < 0) return;
      const conv = stSnapshot.conversations[selKey] || null;
      const msg = conv && idxNum >= 0 && idxNum < conv.length ? conv[idxNum] : null;
      if (!msg || msg.kind === "sys") return;
      openContextMenu({ kind: "message", id: msgLongPressIdx }, msgLongPressStartX, msgLongPressStartY);
    }, CHAT_LONG_PRESS_DELAY_MS);
  };

  const onPointerMove = (e: Event) => {
    if (msgLongPressTimer === null) return;
    const ev = e as PointerEvent;
    const dx = Math.abs(ev.clientX - msgLongPressStartX);
    const dy = Math.abs(ev.clientY - msgLongPressStartY);
    if (dx > CHAT_LONG_PRESS_MOVE_CANCEL_PX || dy > CHAT_LONG_PRESS_MOVE_CANCEL_PX) clearLongPress();
  };

  const onPointerUp = () => clearLongPress();
  const onPointerCancel = () => clearLongPress();
  const onScroll = () => clearLongPress();

  function installEventListeners() {
    if (listenersInstalled) return;
    chat.addEventListener("pointerdown", onPointerDown);
    chat.addEventListener("pointermove", onPointerMove);
    chat.addEventListener("pointerup", onPointerUp);
    chat.addEventListener("pointercancel", onPointerCancel);
    chatHost.addEventListener("scroll", onScroll, { passive: true });
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    chat.removeEventListener("pointerdown", onPointerDown);
    chat.removeEventListener("pointermove", onPointerMove);
    chat.removeEventListener("pointerup", onPointerUp);
    chat.removeEventListener("pointercancel", onPointerCancel);
    chatHost.removeEventListener("scroll", onScroll);
    clearLongPress();
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
    clearLongPress,
  };
}
