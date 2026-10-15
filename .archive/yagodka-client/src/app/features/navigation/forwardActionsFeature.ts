import { conversationKey } from "../../../helpers/chat/conversationKey";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, MessageHelperDraft, TargetRef } from "../../../stores/types";

type SendChatPayload = {
  target?: TargetRef;
  text?: string;
  forwardDraft?: MessageHelperDraft | null;
};

type Selection = { key: string; messages: ChatMessage[]; ids: string[] } | null;

export interface ForwardActionsFeatureDeps {
  store: Store<AppState>;
  showToast: (message: string, opts?: { kind?: "info" | "success" | "warn" | "error" }) => void;
  closeModal: () => void;
  buildHelperDraft: (st: AppState, key: string, msg: ChatMessage) => MessageHelperDraft | null;
  sendChat: (opts?: SendChatPayload) => void;
  resolveChatSelection: (st: AppState) => Selection;
  prepareMembersChips?: () => void;
}

export interface ForwardActionsFeature {
  openForwardModal: (draftInput: MessageHelperDraft | MessageHelperDraft[]) => void;
  forwardFromFileViewer: () => void;
  sendForwardToTargets: (targets: TargetRef[]) => void;
  handleChatSelectionForward: () => void;
}

export function createForwardActionsFeature(deps: ForwardActionsFeatureDeps): ForwardActionsFeature {
  const { store, showToast, closeModal, buildHelperDraft, sendChat, resolveChatSelection, prepareMembersChips } = deps;

  const openForwardModal = (draftInput: MessageHelperDraft | MessageHelperDraft[]) => {
    const st = store.get();
    if (st.modal) return;
    const drafts = Array.isArray(draftInput) ? draftInput.filter(Boolean) : draftInput ? [draftInput] : [];
    if (!drafts.length) return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    prepareMembersChips?.();
    store.set({
      modal: {
        kind: "forward_select",
        forwardDraft: drafts[0],
        ...(drafts.length > 1 ? { forwardDrafts: drafts } : {}),
      },
      replyDraft: null,
      forwardDraft: null,
    });
  };

  const forwardFromFileViewer = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    if (st.editing) {
      showToast("Сначала завершите редактирование", { kind: "warn" });
      return;
    }
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;
    if (!chatKey || msgIdx === null) return;
    const conv = st.conversations[chatKey] || [];
    if (msgIdx < 0 || msgIdx >= conv.length) return;
    const msg = conv[msgIdx];
    if (!msg || msg.kind === "sys") return;
    const draft = buildHelperDraft(st, chatKey, msg);
    if (!draft) return;
    closeModal();
    window.setTimeout(() => openForwardModal(draft), 0);
  };

  const sendForwardToTargets = (targets: TargetRef[]) => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "forward_select") return;
    const drafts =
      Array.isArray(modal.forwardDrafts) && modal.forwardDrafts.length
        ? modal.forwardDrafts
        : modal.forwardDraft
          ? [modal.forwardDraft]
          : [];
    if (!drafts.length) {
      closeModal();
      return;
    }
    const seen = new Set<string>();
    const uniqueTargets = targets.filter((target) => {
      const key = conversationKey(target);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!uniqueTargets.length) return;
    const commentEl = document.getElementById("forward-comment") as HTMLTextAreaElement | null;
    const commentText = String(commentEl?.value || "")
      .replace(/\r\n?/g, "\n")
      .trim();
    const showSender = (document.getElementById("forward-show-sender") as HTMLInputElement | null)?.checked ?? true;
    const showCaption = (document.getElementById("forward-show-caption") as HTMLInputElement | null)?.checked ?? true;
    const applyForwardOptions = (draft: MessageHelperDraft): MessageHelperDraft => {
      let next = draft;
      if (!showSender && next.from) {
        next = { ...next, from: "" };
      }
      if (!showCaption && next.attachment?.kind === "file") {
        const text = String(next.text || "").trim();
        if (text && !text.startsWith("[file]")) {
          next = { ...next, text: "" };
        }
      }
      return next;
    };
    uniqueTargets.forEach((target) => {
      if (commentText) sendChat({ target, text: commentText });
      drafts.forEach((draft) => {
        sendChat({ target, text: "", forwardDraft: applyForwardOptions(draft) });
      });
    });
    store.set({ modal: null, chatSelection: null });
  };

  const buildSelectionDrafts = (st: AppState, selection: Selection): MessageHelperDraft[] => {
    if (!selection) return [];
    return selection.messages
      .map((msg) => buildHelperDraft(st, selection.key, msg))
      .filter((draft): draft is MessageHelperDraft => Boolean(draft));
  };

  const handleChatSelectionForward = () => {
    const st = store.get();
    const selection = resolveChatSelection(st);
    const drafts = buildSelectionDrafts(st, selection);
    if (!drafts.length) return;
    openForwardModal(drafts);
  };

  return {
    openForwardModal,
    forwardFromFileViewer,
    sendForwardToTargets,
    handleChatSelectionForward,
  };
}
