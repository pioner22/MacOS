import { el } from "../../helpers/dom/el";
import { maxMessageScheduleDelayMs, MESSAGE_SCHEDULE_MAX_DAYS } from "../../helpers/chat/messageSchedule";

export interface SendScheduleModalActions {
  onSchedule: () => void;
  onCancel: () => void;
  onWhenOnline?: () => void;
}

function formatDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function renderSendScheduleModal(
  text: string,
  suggestedAt: number | undefined,
  message: string | undefined,
  title: string | undefined,
  confirmLabel: string | undefined,
  actions: SendScheduleModalActions
): HTMLElement {
  const modalTitle = title || "Запланировать отправку";
  const box = el("div", {
    class: "modal modal-send-schedule",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": modalTitle,
    tabindex: "-1",
  });
  const btnSchedule = el("button", { class: "btn btn-primary", type: "button" }, [confirmLabel || "Запланировать"]);
  const btnCancel = el("button", { class: "btn btn-secondary", type: "button" }, ["Отмена"]);
  const btnWhenOnline = actions.onWhenOnline ? el("button", { class: "btn btn-secondary", type: "button" }, ["Когда будет онлайн"]) : null;

  const previewRaw = String(text || "").trim();
  const preview = previewRaw.length > 96 ? `${previewRaw.slice(0, 93)}…` : previewRaw || "Сообщение";

  const now = Date.now();
  const minAt = now + 60 * 1000;
  const maxAt = now + maxMessageScheduleDelayMs();
  const base = typeof suggestedAt === "number" && Number.isFinite(suggestedAt) ? suggestedAt : now + 60 * 60 * 1000;
  const valueAt = Math.max(minAt, Math.min(maxAt, base));
  const days = MESSAGE_SCHEDULE_MAX_DAYS;

  box.append(
    el("div", { class: "modal-title" }, [modalTitle]),
    el("div", { class: "modal-body" }, [
      el("div", { class: "modal-line" }, [preview]),
      el("label", { class: "modal-label", for: "send-schedule-at" }, ["Дата и время"]),
      el("input", {
        class: "modal-input",
        id: "send-schedule-at",
        type: "datetime-local",
        value: formatDatetimeLocal(valueAt),
        min: formatDatetimeLocal(minAt),
        max: formatDatetimeLocal(maxAt),
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        enterkeyhint: "done",
      }),
      el("div", { class: "modal-help" }, [`Максимум — ${days} дней вперёд.`]),
    ]),
    el("div", { class: "modal-warn" }, [message || ""]),
    el("div", { class: "modal-actions modal-actions-compose" }, [btnCancel, ...(btnWhenOnline ? [btnWhenOnline] : []), btnSchedule])
  );

  btnSchedule.addEventListener("click", () => actions.onSchedule());
  btnCancel.addEventListener("click", () => actions.onCancel());
  btnWhenOnline?.addEventListener("click", () => actions.onWhenOnline?.());

  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      actions.onSchedule();
    }
  });

  return box;
}
