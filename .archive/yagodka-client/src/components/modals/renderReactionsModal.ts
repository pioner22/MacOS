import type { AppState } from "../../stores/types";
import { el } from "../../helpers/dom/el";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function buildEntries(counts: Record<string, number>): Array<{ emoji: string; count: number }> {
  const entries: Array<{ emoji: string; count: number }> = [];
  for (const [emojiRaw, cntRaw] of Object.entries(counts || {})) {
    const emoji = String(emojiRaw || "").trim();
    const count = typeof cntRaw === "number" && Number.isFinite(cntRaw) ? Math.trunc(cntRaw) : Math.trunc(Number(cntRaw) || 0);
    if (!emoji || count <= 0) continue;
    entries.push({ emoji, count });
  }
  entries.sort((a, b) => {
    const ai = QUICK_REACTIONS.indexOf(a.emoji);
    const bi = QUICK_REACTIONS.indexOf(b.emoji);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    if (a.count !== b.count) return b.count - a.count;
    return a.emoji.localeCompare(b.emoji);
  });
  return entries;
}

export function renderReactionsModal(
  state: AppState,
  modal: Extract<NonNullable<AppState["modal"]>, { kind: "reactions" }>,
  actions: { onClose: () => void }
): HTMLElement {
  const chatKey = String(modal.chatKey || "").trim();
  const msgId = typeof modal.msgId === "number" && Number.isFinite(modal.msgId) ? Math.trunc(modal.msgId) : 0;
  const conv = chatKey ? state.conversations?.[chatKey] || [] : [];
  const msg = msgId > 0 ? conv.find((m) => typeof m?.id === "number" && m.id === msgId) : null;
  const counts = msg && msg.reactions?.counts && typeof msg.reactions.counts === "object" ? msg.reactions.counts : null;
  const mine = msg && typeof msg.reactions?.mine === "string" ? String(msg.reactions.mine).trim() : "";
  const entries = counts ? buildEntries(counts) : [];

  const box = el("div", { class: "modal" });
  const btnClose = el("button", { class: "btn btn-primary", type: "button" }, ["Закрыть"]) as HTMLButtonElement;
  btnClose.addEventListener("click", () => actions.onClose());

  const pickerLabel = mine ? "Изменить реакцию" : "Добавить реакцию";
  const pickerBtn = el("button", { class: "btn", type: "button", "data-action": "modal-react-picker" }, [pickerLabel]) as HTMLButtonElement;

  if (!msg || !entries.length) {
    box.append(
      el("div", { class: "modal-title" }, ["Реакции"]),
      el("div", { class: "modal-line" }, ["Реакций нет (или сообщение ещё не синхронизировано)."]),
      el("div", { class: "modal-actions" }, [btnClose])
    );
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        actions.onClose();
      }
    });
    return box;
  }

  const chips = entries.map(({ emoji, count }) => {
    const active = Boolean(mine && mine === emoji);
    const label = `${emoji} ${count}`;
    const btn = el(
      "button",
      {
        class: active ? "msg-react is-active" : "msg-react",
        type: "button",
        "data-action": "modal-react-set",
        "data-emoji": emoji,
        "aria-pressed": active ? "true" : "false",
        title: active ? `Убрать реакцию ${emoji}` : mine ? `Заменить реакцию на ${emoji}` : `Поставить реакцию ${emoji}`,
      },
      [
        el("span", { class: "msg-react-emoji", "aria-hidden": "true" }, [emoji]),
        el("span", { class: "msg-react-count" }, [String(count)]),
      ]
    ) as HTMLButtonElement;
    btn.setAttribute("aria-label", label);
    return btn;
  });

  const hintText = mine
    ? "Нажмите реакцию, чтобы заменить; нажмите активную — чтобы убрать."
    : "Нажмите реакцию, чтобы поставить.";
  const hint = el("div", { class: "modal-line" }, [hintText]);
  const reacts = el("div", { class: "msg-reacts msg-reacts-modal", role: "group", "aria-label": "Реакции" }, chips);

  box.append(el("div", { class: "modal-title" }, ["Реакции"]), hint, reacts, el("div", { class: "modal-actions" }, [pickerBtn, btnClose]));

  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onClose();
    }
  });

  return box;
}
