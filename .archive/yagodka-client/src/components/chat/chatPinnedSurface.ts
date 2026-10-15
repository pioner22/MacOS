import { el } from "../../helpers/dom/el";
import { formatTime } from "../../helpers/time";
import { fileBadge } from "../../helpers/files/fileBadge";
import type { ChatMessage } from "../../stores/types";

type RenderChatPinnedSurfaceOptions = {
  msgs: ChatMessage[];
  pinnedIds: number[];
  activeRaw: number | null;
};

type PinnedPreview = {
  label: string;
  preview: string;
  meta: string;
  kind: string;
};

function resolvePinnedPreview(msg: ChatMessage | null, activeId: number): PinnedPreview {
  const attachment = msg?.attachment;
  if (attachment?.kind === "file") {
    const name = String(attachment.name || "файл");
    const badge = fileBadge(name, attachment.mime);
    return {
      label: badge.kind === "pdf" ? "PDF закреплён" : "Файл закреплён",
      preview: name,
      meta: [badge.kind === "pdf" ? "PDF" : "Файл", attachment.size ? `${Math.round(attachment.size / 1024)} KB` : "", msg?.ts ? formatTime(msg.ts) : ""]
        .filter(Boolean)
        .join(" · "),
      kind: badge.kind,
    };
  }
  const text = String(msg?.text || "").trim();
  return {
    label: "Закреплено",
    preview: text || `Сообщение #${activeId}`,
    meta: [typeof activeId === "number" ? `#${activeId}` : "", msg?.ts ? formatTime(msg.ts) : ""].filter(Boolean).join(" · "),
    kind: "text",
  };
}

export function renderChatPinnedSurface(opts: RenderChatPinnedSurfaceOptions): HTMLElement | null {
  const { msgs, pinnedIds, activeRaw } = opts;
  if (!Array.isArray(pinnedIds) || !pinnedIds.length) return null;

  const activeId = typeof activeRaw === "number" && pinnedIds.includes(activeRaw) ? activeRaw : pinnedIds[0];
  const activeIdx = Math.max(0, pinnedIds.indexOf(activeId));
  const pinnedMsg = msgs.find((msg) => typeof msg.id === "number" && msg.id === activeId) || null;
  const pin = resolvePinnedPreview(pinnedMsg, activeId);
  const preview = pin.preview.length > 140 ? `${pin.preview.slice(0, 137)}...` : pin.preview;

  const kickerChildren: Array<string | HTMLElement> = [el("span", { class: "chat-pinned-label" }, [pin.label])];
  if (pinnedIds.length > 1) {
    kickerChildren.push(
      el("span", { class: "chat-pinned-count", "aria-label": `Закреп ${activeIdx + 1} из ${pinnedIds.length}` }, [
        `${activeIdx + 1}/${pinnedIds.length}`,
      ])
    );
  }

  const body = el(
    "button",
    { class: "chat-pinned-body", type: "button", "data-action": "chat-pinned-jump", "aria-label": "Показать закреплённое сообщение" },
    [
      el("div", { class: "chat-pinned-main" }, [
        el("div", { class: "chat-pinned-kicker" }, kickerChildren),
        el("span", { class: "chat-pinned-preview" }, [preview]),
        ...(pin.meta ? [el("span", { class: "chat-pinned-meta" }, [pin.meta])] : []),
      ]),
      el("span", { class: "chat-pinned-chevron", "aria-hidden": "true" }, [""]),
    ]
  );

  const actions: HTMLElement[] = [];
  if (pinnedIds.length > 1) {
    actions.push(
      el("button", { class: "btn chat-pinned-nav chat-pinned-prev", type: "button", "data-action": "chat-pinned-prev", "aria-label": "Предыдущее закреплённое" }, [""]),
      el("button", { class: "btn chat-pinned-nav chat-pinned-next", type: "button", "data-action": "chat-pinned-next", "aria-label": "Следующее закреплённое" }, [""])
    );
  }
  if (pinnedIds.length > 2) {
    actions.push(el("button", { class: "btn chat-pinned-nav chat-pinned-list", type: "button", "data-action": "chat-pinned-list", "aria-label": "Все закрепы" }, [""]));
  }
  actions.push(el("button", { class: "btn chat-pinned-close", type: "button", "data-action": "chat-pinned-hide", "aria-label": "Открепить активное закреплённое сообщение" }, [""]));

  return el("div", { class: `chat-pinned chat-pinned-${pin.kind}`, role: "note", "data-pinned-count": String(pinnedIds.length) }, [
    el("span", { class: "chat-pinned-marker", "aria-hidden": "true" }, [""]),
    body,
    el("div", { class: "chat-pinned-actions" }, actions),
  ]);
}
