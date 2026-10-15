import { el } from "../../helpers/dom/el";
import { renderRichText } from "../../helpers/chat/richText";
import type { ChatMessage } from "../../stores/types";
import { classifyHistorySystemMessageLayer } from "./historyLayerContracts";

type ChatSpecialMessageModule = typeof import("./chatSpecialMessageSurface");

type RenderDeferredSysMessageOptions = {
  message: ChatMessage;
};

let specialMessageModule: ChatSpecialMessageModule | null = null;
let specialMessagePromise: Promise<ChatSpecialMessageModule> | null = null;

function clampSysText(value: unknown): string {
  const raw = String(value || "").replace(/\u0000/g, "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  let out = lines.slice(0, 18).join("\n");
  let clipped = lines.length > 18;
  if (out.length > 1800) {
    out = out.slice(0, 1800);
    clipped = true;
  }
  out = out.trimEnd();
  return clipped ? `${out}…` : out;
}

function canRenderMount(mount: HTMLElement | null): mount is HTMLElement {
  if (!mount) return false;
  return (mount as HTMLElement & { isConnected?: boolean }).isConnected !== false;
}

function ensureSpecialMessageModule() {
  if (specialMessageModule) return Promise.resolve(specialMessageModule);
  if (specialMessagePromise) return specialMessagePromise;
  specialMessagePromise = import("./chatSpecialMessageSurface")
    .then((mod: ChatSpecialMessageModule) => {
      specialMessageModule = mod;
      return mod;
    })
    .finally(() => {
      if (specialMessageModule) specialMessagePromise = null;
    });
  return specialMessagePromise;
}

function actionBtn(label: string, attrs: Record<string, string>, cls: string, baseClass = "msg-action-btn"): HTMLElement {
  return el("button", { class: `btn ${baseClass} ${cls}`.trim(), type: "button", ...attrs }, [label]);
}

function renderSysActionsPlaceholder(payload: any): HTMLElement | null {
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

function renderSysMessagePlaceholder(message: ChatMessage): HTMLElement {
  const bodyChildren: HTMLElement[] = [el("div", { class: "msg-text" }, renderRichText(clampSysText(message.text || "")))];
  if (message.attachment?.kind === "action") {
    const actions = renderSysActionsPlaceholder(message.attachment.payload);
    if (actions) bodyChildren.push(actions);
  }
  return el("div", { class: "msg-body" }, bodyChildren);
}

export function renderDeferredSysMessage(options: RenderDeferredSysMessageOptions): HTMLElement {
  const systemLayer = classifyHistorySystemMessageLayer(options.message.text || "", options.message.attachment?.kind);
  const mount = el(
    "div",
    {
      class: `msg msg-sys${systemLayer === "noise" ? " msg-sys-noise" : ""}${systemLayer === "action" ? " msg-sys-action" : ""}`,
      "data-msg-system-layer": systemLayer,
    },
    [renderSysMessagePlaceholder(options.message)]
  );
  if (specialMessageModule) {
    specialMessageModule.renderDeferredSysMessageSurface({ mount, message: options.message });
    return mount;
  }
  void ensureSpecialMessageModule()
    .then((mod) => {
      if (!canRenderMount(mount)) return;
      mod.renderDeferredSysMessageSurface({ mount, message: options.message });
    })
    .catch(() => {
      // Keep the placeholder text/actions if the deferred module fails to load.
    });
  return mount;
}
