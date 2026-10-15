import { conversationKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState, ContextMenuTargetKind } from "../../../stores/types";

export type ChatMsgContextSelection = { key: string; idx: number; text: string } | null;

export interface ChatMouseContextMenuFeatureDeps {
  store: Store<AppState>;
  chat: HTMLElement;
  coarsePointerMq: MediaQueryList | null;
  setMsgContextSelection: (selection: ChatMsgContextSelection) => void;
  openContextMenu: (target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) => void;
}

export interface ChatMouseContextMenuFeature {
  installEventListeners: () => void;
  dispose: () => void;
}

export function createChatMouseContextMenuFeature(deps: ChatMouseContextMenuFeatureDeps): ChatMouseContextMenuFeature {
  const { store, chat, coarsePointerMq, setMsgContextSelection, openContextMenu } = deps;

  let listenersInstalled = false;

  const isContextClick = (ev: { button: number; ctrlKey: boolean }) => ev.button === 2 || (ev.button === 0 && ev.ctrlKey);

  const findMsgRow = (target: EventTarget | null) => (target as HTMLElement | null)?.closest("[data-msg-idx]") as HTMLElement | null;

  const onPointerDown = (e: Event) => {
    const st = store.get();
    if (st.modal) return;
    const ev = e as PointerEvent;
    if (ev.pointerType !== "mouse") return;
    if (!isContextClick(ev)) return;
    const row = findMsgRow(ev.target);
    if (!row) return;
    ev.preventDefault();
  };

  const onMouseDown = (e: Event) => {
    const st = store.get();
    if (st.modal) return;
    const ev = e as MouseEvent;
    if (!isContextClick(ev)) return;
    const row = findMsgRow(ev.target);
    if (!row) return;
    ev.preventDefault();
  };

  const onContextMenu = (e: Event) => {
    const ev = e as MouseEvent;
    const isTouchContext = Boolean(coarsePointerMq?.matches) && ev.button === 0;
    if (isTouchContext) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    const st = store.get();
    if (st.modal) return;
    if (!st.selected) return;
    const row = findMsgRow(ev.target);
    if (!row) return;
    const idx = String(row.getAttribute("data-msg-idx") || "").trim();
    if (!idx) return;

    const selKey = conversationKey(st.selected);
    const idxNum = Number.isFinite(Number(idx)) ? Math.trunc(Number(idx)) : -1;
    setMsgContextSelection(null);
    try {
      const sel = document.getSelection?.();
      const text = sel ? String(sel.toString() || "").trim() : "";
      if (text && sel?.anchorNode && sel?.focusNode && row.contains(sel.anchorNode) && row.contains(sel.focusNode) && idxNum >= 0) {
        const safeText = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
        setMsgContextSelection({ key: selKey, idx: idxNum, text: safeText });
      }
    } catch {
      setMsgContextSelection(null);
    }
    ev.preventDefault();
    openContextMenu({ kind: "message", id: idx }, ev.clientX, ev.clientY);
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    chat.addEventListener("pointerdown", onPointerDown, true);
    chat.addEventListener("mousedown", onMouseDown, true);
    chat.addEventListener("contextmenu", onContextMenu);
    listenersInstalled = true;
  }

  function dispose() {
    if (!listenersInstalled) return;
    chat.removeEventListener("pointerdown", onPointerDown, true);
    chat.removeEventListener("mousedown", onMouseDown, true);
    chat.removeEventListener("contextmenu", onContextMenu);
    listenersInstalled = false;
  }

  return {
    installEventListeners,
    dispose,
  };
}
