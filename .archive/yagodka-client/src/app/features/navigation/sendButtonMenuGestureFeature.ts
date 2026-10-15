import { armCtxClickSuppression, consumeCtxClickSuppression, type CtxClickSuppressionState } from "../../../helpers/ui/ctxClickSuppression";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface SendButtonMenuGestureFeatureDeps {
  store: Store<AppState>;
  openSendMenu: (x: number, y: number) => void;
}

export interface SendButtonMenuGestureFeature {
  bind: (sendBtn: HTMLButtonElement) => void;
  consumeSuppressedSendClick: (event: Event) => boolean;
}

export function createSendButtonMenuGestureFeature(deps: SendButtonMenuGestureFeatureDeps): SendButtonMenuGestureFeature {
  const { store, openSendMenu } = deps;

  let sendMenuClickSuppression: CtxClickSuppressionState = { key: null, until: 0 };
  let sendMenuLongPressTimer: number | null = null;
  let sendMenuLongPressStartX = 0;
  let sendMenuLongPressStartY = 0;

  const clearSendMenuLongPress = () => {
    if (sendMenuLongPressTimer !== null) {
      window.clearTimeout(sendMenuLongPressTimer);
      sendMenuLongPressTimer = null;
    }
  };

  const bind = (sendBtn: HTMLButtonElement) => {
    sendBtn.addEventListener("contextmenu", (e) => {
      const ev = e as MouseEvent;
      ev.preventDefault();
      openSendMenu(ev.clientX, ev.clientY);
    });

    sendBtn.addEventListener("pointerdown", (e) => {
      const st = store.get();
      if (st.modal) return;
      const ev = e as PointerEvent;
      if (ev.button !== 0) return;
      clearSendMenuLongPress();
      sendMenuLongPressStartX = ev.clientX;
      sendMenuLongPressStartY = ev.clientY;
      sendMenuLongPressTimer = window.setTimeout(() => {
        sendMenuLongPressTimer = null;
        sendMenuClickSuppression = armCtxClickSuppression(sendMenuClickSuppression, "composer_send", "send", 2000);
        openSendMenu(sendMenuLongPressStartX, sendMenuLongPressStartY);
      }, 520);
    });

    sendBtn.addEventListener("pointermove", (e) => {
      if (sendMenuLongPressTimer === null) return;
      const ev = e as PointerEvent;
      const dx = Math.abs(ev.clientX - sendMenuLongPressStartX);
      const dy = Math.abs(ev.clientY - sendMenuLongPressStartY);
      if (dx > 12 || dy > 12) clearSendMenuLongPress();
    });

    sendBtn.addEventListener("pointerup", () => clearSendMenuLongPress());
    sendBtn.addEventListener("pointercancel", () => clearSendMenuLongPress());
  };

  const consumeSuppressedSendClick = (event: Event): boolean => {
    const consumed = consumeCtxClickSuppression(sendMenuClickSuppression, "composer_send", "send");
    sendMenuClickSuppression = consumed.state;
    if (!consumed.suppressed) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  return {
    bind,
    consumeSuppressedSendClick,
  };
}
