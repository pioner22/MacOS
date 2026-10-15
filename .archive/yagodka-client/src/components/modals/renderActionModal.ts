import { el } from "../../helpers/dom/el";
import type { ActionModalPayload } from "../../stores/types";

export interface ActionModalActions {
  onClose: () => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupInviteAccept: (groupId: string) => void;
  onGroupInviteDecline: (groupId: string) => void;
  onGroupJoinAccept: (groupId: string, peer: string) => void;
  onGroupJoinDecline: (groupId: string, peer: string) => void;
  onBoardInviteJoin: (boardId: string) => void;
  onBoardInviteDecline: (boardId: string) => void;
  onFileOfferAccept: (fileId: string) => void;
  onFileOfferReject: (fileId: string) => void;
}

function formatBytes(size: number): string {
  if (!size || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const precision = value >= 100 || idx === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}

function roomLabel(name: string | null | undefined, id: string, handle?: string | null): string {
  const base = name ? `${name} (${id})` : id;
  if (handle) return `${base} ${handle}`;
  return base;
}

export function renderActionModal(payload: ActionModalPayload, message: string | undefined, actions: ActionModalActions): HTMLElement {
  const box = el("div", { class: "modal" });

  const title = el("div", { class: "modal-title" });
  const lines: HTMLElement[] = [];
  const buttons: HTMLElement[] = [];

  if (payload.kind === "auth_in") {
    title.textContent = "Запрос на авторизацию";
    lines.push(el("div", { class: "modal-line" }, [`От: ${payload.peer}`]));
    if (payload.note) lines.push(el("div", { class: "modal-line" }, [payload.note]));
    const btnAccept = el("button", { class: "btn", type: "button" }, ["Принять"]);
    const btnDecline = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
    btnAccept.addEventListener("click", () => actions.onAuthAccept(payload.peer));
    btnDecline.addEventListener("click", () => actions.onAuthDecline(payload.peer));
    buttons.push(btnAccept, btnDecline);
  } else if (payload.kind === "auth_out") {
    title.textContent = "Исходящий запрос";
    lines.push(el("div", { class: "modal-line" }, [`Кому: ${payload.peer}`]));
    const btnCancel = el("button", { class: "btn", type: "button" }, ["Отменить"]);
    const btnClose = el("button", { class: "btn", type: "button" }, ["Закрыть"]);
    btnCancel.addEventListener("click", () => actions.onAuthCancel(payload.peer));
    btnClose.addEventListener("click", () => actions.onClose());
    buttons.push(btnCancel, btnClose);
  } else if (payload.kind === "group_invite") {
    title.textContent = "Приглашение в чат";
    lines.push(el("div", { class: "modal-line" }, [`Чат: ${roomLabel(payload.name, payload.groupId, payload.handle)}`]));
    lines.push(el("div", { class: "modal-line" }, [`От: ${payload.from}`]));
    const btnAccept = el("button", { class: "btn", type: "button" }, ["Вступить"]);
    const btnDecline = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
    btnAccept.addEventListener("click", () => actions.onGroupInviteAccept(payload.groupId));
    btnDecline.addEventListener("click", () => actions.onGroupInviteDecline(payload.groupId));
    buttons.push(btnAccept, btnDecline);
  } else if (payload.kind === "group_join_request") {
    title.textContent = "Запрос на вступление";
    lines.push(el("div", { class: "modal-line" }, [`Чат: ${roomLabel(payload.name, payload.groupId, payload.handle)}`]));
    lines.push(el("div", { class: "modal-line" }, [`От: ${payload.from}`]));
    const btnAccept = el("button", { class: "btn", type: "button" }, ["Принять"]);
    const btnDecline = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
    btnAccept.addEventListener("click", () => actions.onGroupJoinAccept(payload.groupId, payload.from));
    btnDecline.addEventListener("click", () => actions.onGroupJoinDecline(payload.groupId, payload.from));
    buttons.push(btnAccept, btnDecline);
  } else if (payload.kind === "board_invite") {
    title.textContent = "Приглашение в доску";
    lines.push(el("div", { class: "modal-line" }, [`Доска: ${roomLabel(payload.name, payload.boardId, payload.handle)}`]));
    lines.push(el("div", { class: "modal-line" }, [`От: ${payload.from}`]));
    const btnJoin = el("button", { class: "btn", type: "button" }, ["Вступить"]);
    const btnDecline = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
    btnJoin.addEventListener("click", () => actions.onBoardInviteJoin(payload.boardId));
    btnDecline.addEventListener("click", () => actions.onBoardInviteDecline(payload.boardId));
    buttons.push(btnJoin, btnDecline);
  } else if (payload.kind === "file_offer") {
    title.textContent = "Входящий файл";
    lines.push(el("div", { class: "modal-line" }, [`От: ${payload.from}`]));
    if (payload.room) lines.push(el("div", { class: "modal-line" }, [`Комната: ${payload.room}`]));
    lines.push(el("div", { class: "modal-line" }, [`Файл: ${payload.name}`]));
    lines.push(el("div", { class: "modal-line" }, [`Размер: ${formatBytes(payload.size)}`]));
    const btnAccept = el("button", { class: "btn", type: "button" }, ["Принять"]);
    const btnDecline = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
    btnAccept.addEventListener("click", () => actions.onFileOfferAccept(payload.fileId));
    btnDecline.addEventListener("click", () => actions.onFileOfferReject(payload.fileId));
    buttons.push(btnAccept, btnDecline);
  }

  const actionsRow = el("div", { class: "modal-actions" }, buttons);
  const warn = el("div", { class: "modal-warn" }, [message || ""]);

  box.append(title, ...lines, warn, actionsRow);
  return box;
}
