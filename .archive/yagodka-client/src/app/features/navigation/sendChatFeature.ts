import { conversationKey } from "../../../helpers/chat/conversationKey";
import { updateDraftMap } from "../../../helpers/chat/drafts";
import { upsertConversation } from "../../../helpers/chat/upsertConversation";
import { addOutboxEntry, makeOutboxLocalId } from "../../../helpers/chat/outbox";
import { getStoredSessionToken, isSessionAutoAuthBlocked } from "../../../helpers/auth/session";
import { getActiveConversationTarget } from "../../../helpers/navigation/mainConversationState";
import { applyDraftMapMutation, applyOutboxMutation } from "../../../helpers/runtime/deliverySync";
import { nowTs } from "../../../helpers/time";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, MessageHelperDraft, TargetRef } from "../../../stores/types";

export interface SendChatOpts {
  mode?: "now" | "when_online" | "schedule";
  scheduleAt?: number;
  silent?: boolean;
  preserveComposer?: boolean;
  target?: TargetRef;
  text?: string;
  replyDraft?: MessageHelperDraft | null;
  forwardDraft?: MessageHelperDraft | null;
}

export interface SendChatFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  appMsgMaxLen: number;
  send: (payload: any) => boolean;
  autosizeInput: (el: HTMLTextAreaElement) => void;
  scheduleBoardEditorPreview: () => void;
  markChatAutoScroll: (key: string, waitForHistory?: boolean) => void;
  scrollChatToBottom?: (key: string) => void;
  helperDraftToRef: (draft: MessageHelperDraft | null) => ChatMessage["reply"];
  scheduleSaveOutbox: () => void;
  scheduleSaveDrafts: () => void;
  drainOutbox: () => void;
}

export interface SendChatFeature {
  sendChat: (opts?: SendChatOpts) => void;
}

