import { MESSAGE_SCHEDULE_MAX_DAYS, maxMessageScheduleDelayMs } from "../../../helpers/chat/messageSchedule";
import { updateOutboxEntry } from "../../../helpers/chat/outbox";
import type { Store } from "../../../stores/store";
import type { AppState, MessageHelperDraft, TargetRef } from "../../../stores/types";

interface SendChatOptions {
  mode?: "now" | "when_online" | "schedule";
  scheduleAt?: number;
  preserveComposer?: boolean;
  target?: TargetRef;
  text?: string;
  replyDraft?: MessageHelperDraft | null;
  forwardDraft?: MessageHelperDraft | null;
}

export interface ScheduleSubmitFeatureDeps {
  store: Store<AppState>;
  closeModal: () => void;
  sendChat: (opts?: SendChatOptions) => void;
  showToast: (message: string, opts?: { kind?: "info" | "success" | "warn" | "error" }) => void;
  scheduleSaveOutbox: () => void;
  drainOutbox: () => void;
}

export interface ScheduleSubmitFeature {
  sendScheduleSubmit: () => void;
  sendScheduleWhenOnlineSubmit: () => void;
}

const parseDatetimeLocal = (value: string): number | null => {
  const v = String(value || "").trim();
  const match = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  if (![year, month, day, hours, minutes].every((v) => Number.isFinite(v))) return null;
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : null;
};

export function createScheduleSubmitFeature(deps: ScheduleSubmitFeatureDeps): ScheduleSubmitFeature {
  const { store, closeModal, sendChat, showToast, scheduleSaveOutbox, drainOutbox } = deps;

  const sendScheduleSubmit = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "send_schedule") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const rawWhen = (document.getElementById("send-schedule-at") as HTMLInputElement | null)?.value ?? "";
    const when = parseDatetimeLocal(rawWhen);
    if (!when) {
      store.set({ modal: { ...modal, message: "Выберите дату/время" } });
      return;
    }
    const now = Date.now();
    const maxAt = now + maxMessageScheduleDelayMs();
    if (when <= now) {
      store.set({ modal: { ...modal, message: "Время уже прошло — выберите будущее" } });
      return;
    }
    if (when > maxAt) {
      store.set({ modal: { ...modal, message: `Максимум — ${MESSAGE_SCHEDULE_MAX_DAYS} дней вперёд` } });
      return;
    }
    const edit = modal.edit;
    if (edit && edit.key && edit.localId) {
      const key = String(edit.key || "").trim();
      const localId = String(edit.localId || "").trim();
      if (!key || !localId) {
        store.set({ modal: null });
        return;
      }
      const list = st.outbox?.[key] || [];
      const has = Array.isArray(list) && list.some((entry) => String(entry?.localId || "").trim() === localId);
      if (!has) {
        store.set({ modal: null });
        showToast("Не найдено в очереди отправки", { kind: "warn" });
        return;
      }
      store.set((prev) => {
        const outbox = updateOutboxEntry(prev.outbox, key, localId, (entry) => ({ ...entry, scheduleAt: when }));
        const conv = prev.conversations[key] || [];
        if (!Array.isArray(conv) || !conv.length) return { ...prev, outbox, modal: null };
        const idx = conv.findIndex((msg: any) => msg.kind === "out" && typeof msg.localId === "string" && msg.localId === localId);
        if (idx < 0) return { ...prev, outbox, modal: null };
        const next = [...conv];
        next[idx] = { ...next[idx], scheduleAt: when, status: next[idx].status === "sent" ? next[idx].status : "queued" };
        return { ...prev, outbox, conversations: { ...prev.conversations, [key]: next }, modal: null };
      });
      scheduleSaveOutbox();
      drainOutbox();
      showToast("Время отправки изменено", { kind: "success" });
      return;
    }
    closeModal();
    sendChat({
      mode: "schedule",
      scheduleAt: when,
      target: modal.target,
      text: modal.text,
      replyDraft: modal.replyDraft ?? null,
      forwardDraft: modal.forwardDraft ?? null,
      preserveComposer: Boolean(modal.preserveComposer),
    });
  };

  const sendScheduleWhenOnlineSubmit = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "send_schedule") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (modal.edit) {
      store.set({ modal: { ...modal, message: "Кнопка доступна только при создании нового сообщения" } });
      return;
    }
    if (modal.target.kind !== "dm") {
      store.set({ modal: { ...modal, message: "Доступно только в личном чате" } });
      return;
    }
    const peerId = String(modal.target.id || "").trim();
    const friend = (st.friends || []).find((f) => String(f.id || "").trim() === peerId);
    if (!friend) {
      store.set({ modal: { ...modal, message: "Нет статуса контакта: «когда будет онлайн» недоступно" } });
      return;
    }
    if (friend.online) {
      store.set({ modal: { ...modal, message: "Контакт уже онлайн" } });
      return;
    }
    closeModal();
    sendChat({
      mode: "when_online",
      target: modal.target,
      text: modal.text,
      replyDraft: modal.replyDraft ?? null,
      forwardDraft: modal.forwardDraft ?? null,
      preserveComposer: Boolean(modal.preserveComposer),
    });
  };

  return {
    sendScheduleSubmit,
    sendScheduleWhenOnlineSubmit,
  };
}
