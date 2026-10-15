import type { CtxClickSuppressionState } from "../../../helpers/ui/ctxClickSuppression";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, ContextMenuTargetKind, MobileSidebarTab } from "../../../stores/types";
import { createChatLongPressContextMenuFeature } from "../contextMenu/chatLongPressContextMenuFeature";
import { createChatMouseContextMenuFeature, type ChatMsgContextSelection } from "../contextMenu/chatMouseContextMenuFeature";
import { createChatReplySwipeFeature } from "../contextMenu/chatReplySwipeFeature";
import { createChatSelectionDragFeature } from "../history/chatSelectionDragFeature";
import { createSidebarClickSuppressionFeature } from "../sidebar/sidebarClickSuppressionFeature";
import { createSidebarContextMenuScrollFeature } from "../sidebar/sidebarContextMenuScrollFeature";
import { createSidebarKeyboardContextMenuFeature } from "../sidebar/sidebarKeyboardContextMenuFeature";
import { createSidebarLongPressContextMenuFeature } from "../sidebar/sidebarLongPressContextMenuFeature";
import { createSidebarMouseContextMenuFeature } from "../sidebar/sidebarMouseContextMenuFeature";
import { createSidebarSwipeTabsFeature } from "../sidebar/sidebarSwipeTabsFeature";

export interface SidebarChatContextInteractionsFeatureDeps {
  store: Store<AppState>;
  sidebar: HTMLElement;
  sidebarBody: HTMLElement;
  chat: HTMLElement;
  chatHost: HTMLElement;
  coarsePointerMq: MediaQueryList | null;
  mobileSidebarMq: MediaQueryList;
  isMobileSidebarOpen: () => boolean;
  setMobileSidebarTab: (tab: MobileSidebarTab) => void;
  isChatMessageSelectable: (msg: ChatMessage | null | undefined) => boolean;
  setChatSelectionValueAtIdx: (key: string, idx: number, value: boolean) => void;
  setChatSelectionAnchorIdx: (idx: number) => void;
  setSuppressMsgSelectToggleClickUntil: (until: number) => void;
  setSuppressChatClickUntil: (until: number) => void;
  getSuppressChatClickUntil: () => number;
  setMsgContextSelection: (selection: ChatMsgContextSelection) => void;
  openContextMenu: (target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) => void;
  onReplySwipeCommit: (swipeKey: string, swipeIdx: number) => void;
}

