import type { AppState, ContextMenuPayload } from "../stores/types";
import type { Layout } from "../components/layout/types";

export function formatDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function parseDatetimeLocal(value: string): number | null {
  const v = String(value || "").trim();
  const match = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const mon = Number(match[2]);
  const day = Number(match[3]);
  const h = Number(match[4]);
  const min = Number(match[5]);
  if (!Number.isFinite(y) || !Number.isFinite(mon) || !Number.isFinite(day) || !Number.isFinite(h) || !Number.isFinite(min)) return null;
  const d = new Date(y, mon - 1, day, h, min, 0, 0);
  const ts = d.getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function shouldRenderContextMenuAsSheet(payload?: ContextMenuPayload): boolean {
  if (payload?.target?.kind === "message") return false;
  try {
    return Boolean(window.matchMedia?.("(pointer: coarse)")?.matches || window.matchMedia?.("(hover: none)")?.matches);
  } catch {
    return false;
  }
}

export function contextMenuPayloadKey(payload: ContextMenuPayload, sheet: boolean): string {
  const title = String(payload?.title || "");
  const pos = sheet
    ? { x: 0, y: 0 }
    : {
        x: Number.isFinite(Number(payload?.x)) ? Math.round(Number(payload.x)) : 0,
        y: Number.isFinite(Number(payload?.y)) ? Math.round(Number(payload.y)) : 0,
      };
  const items = Array.isArray(payload?.items)
    ? payload.items.map((it) =>
        it?.separator
          ? { separator: 1 }
          : {
              id: String(it?.id || ""),
              label: String(it?.label || ""),
              icon: String(it?.icon || ""),
              danger: it?.danger ? 1 : 0,
              disabled: it?.disabled ? 1 : 0,
            }
      )
    : [];
  const reactionBar = payload?.reactionBar
    ? {
        emojis: Array.isArray(payload.reactionBar.emojis) ? payload.reactionBar.emojis : [],
        active: String(payload.reactionBar.active || ""),
      }
    : null;
  try {
    return JSON.stringify({ v: 1, sheet: sheet ? 1 : 0, title, ...pos, items, reactionBar });
  } catch {
    return `${sheet ? 1 : 0}:${pos.x}:${pos.y}:${title}:${items.length}:${reactionBar ? 1 : 0}`;
  }
}

export function forwardModalPayloadKey(modal: Extract<NonNullable<AppState["modal"]>, { kind: "forward_select" }>): string {
  const drafts =
    Array.isArray(modal.forwardDrafts) && modal.forwardDrafts.length
      ? modal.forwardDrafts
      : modal.forwardDraft
        ? [modal.forwardDraft]
        : [];
  const parts = drafts
    .map((d) => {
      const key = String((d as any)?.key ?? "").trim();
      const id = (d as any)?.id;
      const localId = String((d as any)?.localId ?? "").trim();
      const ref = id !== undefined && id !== null ? String(id) : localId;
      return key && ref ? `${key}:${ref}` : key ? key : ref ? ref : "";
    })
    .filter(Boolean);
  return parts.length ? parts.join("|") : "empty";
}

export function formatSenderLabel(state: AppState, senderId: string): string {
  const id = String(senderId || "").trim();
  if (!id) return "";
  if (String(state.selfId || "") === id) return "Я";
  const friend = (state.friends || []).find((item) => String(item.id || "").trim() === id);
  const profile = state.profiles?.[id];
  const displayName = String(friend?.display_name || profile?.display_name || "").trim();
  const handleRaw = String(friend?.handle || profile?.handle || "").trim();
  const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
  if (displayName) return displayName;
  if (handle) return handle;
  return id;
}

export function mountChat(layout: Layout, node: HTMLElement) {
  if (layout.chatHost.childNodes.length === 1 && layout.chatHost.firstChild === node) return;
  layout.chatHost.replaceChildren(node);
}

export function mountRightCol(layout: Layout, node: HTMLElement) {
  if (layout.rightCol.childNodes.length === 1 && layout.rightCol.firstChild === node) return;
  layout.rightCol.replaceChildren(node);
}
