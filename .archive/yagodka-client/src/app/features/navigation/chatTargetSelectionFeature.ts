import { conversationKey } from "../../../helpers/chat/conversationKey";
import { createChatSearchCounts } from "../../../helpers/chat/chatSearch";
import { updateDraftMap } from "../../../helpers/chat/drafts";
import { getConversationViewportKey, getConversationViewportTarget } from "../../../helpers/navigation/mainConversationState";
import { applyDraftMapMutation } from "../../../helpers/runtime/deliverySync";
import { syncRightPanelWithSelected } from "../../../helpers/navigation/rightPanelState";
import { sanitizeTargetRef } from "../../../helpers/navigation/viewState";
import { shouldAutofocusComposer } from "../../../helpers/ui/autofocusPolicy";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";

export interface ChatTargetSelectionFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  coarsePointerMq: MediaQueryList;
  anyFinePointerMq: MediaQueryList;
  hoverMq: MediaQueryList;
  mobileSidebarMq: MediaQueryList;
  floatingSidebarMq: MediaQueryList;
  closeEmojiPopover: () => void;
  closeMobileSidebar: (opts?: { suppressStickBottomRestore?: boolean }) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setFloatingSidebarOpen: (open: boolean) => void;
  autosizeInput: (el: HTMLTextAreaElement) => void;
  scheduleBoardEditorPreview: () => void;
  scheduleFocusComposer: () => void;
  markChatAutoScroll: (key: string, waitForHistory?: boolean) => void;
  applyConversationLimits: (
    prev: AppState,
    activeKey: string
  ) => { conversations: AppState["conversations"]; historyCursor: AppState["historyCursor"] } | null;
  requestHistory: (target: TargetRef, opts?: { force?: boolean; deltaLimit?: number; prefetchBefore?: boolean }) => void;
  maybeSendMessageRead: (peerId: string, upToId?: number | null) => void;
  scheduleSaveDrafts: () => void;
  saveLastActiveTarget: (userId: string, target: TargetRef) => void;
}

export interface ChatTargetSelectionFeature {
  selectTarget: (target: TargetRef) => void;
  clearSelectedTarget: () => void;
}

