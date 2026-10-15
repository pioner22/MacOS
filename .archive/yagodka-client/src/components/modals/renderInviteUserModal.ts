import { el } from "../../helpers/dom/el";
import type { BoardEntry, GroupEntry } from "../../stores/types";

export interface InviteUserModalActions {
  onInvite: () => void;
  onCancel: () => void;
}

function roomLabel(name: string | null | undefined, id: string, handle?: string | null): string {
  const base = name ? `${name} (${id})` : id;
  const h = handle ? String(handle).trim() : "";
  if (h) return `${base} ${h.startsWith("@") ? h : `@${h}`}`;
  return base;
}

export function renderInviteUserModal(
  peer: string,
  selfId: string | null,
  groups: GroupEntry[],
  boards: BoardEntry[],
  message: string | undefined,
  actions: InviteUserModalActions
): HTMLElement {
  const box = el("div", { class: "modal" });
  const btnInvite = el("button", { class: "btn btn-primary", type: "button" }, ["Отправить приглашения"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);

  const ownGroups = selfId ? groups.filter((g) => String(g.owner_id || "") === String(selfId)) : [];
  const ownBoards = selfId ? boards.filter((b) => String(b.owner_id || "") === String(selfId)) : [];

  const groupRows =
    ownGroups.length > 0
      ? ownGroups.map((g) =>
          el("label", { class: "row invite-row" }, [
            el("input", { type: "checkbox", "data-invite-kind": "group", value: g.id }),
            el("span", { class: "invite-label" }, [roomLabel(g.name, g.id, g.handle)]),
          ])
        )
      : [el("div", { class: "modal-line" }, ["У вас нет чатов, где вы владелец"])];

  const boardRows =
    ownBoards.length > 0
      ? ownBoards.map((b) =>
          el("label", { class: "row invite-row" }, [
            el("input", { type: "checkbox", "data-invite-kind": "board", value: b.id }),
            el("span", { class: "invite-label" }, [roomLabel(b.name, b.id, b.handle)]),
          ])
        )
      : [el("div", { class: "modal-line" }, ["У вас нет досок, где вы владелец"])];

  const form = el("form", { id: "invite-user-form" }, [
    el("div", { class: "modal-line" }, [`Пригласить: ${peer}`]),
    el("div", { class: "modal-line" }, ["Выберите чаты/доски. Приглашение придёт пользователю в ЛС как системное сообщение."]),
    el("div", { class: "modal-line" }, ["Чаты"]),
    el("div", { class: "invite-list" }, groupRows),
    el("div", { class: "modal-line" }, ["Доски"]),
    el("div", { class: "invite-list" }, boardRows),
  ]);

  box.append(
    el("div", { class: "modal-title" }, ["Пригласить пользователя"]),
    form,
    el("div", { class: "modal-warn" }, [message || ""]),
    el("div", { class: "modal-actions" }, [btnInvite, btnCancel])
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    actions.onInvite();
  });
  btnInvite.addEventListener("click", () => actions.onInvite());
  btnCancel.addEventListener("click", () => actions.onCancel());

  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      actions.onInvite();
    }
  });

  return box;
}