export function createSendChatFeature(deps: SendChatFeatureDeps): SendChatFeature {
  const {
    store,
    input,
    appMsgMaxLen,
    send,
    autosizeInput,
    scheduleBoardEditorPreview,
    markChatAutoScroll,
    scrollChatToBottom,
    helperDraftToRef,
    scheduleSaveOutbox,
    scheduleSaveDrafts,
    drainOutbox,
  } = deps;

  const sendChat = (opts?: SendChatOpts) => {
    const st = store.get();
    const rawText = typeof opts?.text === "string" ? opts.text : String(input.value || "");
    const text = rawText.trimEnd();
    const sel = opts?.target ?? getActiveConversationTarget(st);
    const key = sel ? conversationKey(sel) : "";
    const editing = st.editing && key && st.editing.key === key ? st.editing : null;
    const replyDraft =
      opts?.replyDraft !== undefined
        ? opts.replyDraft && opts.replyDraft.key === key
          ? opts.replyDraft
          : null
        : st.replyDraft && st.replyDraft.key === key
          ? st.replyDraft
          : null;
    const forwardDraft =
      opts?.forwardDraft !== undefined
        ? opts.forwardDraft && (opts?.target || opts.forwardDraft.key === key)
          ? opts.forwardDraft
          : null
        : st.forwardDraft && st.forwardDraft.key === key
          ? st.forwardDraft
          : null;
    const forwardFallback = !text && forwardDraft ? String(forwardDraft.text || forwardDraft.preview || "") : "";
    const finalText = text || forwardFallback;
    const mode = opts?.mode === "when_online" ? "when_online" : opts?.mode === "schedule" ? "schedule" : "now";
    const silent = Boolean(opts?.silent);
    const preserveComposer = Boolean(opts?.preserveComposer);
    const scheduleAtRaw = mode === "schedule" ? opts?.scheduleAt : undefined;
    const scheduleAt = typeof scheduleAtRaw === "number" && Number.isFinite(scheduleAtRaw) && scheduleAtRaw > 0 ? Math.trunc(scheduleAtRaw) : 0;
    if (!finalText) return;
    if (finalText.length > appMsgMaxLen) {
      store.set({ status: `Слишком длинное сообщение (${finalText.length}/${appMsgMaxLen})` });
      return;
    }
    if (!st.authed) {
      const token = getStoredSessionToken();
      if (token) {
        if (isSessionAutoAuthBlocked()) {
          store.set({
            authMode: st.authRememberedId ? "login" : "register",
            modal: { kind: "auth", message: "Сессия активна в другом окне. Чтобы продолжить здесь — войдите снова." },
          });
          return;
        }
        store.set({ status: "Авторизация… подождите" });
        return;
      }
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (!sel) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }

    const whenOnline = mode === "when_online" && sel.kind === "dm";
    if (mode === "schedule" && scheduleAt <= 0) {
      store.set({ status: "Некорректная дата отправки" });
      return;
    }
    if (editing) {
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения: нельзя изменить сообщение" });
        return;
      }
      const msgId = Number.isFinite(Number(editing.id)) ? Math.trunc(Number(editing.id)) : 0;
      if (msgId <= 0) {
        store.set({ status: "Нельзя изменить это сообщение" });
        return;
      }
      const ok = send({ type: "message_edit", id: msgId, text });
      if (!ok) {
        store.set({ status: "Нет соединения: изменения не отправлены" });
        return;
      }
      store.set({ status: "Сохраняем изменения…" });

      const restore = editing.prevDraft || "";
      store.set((prev) => ({ ...prev, editing: null, input: restore }));
      try {
        input.value = restore;
        autosizeInput(input);
        input.focus();
      } catch {
        // ignore
      }
      scheduleSaveDrafts();
      return;
    }

    const convKey = key;
    if (convKey) markChatAutoScroll(convKey, false);
    const localId = makeOutboxLocalId();
    const ts = nowTs();
    const nowMs = Date.now();
    const replyRef = replyDraft ? helperDraftToRef(replyDraft) : null;
    const forwardRef = forwardDraft ? helperDraftToRef(forwardDraft) : null;
    const payload =
      sel.kind === "dm"
        ? {
            type: "send" as const,
            to: sel.id,
            text: finalText,
            ...(silent ? { silent: true } : {}),
            ...(replyRef ? { reply: replyRef } : {}),
            ...(forwardRef ? { forward: forwardRef } : {}),
          }
        : {
            type: "send" as const,
            room: sel.id,
            text: finalText,
            ...(silent ? { silent: true } : {}),
            ...(replyRef ? { reply: replyRef } : {}),
            ...(forwardRef ? { forward: forwardRef } : {}),
          };
    const scheduled = mode === "schedule" && scheduleAt > 0;
    const sent = st.conn === "connected" && !whenOnline && !scheduled ? send(payload) : false;
    const initialStatus = sent ? ("sending" as const) : ("queued" as const);

    const localMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      to: sel.kind === "dm" ? sel.id : undefined,
      room: sel.kind === "dm" ? undefined : sel.id,
      text: finalText,
      ts,
      localId,
      id: null,
      status: initialStatus,
      ...(replyRef ? { reply: replyRef } : {}),
      ...(forwardRef ? { forward: forwardRef } : {}),
      ...(whenOnline ? { whenOnline: true } : {}),
      ...(scheduled ? { scheduleAt } : {}),
    };

    store.set((prev) => {
      const next = upsertConversation(prev, convKey, localMsg);
      const outbox = addOutboxEntry(next.outbox, convKey, {
        localId,
        ts,
        text: finalText,
        ...(sel.kind === "dm" ? { to: sel.id } : { room: sel.id }),
        ...(whenOnline ? { whenOnline: true } : {}),
        ...(silent ? { silent: true } : {}),
        ...(scheduled ? { scheduleAt } : {}),
        status: sent ? "sending" : "queued",
        attempts: sent ? 1 : 0,
        lastAttemptAt: sent ? nowMs : 0,
      });
      return applyOutboxMutation(next, outbox);
    });
    scheduleSaveOutbox();
    markChatAutoScroll(convKey, false);
    scrollChatToBottom?.(convKey);

    if (!preserveComposer) {
      input.value = "";
      autosizeInput(input);
      input.focus();
      scheduleBoardEditorPreview();
      store.set((prev) => {
        const drafts = updateDraftMap(prev.drafts, convKey, "");
        return { ...applyDraftMapMutation(prev, drafts), input: "", replyDraft: null, forwardDraft: null };
      });
      scheduleSaveDrafts();
    }

    if (scheduled) {
      store.set({ status: "Сообщение запланировано" });
      drainOutbox();
      return;
    }
    if (whenOnline) {
      store.set({ status: "Сообщение будет отправлено, когда контакт в сети" });
      drainOutbox();
      return;
    }
    if (!sent) {
      store.set({ status: st.conn === "connected" ? "Сообщение в очереди" : "Нет соединения: сообщение в очереди" });
    }
  };

  return { sendChat };
}
