import { el } from "../../helpers/dom/el";
import type { ContextMenuPayload } from "../../stores/types";

export interface ContextMenuActions {
  onSelect: (itemId: string) => void;
  onClose: () => void;
}

function isCoarsePointer() {
  try {
    return Boolean(window.matchMedia?.("(pointer: coarse)")?.matches || window.matchMedia?.("(hover: none)")?.matches);
  } catch {
    return false;
  }
}

function shouldRenderAsCompactMessage(payload: ContextMenuPayload) {
  return payload?.target?.kind === "message" && isCoarsePointer();
}

function shouldRenderAsSheet(payload: ContextMenuPayload) {
  return !shouldRenderAsCompactMessage(payload) && isCoarsePointer();
}

function focusFirstEnabled(root: HTMLElement) {
  const items = Array.from(root.querySelectorAll<HTMLButtonElement>("button.ctx-item"));
  const first = items.find((b) => !b.disabled);
  if (!first) return;
  try {
    first.focus({ preventScroll: true });
  } catch {
    first.focus();
  }
}

function focusLastEnabled(root: HTMLElement) {
  const items = Array.from(root.querySelectorAll<HTMLButtonElement>("button.ctx-item"));
  const last = [...items].reverse().find((b) => !b.disabled);
  if (!last) return;
  try {
    last.focus({ preventScroll: true });
  } catch {
    last.focus();
  }
}

function moveFocus(root: HTMLElement, dir: 1 | -1) {
  const items = Array.from(root.querySelectorAll<HTMLButtonElement>("button.ctx-item")).filter((b) => !b.disabled);
  if (!items.length) return;
  const active = document.activeElement as HTMLElement | null;
  const idx = items.findIndex((b) => b === active);
  const next = idx < 0 ? items[0] : items[(idx + dir + items.length) % items.length];
  try {
    next.focus({ preventScroll: true });
  } catch {
    next.focus();
  }
}

function composerAvoidRect(): DOMRect | null {
  try {
    return (document.querySelector(".input-wrap") as HTMLElement | null)?.getBoundingClientRect() ?? null;
  } catch {
    return null;
  }
}

function messageContextTopLimit(): number {
  const pad = 12;
  let top = pad;
  try {
    const vv = window.visualViewport;
    if (vv && Number.isFinite(vv.offsetTop)) top = Math.max(top, Math.round(vv.offsetTop) + pad);
  } catch {
    // ignore
  }
  try {
    const chatTop = (document.querySelector(".chat-top") as HTMLElement | null)?.getBoundingClientRect() ?? null;
    if (chatTop && chatTop.width > 0 && chatTop.height > 0 && chatTop.bottom > 0 && chatTop.bottom < window.innerHeight * 0.5) {
      top = Math.max(top, Math.round(chatTop.bottom) + 8);
    }
  } catch {
    // ignore
  }
  return top;
}

const ACTION_ICON_RULES: Array<[RegExp, string]> = [
  [/reply|quote/i, "reply"],
  [/view_replies|thread/i, "thread"],
  [/forward|send_now/i, "forward"],
  [/copy|copy_id/i, "copy"],
  [/select|mark_read|accept/i, "check"],
  [/pin|board_profile/i, "pin"],
  [/edit|rename|schedule/i, "edit"],
  [/download|file|files/i, "download"],
  [/search/i, "search"],
  [/reaction/i, "reaction"],
  [/translate/i, "translate"],
  [/profile|avatar|user|member/i, "profile"],
  [/archive|folder/i, "archive"],
  [/mute|sound/i, "mute"],
  [/block|decline|cancel/i, "block"],
  [/create|invite|add/i, "plus"],
  [/login|open/i, "open"],
  [/logout|leave/i, "logout"],
  [/status|info/i, "info"],
  [/clear|delete|remove|disband/i, "trash"],
];

function iconTokenForItem(itemId: string, rawIcon?: string | null): string {
  const key = String(itemId || "").trim();
  const raw = String(rawIcon || "").trim().toLowerCase();
  for (const [rule, token] of ACTION_ICON_RULES) {
    if (rule.test(key) || (raw && rule.test(raw))) return token;
  }
  if (raw === "pdf") return "download";
  if (raw === "+" || raw === "＋") return "plus";
  if (raw === "✓" || raw === "check") return "check";
  return raw ? "action" : "dot";
}

