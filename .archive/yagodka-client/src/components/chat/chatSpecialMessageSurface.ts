import { el } from "../../helpers/dom/el";
import { renderRichText } from "../../helpers/chat/richText";
import type { ChatMessage } from "../../stores/types";

type RenderDeferredSysMessageSurfaceCtx = {
  mount: HTMLElement;
  message: ChatMessage;
};

const EMOJI_SEGMENT_RE = /\p{Extended_Pictographic}/u;
const SYS_TEXT_MAX_CHARS = 1800;
const INVITE_TEXT_MAX_CHARS = 1200;
const INVITE_TEXT_MAX_LINES = 12;

function clampText(value: unknown, maxChars: number, maxLines: number): string {
  const raw = String(value || "").replace(/\u0000/g, "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  let out = lines.slice(0, Math.max(1, maxLines)).join("\n");
  let clipped = lines.length > maxLines;
  if (out.length > maxChars) {
    out = out.slice(0, maxChars);
    clipped = true;
  }
  out = out.trimEnd();
  return clipped ? `${out}…` : out;
}

function clampOneLine(value: unknown, maxChars: number): string {
  return clampText(value, maxChars, 1).replace(/\s+/g, " ").trim();
}

function isEmojiOnlyText(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, "");
  if (!compact) return false;
  const plain = compact.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "");
  return plain === "" && EMOJI_SEGMENT_RE.test(compact);
}

function roomLabel(name: string | null | undefined, id: string, handle?: string | null): string {
  const n = String(name || "").trim();
  if (n) return n;
  const h = String(handle || "").trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return id;
}

function renderMultilineText(text: string): HTMLElement {
  const lines = String(text || "").split(/\r?\n/);
  const nodes: Array<string | HTMLElement> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i) nodes.push(el("br"));
    nodes.push(lines[i]);
  }
  return el("div", { class: "msg-pre" }, nodes);
}

function actionBtn(label: string, attrs: Record<string, string>, cls: string, baseClass = "msg-action-btn"): HTMLElement {
  return el("button", { class: `btn ${baseClass} ${cls}`.trim(), type: "button", ...attrs }, [label]);
}

function renderInviteCard(payload: any, text: string): HTMLElement | null {
  if (!payload || typeof payload !== "object") return null;
  const kind = String(payload.kind || "");
  if (kind !== "group_invite" && kind !== "board_invite") return null;
  const isGroup = kind === "group_invite";
  const roomId = clampOneLine(payload.groupId || payload.group_id || payload.boardId || payload.board_id || "", 128);
  if (!roomId) return null;
  const name = clampOneLine(payload.name || "", 160) || null;
  const handle = clampOneLine(payload.handle || "", 160) || null;
  const from = clampOneLine(payload.from || "", 128);
  const description = clampText(payload.description || "", INVITE_TEXT_MAX_CHARS, INVITE_TEXT_MAX_LINES);
  const rules = clampText(payload.rules || "", INVITE_TEXT_MAX_CHARS, INVITE_TEXT_MAX_LINES);
  const title = clampOneLine(text || "", 180) || (isGroup ? "Приглашение в чат" : "Приглашение в доску");
  const label = roomLabel(name, roomId, handle);

  const metaLines: HTMLElement[] = [];
  metaLines.push(el("div", { class: "invite-meta-line" }, [isGroup ? `Чат: ${label}` : `Доска: ${label}`]));
  if (from) metaLines.push(el("div", { class: "invite-meta-line" }, [`От: ${from}`]));
  const meta = el("div", { class: "invite-meta" }, metaLines);

  const sections: HTMLElement[] = [];
  if (description) {
    sections.push(el("div", { class: "invite-section" }, [el("div", { class: "invite-section-title" }, ["Описание"]), renderMultilineText(description)]));
  }
  if (rules) {
    sections.push(el("div", { class: "invite-section" }, [el("div", { class: "invite-section-title" }, ["Правила"]), renderMultilineText(rules)]));
  }
  if (!sections.length) {
    sections.push(el("div", { class: "invite-empty" }, ["Описание и правила не указаны"]));
  }

  const baseAttrs: Record<string, string> = isGroup ? { "data-group-id": roomId } : { "data-board-id": roomId };
  if (from) baseAttrs["data-from"] = from;

  const actions = el("div", { class: "invite-actions" }, [
    actionBtn(
      "Вступить",
      { ...baseAttrs, "data-action": isGroup ? "group-invite-accept" : "board-invite-accept" },
      "btn-primary",
      "invite-action-btn"
    ),
    actionBtn(
      "Отклонить",
      { ...baseAttrs, "data-action": isGroup ? "group-invite-decline" : "board-invite-decline" },
      "",
      "invite-action-btn"
    ),
    actionBtn(
      "Спам",
      { ...baseAttrs, "data-action": isGroup ? "group-invite-block" : "board-invite-block" },
      "btn-danger",
      "invite-action-btn"
    ),
  ]);

  return el("div", { class: "invite-card" }, [el("div", { class: "invite-title" }, [title]), meta, ...sections, actions]);
}

