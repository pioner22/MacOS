import { conversationKey } from "../../../helpers/chat/conversationKey";
import { getActiveConversationTarget } from "../../../helpers/navigation/mainConversationState";
import type { Store } from "../../../stores/store";
import type { AppState, ContextMenuItem, MessageHelperDraft, TargetRef } from "../../../stores/types";

export type SendMenuDraft = {
  target: TargetRef;
  text: string;
  replyDraft: MessageHelperDraft | null;
  forwardDraft: MessageHelperDraft | null;
  preserveComposer: boolean;
};

export interface ComposerSendMenuFeatureDeps {
  store: Store<AppState>;
  getComposerRawText: () => string;
  markUserActivity: () => void;
}

export interface ComposerSendMenuFeature {
  getSendMenuDraft: () => SendMenuDraft | null;
  clearSendMenuDraft: () => void;
  buildSendMenuDraftFromComposer: (st: AppState) => SendMenuDraft | null;
  openSendMenuWithDraft: (x: number, y: number, draft: SendMenuDraft) => void;
  openSendMenu: (x: number, y: number) => void;
  openSendScheduleModalWithDraft: (draft: SendMenuDraft) => void;
  openSendScheduleModal: () => void;
}

export function createComposerSendMenuFeature(deps: ComposerSendMenuFeatureDeps): ComposerSendMenuFeature {
  const { store, getComposerRawText, markUserActivity } = deps;

  let sendMenuDraft: SendMenuDraft | null = null;

  const getComposerFinalText = (st: AppState): string => {
    const raw = String(getComposerRawText() || "");
    const text = raw.trimEnd();
    const activeConversation = getActiveConversationTarget(st);
    const key = activeConversation ? conversationKey(activeConversation) : "";
    const forwardDraft = st.forwardDraft && key && st.forwardDraft.key === key ? st.forwardDraft : null;
    const forwardFallback = !text && forwardDraft ? String(forwardDraft.text || forwardDraft.preview || "") : "";
    return text || forwardFallback;
  };

  const buildSendMenuDraftFromComposer = (st: AppState): SendMenuDraft | null => {
    const sel = getActiveConversationTarget(st);
    if (!sel) return null;
    const key = conversationKey(sel);
    const replyDraft = st.replyDraft && st.replyDraft.key === key ? st.replyDraft : null;
    const forwardDraft = st.forwardDraft && st.forwardDraft.key === key ? st.forwardDraft : null;
    return {
      target: sel,
      text: getComposerFinalText(st),
      replyDraft,
      forwardDraft,
      preserveComposer: false,
    };
  };

  const openSendMenuWithDraft = (x: number, y: number, draft: SendMenuDraft) => {
    const st = store.get();
    if (st.modal) return;
    markUserActivity();
    const sel = draft.target;
    const key = conversationKey(sel);
    const editing = st.editing && key && st.editing.key === key;
    const friend = sel.kind === "dm" ? st.friends.find((f) => f.id === sel.id) : null;
    const friendKnown = Boolean(friend);
    const friendOnline = Boolean(friend?.online);
    const isSelf = sel.kind === "dm" && st.selfId && String(sel.id) === String(st.selfId);
    const canSend = Boolean(String(draft.text || "").trim());
    const canSendNow = canSend && !editing;
    const whenOnlineAllowed = sel.kind === "dm" && friendKnown && !friendOnline && !editing;

    const items: ContextMenuItem[] = [
      ...(!isSelf ? [{ id: "composer_send_silent", label: "Отправить без звука", icon: "🔕", disabled: !canSendNow }] : []),
      { id: "composer_send_schedule", label: isSelf ? "Напомнить" : "Запланировать", icon: "🗓", disabled: !canSendNow },
      ...(whenOnlineAllowed ? [{ id: "composer_send_when_online", label: "Когда будет онлайн", icon: "🕓", disabled: !canSend }] : []),
    ];

    sendMenuDraft = draft;
    store.set({
      modal: {
        kind: "context_menu",
        payload: {
          x,
          y,
          title: isSelf ? "Напоминание" : "Отправка",
          target: { kind: "composer_send", id: sel.id },
          items,
        },
      },
    });
  };

  const openSendMenu = (x: number, y: number) => {
    const st = store.get();
    if (st.modal) return;
    const sel = getActiveConversationTarget(st);
    if (!sel) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }
    const draft = buildSendMenuDraftFromComposer(st);
    if (!draft) return;
    openSendMenuWithDraft(x, y, draft);
  };

  const openSendScheduleModalWithDraft = (draft: SendMenuDraft) => {
    const st = store.get();
    if (st.modal) return;
    const sel = draft.target;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const key = conversationKey(sel);
    const editing = st.editing && key && st.editing.key === key ? st.editing : null;
    if (editing) {
      store.set({ status: "Сначала завершите редактирование" });
      return;
    }
    const text = String(draft.text || "").trimEnd();
    if (!text) {
      store.set({ status: "Введите сообщение" });
      return;
    }
    const isSelf = sel.kind === "dm" && st.selfId && String(sel.id) === String(st.selfId);
    store.set({
      modal: {
        kind: "send_schedule",
        target: sel,
        text,
        replyDraft: draft.replyDraft,
        forwardDraft: draft.forwardDraft,
        suggestedAt: Date.now() + 60 * 60 * 1000,
        preserveComposer: draft.preserveComposer,
        ...(isSelf ? { title: "Напоминание", confirmLabel: "Создать" } : {}),
      },
    });
  };

  const openSendScheduleModal = () => {
    const st = store.get();
    if (st.modal) return;
    const sel = getActiveConversationTarget(st);
    if (!sel) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }
    const draft = buildSendMenuDraftFromComposer(st);
    if (!draft) return;
    openSendScheduleModalWithDraft(draft);
  };

  const clearSendMenuDraft = () => {
    sendMenuDraft = null;
  };

  const getSendMenuDraft = () => sendMenuDraft;

  return {
    getSendMenuDraft,
    clearSendMenuDraft,
    buildSendMenuDraftFromComposer,
    openSendMenuWithDraft,
    openSendMenu,
    openSendScheduleModalWithDraft,
    openSendScheduleModal,
  };
}