function clampIntoViewport(root: HTMLElement) {
  const rect = root.getBoundingClientRect();
  const pad = 8;
  const composerRect = composerAvoidRect();
  const bottomLimit =
    composerRect && composerRect.width > 0 && composerRect.height > 0 && composerRect.top > 0
      ? Math.min(window.innerHeight - pad, composerRect.top - pad)
      : window.innerHeight - pad;
  let dx = 0;
  let dy = 0;
  if (rect.right > window.innerWidth - pad) dx = (window.innerWidth - pad) - rect.right;
  if (rect.left < pad) dx = pad - rect.left;
  if (rect.bottom > bottomLimit) dy = bottomLimit - rect.bottom;
  if (rect.top < pad) dy = pad - rect.top;
  if (!dx && !dy) return;
  const left = Number.parseFloat(root.style.left || "0") || 0;
  const top = Number.parseFloat(root.style.top || "0") || 0;
  root.style.left = `${Math.max(pad, left + dx)}px`;
  root.style.top = `${Math.max(pad, top + dy)}px`;
}

function applyPopoverGeometry(root: HTMLElement) {
  const composerRect = composerAvoidRect();
  const pad = 8;
  const bottomLimit =
    composerRect && composerRect.width > 0 && composerRect.height > 0 && composerRect.top > 0
      ? Math.min(window.innerHeight - pad, composerRect.top - pad)
      : window.innerHeight - pad;
  const available = Math.max(160, bottomLimit - pad);
  root.style.maxHeight = `${Math.min(available, Math.round(window.innerHeight * 0.7))}px`;
  root.style.setProperty("--ctx-list-max-h", `${Math.max(120, available - 24)}px`);
}

function applySheetGeometry(root: HTMLElement) {
  const viewportH = Math.max(320, Number(window.innerHeight || 0));
  const pad = 10;
  const composerRect = composerAvoidRect();
  const composerVisible = Boolean(
    composerRect &&
      composerRect.width > 0 &&
      composerRect.height > 0 &&
      composerRect.top > 0 &&
      composerRect.top < viewportH &&
      composerRect.bottom > viewportH * 0.42
  );
  const composerOffset = composerVisible ? Math.max(0, viewportH - Math.max(0, composerRect!.top) + 8) : 0;
  const bottomOffset = Math.min(Math.round(viewportH * 0.42), Math.round(composerOffset));
  const maxHeight = Math.max(172, Math.min(360, viewportH - bottomOffset - pad * 2, Math.round(viewportH * (bottomOffset ? 0.44 : 0.48))));
  root.style.maxHeight = `${maxHeight}px`;
  root.style.setProperty("--ctx-sheet-bottom-offset", `${bottomOffset}px`);
  root.style.setProperty("--ctx-sheet-max-h", `${maxHeight}px`);
  root.style.setProperty("--ctx-list-max-h", `${Math.max(112, maxHeight - 72)}px`);
  root.setAttribute("data-composer-avoid", composerVisible ? "1" : "0");
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function findMessageAnchorRect(payload: ContextMenuPayload): DOMRect | null {
  if (payload?.target?.kind !== "message") return null;
  const id = String(payload.target.id || "").trim();
  if (!id) return null;
  try {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-msg-idx]"));
    const node = nodes.find((item) => String(item.getAttribute("data-msg-idx") || "").trim() === id) || null;
    const rect = node?.getBoundingClientRect?.() ?? null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  } catch {
    return null;
  }
}