function renderSysActions(payload: any): HTMLElement | null {
  if (!payload || typeof payload !== "object") return null;
  const kind = String(payload.kind || "");
  const buttons: HTMLElement[] = [];

  if (kind === "auth_in") {
    const peer = String(payload.peer || "").trim();
    if (peer) {
      buttons.push(actionBtn("Принять", { "data-action": "auth-accept", "data-peer": peer }, "btn-primary"));
      buttons.push(actionBtn("Отклонить", { "data-action": "auth-decline", "data-peer": peer }, "btn-danger"));
    }
  } else if (kind === "auth_out") {
    const peer = String(payload.peer || "").trim();
    if (peer) buttons.push(actionBtn("Отменить", { "data-action": "auth-cancel", "data-peer": peer }, "btn-danger"));
  } else if (kind === "group_invite") {
    const groupId = String(payload.groupId || payload.group_id || "").trim();
    const from = String(payload.from || "").trim();
    const attrs: Record<string, string> = { "data-group-id": groupId };
    if (from) attrs["data-from"] = from;
    if (groupId) {
      buttons.push(actionBtn("Принять", { ...attrs, "data-action": "group-invite-accept" }, "btn-primary"));
      buttons.push(actionBtn("Отклонить", { ...attrs, "data-action": "group-invite-decline" }, "btn-danger"));
    }
  } else if (kind === "group_join_request") {
    const groupId = String(payload.groupId || payload.group_id || "").trim();
    const peer = String(payload.from || payload.peer || "").trim();
    if (groupId && peer) {
      buttons.push(actionBtn("Принять", { "data-action": "group-join-accept", "data-group-id": groupId, "data-peer": peer }, "btn-primary"));
      buttons.push(actionBtn("Отклонить", { "data-action": "group-join-decline", "data-group-id": groupId, "data-peer": peer }, "btn-danger"));
    }
  } else if (kind === "board_invite") {
    const boardId = String(payload.boardId || payload.board_id || "").trim();
    if (boardId) {
      buttons.push(actionBtn("Принять", { "data-action": "board-invite-accept", "data-board-id": boardId }, "btn-primary"));
      buttons.push(actionBtn("Отклонить", { "data-action": "board-invite-decline", "data-board-id": boardId }, "btn-danger"));
    }
  }

  if (!buttons.length) return null;
  return el("div", { class: "msg-actions" }, buttons);
}

export function renderDeferredSysMessageSurface(ctx: RenderDeferredSysMessageSurfaceCtx) {
  try {
    const { mount, message } = ctx;
    const bodyChildren: HTMLElement[] = [];
    if (message.attachment?.kind === "action") {
      const card = renderInviteCard(message.attachment.payload, message.text);
      if (card) {
        bodyChildren.push(card);
        mount.replaceChildren(el("div", { class: "msg-body" }, bodyChildren));
        return;
      }
    }
    const safeText = clampText(message.text || "", SYS_TEXT_MAX_CHARS, 18);
    const emojiOnlySys = isEmojiOnlyText(safeText);
    bodyChildren.push(el("div", { class: `msg-text${emojiOnlySys ? " msg-emoji-only" : ""}` }, renderRichText(safeText)));
    if (message.attachment?.kind === "action") {
      const actions = renderSysActions(message.attachment.payload);
      if (actions) bodyChildren.push(actions);
    }
    mount.replaceChildren(el("div", { class: "msg-body" }, bodyChildren));
  } catch {
    const safeText = clampText(ctx.message.text || "", SYS_TEXT_MAX_CHARS, 18) || "Системное сообщение";
    ctx.mount.replaceChildren(el("div", { class: "msg-body" }, [el("div", { class: "msg-text" }, [safeText])]));
  }
}