export function createChatTargetSelectionFeature(
  deps: ChatTargetSelectionFeatureDeps
): ChatTargetSelectionFeature {
  const {
    store,
    input,
    coarsePointerMq,
    anyFinePointerMq,
    hoverMq,
    mobileSidebarMq,
    floatingSidebarMq,
    closeEmojiPopover,
    closeMobileSidebar,
    setMobileSidebarOpen,
    setFloatingSidebarOpen,
    autosizeInput,
    scheduleBoardEditorPreview,
    scheduleFocusComposer,
    markChatAutoScroll,
    applyConversationLimits,
    requestHistory,
    maybeSendMessageRead,
    scheduleSaveDrafts,
    saveLastActiveTarget,
  } = deps;

  const selectTarget = (target: TargetRef) => {
    closeEmojiPopover();
    const composerHadFocus = document.activeElement === input;
    const prev = store.get();
    const prevTarget = getConversationViewportTarget(prev);
    if (prev.page === "main" && prevTarget && prevTarget.kind === target.kind && prevTarget.id === target.id) {
      closeMobileSidebar();
      if (
        shouldAutofocusComposer({
          coarsePointer: coarsePointerMq.matches,
          composerHadFocus,
          anyFinePointer: anyFinePointerMq.matches,
          hover: hoverMq.matches,
        })
      ) {
        scheduleFocusComposer();
      }
      return;
    }
    const prevKey = getConversationViewportKey(prev);
    const nextKey = conversationKey(target);
    if (nextKey) {
      const cached = (prev.conversations?.[nextKey] || []).length > 0;
      const loaded = Boolean(prev.historyLoaded?.[nextKey]);
      markChatAutoScroll(nextKey, !(loaded || cached));
    }
    const leavingEdit = Boolean(prev.editing && prevKey && prev.editing.key === prevKey && prevKey !== nextKey);
    const prevText = leavingEdit ? prev.editing?.prevDraft || "" : input.value || "";
    const nextDrafts = prevKey ? updateDraftMap(prev.drafts, prevKey, prevText) : prev.drafts;
    const nextText = nextDrafts[nextKey] ?? "";
    store.set((p) => {
      const trimmed = nextKey ? applyConversationLimits(p, nextKey) : null;
      const nextRightPanel = syncRightPanelWithSelected(p, target);
      const nextReplyDraft = p.replyDraft && p.replyDraft.key === nextKey ? p.replyDraft : null;
      const nextForwardDraft =
        p.forwardDraft && nextKey
          ? p.forwardDraft.key === nextKey
            ? p.forwardDraft
            : { ...p.forwardDraft, key: nextKey }
          : null;
      return {
        ...applyDraftMapMutation(p, nextDrafts),
        selected: target,
        page: "main",
        rightPanel: nextRightPanel,
        input: nextText,
        editing: leavingEdit ? null : p.editing,
        replyDraft: nextReplyDraft,
        forwardDraft: nextForwardDraft,
        chatSelection: null,
        boardComposerOpen: target.kind === "board" ? p.boardComposerOpen : false,
        chatSearchOpen: false,
        chatSearchResultsOpen: false,
        chatSearchQuery: "",
        chatSearchDate: "",
        chatSearchFilter: "all",
        chatSearchHits: [],
        chatSearchPos: 0,
        chatSearchCounts: createChatSearchCounts(),
        ...(trimmed ? { conversations: trimmed.conversations, historyCursor: trimmed.historyCursor } : {}),
      };
    });
    closeMobileSidebar({ suppressStickBottomRestore: true });
    if (prev.authed) {
      const userId = prev.selfId || prev.authRememberedId || "";
      if (userId) saveLastActiveTarget(userId, target);
    }
    try {
      if (input.value !== nextText) input.value = nextText;
      autosizeInput(input);
      scheduleBoardEditorPreview();
    } catch {
      // ignore
    }
    scheduleSaveDrafts();
    requestHistory(target, { prefetchBefore: true });
    if (target.kind === "dm") {
      maybeSendMessageRead(target.id);
    }
    if (
      shouldAutofocusComposer({
        coarsePointer: coarsePointerMq.matches,
        composerHadFocus,
        anyFinePointer: anyFinePointerMq.matches,
        hover: hoverMq.matches,
      })
    ) {
      const pureTouch = coarsePointerMq.matches && !anyFinePointerMq.matches && !hoverMq.matches;
      if (pureTouch && !composerHadFocus) {
        window.setTimeout(() => scheduleFocusComposer(), 90);
      } else {
        scheduleFocusComposer();
      }
    }
  };

  const clearSelectedTarget = () => {
    const prev = store.get();
    const prevTarget = sanitizeTargetRef(prev.selected);
    if (!prevTarget) return;
    const prevKey = conversationKey(prevTarget);
    const prevText = input.value || "";
    const nextDrafts = prevKey ? updateDraftMap(prev.drafts, prevKey, prevText) : prev.drafts;
    store.set((p) => ({
      ...applyDraftMapMutation(p, nextDrafts),
      selected: null,
      page: "main",
      rightPanel: null,
      input: "",
      editing: null,
      replyDraft: null,
      forwardDraft: null,
      chatSelection: null,
      boardComposerOpen: false,
      chatSearchOpen: false,
      chatSearchResultsOpen: false,
      chatSearchQuery: "",
      chatSearchDate: "",
      chatSearchFilter: "all",
      chatSearchHits: [],
      chatSearchPos: 0,
      chatSearchCounts: createChatSearchCounts(),
    }));
    try {
      if (input.value) input.value = "";
      autosizeInput(input);
      scheduleBoardEditorPreview();
    } catch {
      // ignore
    }
    scheduleSaveDrafts();
    if (mobileSidebarMq.matches) {
      setMobileSidebarOpen(true);
      return;
    }
    if (floatingSidebarMq.matches) setFloatingSidebarOpen(true);
  };

  return {
    selectTarget,
    clearSelectedTarget,
  };
}