function applyCompactMessageGeometry(root: HTMLElement, payload: ContextMenuPayload, messageRect: DOMRect | null) {
  const viewportW = Math.max(320, Number(window.innerWidth || 0));
  const viewportH = Math.max(320, Number(window.innerHeight || 0));
  const pad = 12;
  const topLimit = messageContextTopLimit();
  const actionCount = payload.items.filter((item) => !item.separator).length;
  const sepCount = payload.items.filter((item) => item.separator).length;
  const stackWidth = Math.min(276, viewportW - pad * 2);
  const actionWidth = Math.min(276, viewportW - 32);
  const width = Math.max(248, Math.min(stackWidth, viewportW - pad * 2));
  const actionListHeight = Math.min(292, 14 + actionCount * 40 + sepCount * 8);
  const previewHeight = payload.anchorPreview && !messageRect ? 48 : 0;
  const reactionHeight = payload.reactionBar?.emojis?.length ? 48 : 0;
  const estimatedHeight = actionListHeight + previewHeight + reactionHeight + 18;
  const composerRect = composerAvoidRect();
  const bottomLimit =
    composerRect && composerRect.width > 0 && composerRect.height > 0 && composerRect.top > 0
      ? Math.min(viewportH - pad, composerRect.top - pad)
      : viewportH - pad;
  const availableStack = Math.max(180, bottomLimit - topLimit);
  const height = Math.max(180, Math.min(estimatedHeight, availableStack));
  const anchorX = messageRect
    ? messageRect.left + messageRect.width / 2
    : Number.isFinite(Number(payload.x))
      ? Number(payload.x)
      : viewportW / 2;
  const anchorY = messageRect
    ? messageRect.top + messageRect.height / 2
    : Number.isFinite(Number(payload.y))
      ? Number(payload.y)
      : viewportH / 2;
  const rightLeaning = messageRect ? messageRect.left + messageRect.width / 2 > viewportW * 0.56 : anchorX > viewportW * 0.56;
  const leftRaw = messageRect
    ? rightLeaning
      ? messageRect.right - width
      : messageRect.left
    : anchorX - width * 0.48;
  const left = clampNumber(leftRaw, pad, viewportW - width - pad);
  const belowTop = messageRect ? messageRect.bottom + 8 : anchorY + 8;
  const aboveTop = messageRect ? messageRect.top - height - 8 : anchorY - height - 8;
  const roomBelow = bottomLimit - belowTop;
  const roomAbove = (messageRect ? messageRect.top : anchorY) - topLimit - 8;
  const hasRoomBelow = roomBelow >= Math.min(height, 220);
  const preferAbove = !hasRoomBelow && roomAbove > roomBelow;
  const topRaw = preferAbove ? aboveTop : belowTop;
  const top = clampNumber(topRaw, topLimit, Math.max(topLimit, bottomLimit - height));
  const listMax = Math.max(124, Math.min(actionListHeight, height - reactionHeight - previewHeight - 18));
  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;
  root.style.setProperty("--ctx-react-pill-w", `${Math.round(stackWidth)}px`);
  root.style.setProperty("--ctx-action-list-w", `${Math.round(actionWidth)}px`);
  root.style.setProperty("--ctx-list-max-h", `${Math.round(listMax)}px`);
  root.style.maxHeight = `${Math.round(height)}px`;
  root.setAttribute("data-anchor", messageRect ? "message-row" : "tap");
  root.setAttribute("data-anchor-visible", messageRect ? "1" : "0");
  root.setAttribute("data-align", rightLeaning ? "end" : "start");
  root.setAttribute("data-stack-position", preferAbove ? "above-message" : "below-message");
}