export function installSidebarChatContextInteractionsFeature(
  deps: SidebarChatContextInteractionsFeatureDeps
): void {
  const {
    store,
    sidebar,
    sidebarBody,
    chat,
    chatHost,
    coarsePointerMq,
    mobileSidebarMq,
    isMobileSidebarOpen,
    setMobileSidebarTab,
    isChatMessageSelectable,
    setChatSelectionValueAtIdx,
    setChatSelectionAnchorIdx,
    setSuppressMsgSelectToggleClickUntil,
    setSuppressChatClickUntil,
    getSuppressChatClickUntil,
    setMsgContextSelection,
    openContextMenu,
    onReplySwipeCommit,
  } = deps;

  let sidebarCtxClickSuppression: CtxClickSuppressionState = { key: null, until: 0 };
  const sidebarContextMenuScrollFeature = createSidebarContextMenuScrollFeature({
    sidebarBody,
    isContextMenuOpen: () => {
      const st = store.get();
      return Boolean(st.modal && st.modal.kind === "context_menu");
    },
  });

  store.subscribe(() => {
    const st = store.get();
    if (!st.modal || st.modal.kind !== "context_menu") {
      sidebarContextMenuScrollFeature.disarmSidebarCtxScrollHold();
    }
  });

  const sidebarMouseContextMenuFeature = createSidebarMouseContextMenuFeature({
    store,
    sidebar,
    coarsePointerMq,
    sidebarContextMenuScrollFeature,
    getClickSuppressionState: () => sidebarCtxClickSuppression,
    setClickSuppressionState: (state) => {
      sidebarCtxClickSuppression = state;
    },
    openContextMenu,
  });
  sidebarMouseContextMenuFeature.installEventListeners();

  const sidebarKeyboardContextMenuFeature = createSidebarKeyboardContextMenuFeature({
    store,
    sidebar,
    openContextMenu,
  });
  sidebarKeyboardContextMenuFeature.installEventListeners();

  const sidebarLongPressContextMenuFeature = createSidebarLongPressContextMenuFeature({
    store,
    sidebar,
    sidebarBody,
    getClickSuppressionState: () => sidebarCtxClickSuppression,
    setClickSuppressionState: (state) => {
      sidebarCtxClickSuppression = state;
    },
    openContextMenu,
  });
  sidebarLongPressContextMenuFeature.installEventListeners();

  const sidebarSwipeTabsFeature = createSidebarSwipeTabsFeature({
    store,
    sidebar,
    sidebarBody,
    mobileSidebarMq,
    isMobileSidebarOpen: () => isMobileSidebarOpen(),
    setMobileSidebarTab: (tab) => {
      setMobileSidebarTab(tab);
    },
    armSidebarClickSuppression: (ms) => {
      sidebarContextMenuScrollFeature.armSidebarClickSuppression(ms);
    },
    onClearLongPress: () => {
      sidebarLongPressContextMenuFeature.clearLongPress();
    },
  });
  sidebarSwipeTabsFeature.installEventListeners();

  const sidebarClickSuppressionFeature = createSidebarClickSuppressionFeature({
    sidebar,
    getClickSuppressionState: () => sidebarCtxClickSuppression,
    setClickSuppressionState: (state) => {
      sidebarCtxClickSuppression = state;
    },
    isSidebarClickSuppressed: () => sidebarContextMenuScrollFeature.isSidebarClickSuppressed(),
    disarmSidebarClickSuppression: () => {
      sidebarContextMenuScrollFeature.disarmSidebarClickSuppression();
    },
  });
  sidebarClickSuppressionFeature.installEventListeners();

  const chatSelectionDragFeature = createChatSelectionDragFeature({
    store,
    chat,
    isChatMessageSelectable: (msg) => isChatMessageSelectable(msg),
    setChatSelectionValueAtIdx: (key, idx, value) => {
      setChatSelectionValueAtIdx(key, idx, value);
    },
    setChatSelectionAnchorIdx: (idx) => {
      setChatSelectionAnchorIdx(idx);
    },
    suppressMsgSelectToggleClickFor: (ms) => {
      setSuppressMsgSelectToggleClickUntil(Date.now() + Math.max(0, Math.trunc(ms)));
    },
  });
  chatSelectionDragFeature.installEventListeners();

  const chatMouseContextMenuFeature = createChatMouseContextMenuFeature({
    store,
    chat,
    coarsePointerMq,
    setMsgContextSelection: (selection) => {
      setMsgContextSelection(selection);
    },
    openContextMenu,
  });
  chatMouseContextMenuFeature.installEventListeners();

  const chatLongPressContextMenuFeature = createChatLongPressContextMenuFeature({
    store,
    chat,
    chatHost,
    suppressChatClickFor: (ms) => {
      setSuppressChatClickUntil(Date.now() + Math.max(0, Math.trunc(ms)));
    },
    openContextMenu,
  });
  chatLongPressContextMenuFeature.installEventListeners();

  const chatReplySwipeFeature = createChatReplySwipeFeature({
    store,
    chat,
    chatHost,
    isChatClickSuppressed: () => Date.now() < getSuppressChatClickUntil(),
    onClearLongPress: () => {
      chatLongPressContextMenuFeature.clearLongPress();
    },
    onReplySwipeCommit,
  });
  chatReplySwipeFeature.installEventListeners();
}
