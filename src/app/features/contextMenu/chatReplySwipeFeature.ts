import { conversationKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

const MSG_SWIPE_ACTIVATE = 10;
const MSG_SWIPE_TRIGGER = 56;
const MSG_SWIPE_MAX = 84;

export interface ChatReplySwipeFeatureDeps {
  store: Store<AppState>;
  chat: HTMLElement;
  chatHost: HTMLElement;
  isChatClickSuppressed: () => boolean;
  onClearLongPress: () => void;
  onReplySwipeCommit: (conversationKey: string, msgIdx: number) => void;
}

export interface ChatReplySwipeFeature {
  installEventListeners: () => void;
  dispose: () => void;
}

export function createChatReplySwipeFeature(deps: ChatReplySwipeFeatureDeps): ChatReplySwipeFeature {
  const { store, chat, chatHost, isChatClickSuppressed, onClearLongPress, onReplySwipeCommit } = deps;

  let listenersInstalled = false;
  let msgSwipeRow: HTMLElement | null = null;
  let msgSwipeIdx = -1;
  let msgSwipeKey = "";
  let msgSwipePointerId: number | null = null;
  let msgSwipeStartX = 0;
  let msgSwipeStartY = 0;
  let msgSwipeActive = false;

  const resetMsgSwipe = () => {
    if (msgSwipeRow) {
      msgSwipeRow.style.setProperty("--msg-swipe-x", "0px");
      msgSwipeRow.style.setProperty("--msg-swipe-alpha", "0");
      msgSwipeRow.removeAttribute("data-reply-swipe");
    }
    msgSwipeRow = null;
    msgSwipeIdx = -1;
    msgSwipeKey = "";
    msgSwipePointerId = null;
    msgSwipeActive = false;
  };

  const applyMsgSwipe = (dx: number) => {
    if (!msgSwipeRow) return;
    const clamped = Math.max(0, Math.min(MSG_SWIPE_MAX, dx));
    const alpha = Math.max(0, Math.min(1, clamped / MSG_SWIPE_TRIGGER));
    msgSwipeRow.style.setProperty("--msg-swipe-x", `${clamped}px`);
    msgSwipeRow.style.setProperty("--msg-swipe-alpha", String(alpha));
    msgSwipeRow.setAttribute("data-reply-swipe", "1");
  };

  const onPointerDown = (e: Event) => {
    const st = store.get();
    if (st.modal) return;
    if (!st.selected) return;
    if (st.editing) return;
    if (isChatClickSuppressed()) return;
    const ev = e as PointerEvent;
    if (ev.pointerType === "mouse") return;
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, a, input, textarea, [contenteditable='true']")) return;
    const row = target.closest("[data-msg-idx]") as HTMLElement | null;
    if (!row) return;
    const idx = Math.trunc(Number(row.getAttribute("data-msg-idx") || ""));
    if (!Number.isFinite(idx) || idx < 0) return;
    const key = conversationKey(st.selected);
    if (!key) return;
    const conv = st.conversations[key] || null;
    const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
    if (!msg || msg.kind === "sys") return;
    msgSwipeRow = row;
    msgSwipeIdx = idx;
    msgSwipeKey = key;
    msgSwipePointerId = ev.pointerId;
    msgSwipeStartX = ev.clientX;
    msgSwipeStartY = ev.clientY;
    msgSwipeActive = false;
  };

  const onPointerMove = (e: Event) => {
    if (!msgSwipeRow || msgSwipePointerId === null) return;
    const ev = e as PointerEvent;
    if (ev.pointerId !== msgSwipePointerId) return;
    const dx = ev.clientX - msgSwipeStartX;
    const dy = ev.clientY - msgSwipeStartY;
    if (!msgSwipeActive) {
      if (dx < MSG_SWIPE_ACTIVATE) return;
      if (Math.abs(dx) < Math.abs(dy) + 12) return;
      msgSwipeActive = true;
      onClearLongPress();
    }
    if (dx <= 0) {
      applyMsgSwipe(0);
      return;
    }
    applyMsgSwipe(dx);
    ev.preventDefault();
  };

  const onPointerUp = (e: Event) => {
    if (!msgSwipeRow || msgSwipePointerId === null) return;
    const ev = e as PointerEvent;
    if (ev.pointerId !== msgSwipePointerId) return;
    const dx = ev.clientX - msgSwipeStartX;
    const shouldReply = msgSwipeActive && dx >= MSG_SWIPE_TRIGGER;
    if (shouldReply && msgSwipeKey && msgSwipeIdx >= 0) {
      onReplySwipeCommit(msgSwipeKey, msgSwipeIdx);
    }
    resetMsgSwipe();
  };

  const onPointerCancel = () => resetMsgSwipe();
  const onScroll = () => resetMsgSwipe();

  function installEventListeners() {
    if (listenersInstalled) return;
    chat.addEventListener("pointerdown", onPointerDown);
    chat.addEventListener("pointermove", onPointerMove, { passive: false });
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
    resetMsgSwipe();
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
  };
}