export function renderContextMenu(payload: ContextMenuPayload, actions: ContextMenuActions): HTMLElement {
  const compactMessage = shouldRenderAsCompactMessage(payload);
  const sheet = shouldRenderAsSheet(payload);
  const targetKind = String(payload.target?.kind || "menu").replace(/[^a-z0-9_-]/gi, "");
  const titleText = String(payload.title || "").trim();
  const showTitle = Boolean(titleText && titleText !== "Меню" && !compactMessage);
  const liveMessageRect = compactMessage ? findMessageAnchorRect(payload) : null;
  const root = el("div", {
    class: compactMessage
      ? `ctx-menu ctx-menu-message-compact ctx-menu-message-action-list ctx-menu-${targetKind}`
      : sheet
        ? `ctx-menu ctx-menu-sheet ctx-menu-${targetKind}`
        : `ctx-menu ctx-menu-${targetKind}`,
    role: "menu",
    tabindex: "-1",
    "aria-label": titleText || "Контекстное меню",
    "data-target-kind": targetKind,
    "data-menu-layout": compactMessage ? "message-action-list" : sheet ? "modern-sheet" : "popover",
    "data-menu-density": compactMessage ? "ios-action" : undefined,
    "data-menu-stack": compactMessage ? "selected-message-stack" : undefined,
    "data-has-reactions": payload.reactionBar?.emojis?.length ? "1" : undefined,
  });
  if (!sheet) {
    root.style.left = `${payload.x}px`;
    root.style.top = `${payload.y}px`;
  }

  if (sheet) root.append(el("div", { class: "ctx-handle", "aria-hidden": "true" }));

  const title = showTitle ? el("div", { class: "ctx-title" }, [titleText]) : null;
  const closeBtn = sheet
    ? (el(
        "button",
        {
          class: "btn ctx-close",
          type: "button",
          title: "Закрыть",
          "aria-label": "Закрыть",
        },
        ["×"]
      ) as HTMLButtonElement)
    : null;
  closeBtn?.addEventListener("click", () => actions.onClose());
  const header = sheet ? el("div", { class: "ctx-header" }, [...(title ? [title] : []), ...(closeBtn ? [closeBtn] : [])]) : title;

  const reactionBar =
    payload.reactionBar && Array.isArray(payload.reactionBar.emojis) && payload.reactionBar.emojis.length
      ? (() => {
          const mine = payload.reactionBar?.active ?? null;
          const btns = payload.reactionBar.emojis.map((emoji) => {
            const active = mine === emoji;
            const btn = el(
              "button",
              {
                class: active ? "ctx-react is-active" : "ctx-react",
                type: "button",
                "aria-pressed": active ? "true" : "false",
                "aria-label": active ? `Убрать реакцию ${emoji}` : mine ? `Заменить реакцию на ${emoji}` : `Поставить реакцию ${emoji}`,
                "data-reaction": emoji,
                title: active ? `Убрать реакцию ${emoji}` : mine ? `Заменить реакцию на ${emoji}` : `Поставить реакцию ${emoji}`,
              },
              [emoji]
            ) as HTMLButtonElement;
            btn.addEventListener("click", () => actions.onSelect(`react:${emoji}`));
            return btn;
          });
          const pickerBtn = el(
            "button",
            {
              class: "ctx-react ctx-react-more",
              type: "button",
              title: mine ? "Изменить реакцию" : "Добавить реакцию",
              "aria-label": mine ? "Изменить реакцию" : "Добавить реакцию",
              "data-reaction": "more",
            },
            ["＋"]
          ) as HTMLButtonElement;
          pickerBtn.addEventListener("click", () => actions.onSelect("react_picker"));
          btns.push(pickerBtn);
          return el("div", { class: "ctx-reacts", role: "group", "aria-label": "Реакции" }, btns);
        })()
      : null;

  const anchorPreview =
    compactMessage && payload.anchorPreview && !liveMessageRect
      ? el("div", { class: "ctx-selected-preview", "aria-hidden": "true" }, [String(payload.anchorPreview).trim()])
      : null;

  const nodes = payload.items.map((it) => {
    if (it.separator) {
      return el("div", { class: "ctx-sep", role: "separator", "aria-hidden": "true" });
    }
    const idSafe = String(it.id || "").replace(/[^a-z0-9:_-]/gi, "");
    const clsBase = it.danger ? "ctx-item ctx-danger" : "ctx-item";
    const cls = it.subLabel ? `${clsBase} ctx-item-multiline` : clsBase;
    const iconToken = iconTokenForItem(it.id, it.icon);
    const icon = it.icon || sheet || compactMessage ? el("span", { class: "ctx-icon", "aria-hidden": "true", "data-ctx-icon": iconToken }) : null;
    const main = el("span", { class: "ctx-main" }, [
      el("span", { class: "ctx-label" }, [it.label]),
      ...(it.subLabel ? [el("span", { class: "ctx-sub" }, [it.subLabel])] : []),
    ]);
    const meta = it.meta ? el("span", { class: "ctx-meta" }, [it.meta]) : null;
    const btn = el(
      "button",
      {
        class: cls,
        type: "button",
        "data-item-id": idSafe || undefined,
        ...(it.danger ? { "data-danger": "true" } : {}),
        ...(sheet ? {} : { role: "menuitem" }),
        ...(it.disabled ? { disabled: "true" } : {}),
      },
      [...(icon ? [icon] : []), main, ...(meta ? [meta] : [])]
    ) as HTMLButtonElement;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      actions.onSelect(it.id);
    });
    return btn;
  });

  root.append(
    ...(header ? [header] : []),
    ...(reactionBar ? [reactionBar] : []),
    ...(anchorPreview ? [anchorPreview] : []),
    el("div", { class: "ctx-list" }, nodes)
  );

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onClose();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusFirstEnabled(root);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusLastEnabled(root);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(root, 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(root, -1);
      return;
    }
  });

  queueMicrotask(() => {
    if (sheet) {
      applySheetGeometry(root);
    } else if (compactMessage) {
      applyCompactMessageGeometry(root, payload, liveMessageRect);
    } else {
      applyPopoverGeometry(root);
      clampIntoViewport(root);
    }
    try {
      root.focus({ preventScroll: true });
    } catch {
      root.focus();
    }
  });

  return root;
}
