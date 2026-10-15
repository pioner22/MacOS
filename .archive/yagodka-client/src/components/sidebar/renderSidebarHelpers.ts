import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { formatTime } from "../../helpers/time";
import { focusElement } from "../../helpers/ui/focus";
import { isIOS, isStandaloneDisplayMode } from "../../helpers/ui/iosInputAssistant";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type {
  ActionModalPayload,
  AppState,
  ChatMessage,
  ContextMenuTargetKind,
  FriendEntry,
  MobileSidebarTab,
  PageKind,
  TargetRef,
} from "../../stores/types";

export function collectAttentionPeers(state: AppState): Set<string> {
  const ids = new Set<string>();
  const add = (raw: unknown) => {
    const id = String(raw || "").trim();
    if (!id) return;
    if (state.selfId && id === String(state.selfId)) return;
    ids.add(id);
  };
  for (const id of state.pendingIn || []) add(id);
  for (const id of state.pendingOut || []) add(id);
  for (const inv of state.pendingGroupInvites || []) add(inv?.from);
  for (const req of state.pendingGroupJoinRequests || []) add(req?.from);
  for (const inv of state.pendingBoardInvites || []) add(inv?.from);
  for (const offer of state.fileOffersIn || []) add(offer?.from);
  return ids;
}

export const HANDLE_RE = /^[a-z0-9_]{3,16}$/;

export function collectSelfMentionHandles(state: AppState): Set<string> {
  const out = new Set<string>();
  const normalize = (raw: unknown): string | null => {
    const base = String(raw || "").trim().toLowerCase();
    if (!base) return null;
    const stripped = base.startsWith("@") ? base.slice(1) : base;
    if (!HANDLE_RE.test(stripped)) return null;
    return stripped;
  };
  const add = (raw: unknown) => {
    const handle = normalize(raw);
    if (handle) out.add(handle);
  };
  add(state.selfId);
  const profile = state.selfId ? state.profiles?.[state.selfId] : null;
  add(profile?.handle);
  return out;
}

export function hasSelfMention(text: string, handles: Set<string>): boolean {
  if (!handles.size) return false;
  const s = String(text || "");
  if (!s.includes("@")) return false;
  const re = /@([a-z0-9_]{3,16})/gi;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    const handle = String(m[1] || "").toLowerCase();
    if (handles.has(handle)) return true;
  }
  return false;
}

export function attentionHintForPeer(state: AppState, id: string): string | null {
  const peer = String(id || "").trim();
  if (!peer) return null;
  if ((state.pendingIn || []).includes(peer)) return "Запрос авторизации";
  if ((state.pendingOut || []).includes(peer)) return "Ожидаем авторизацию";
  if ((state.fileOffersIn || []).some((x) => String(x?.from || "").trim() === peer)) return "Входящий файл";
  if ((state.pendingGroupInvites || []).some((x) => String(x?.from || "").trim() === peer)) return "Приглашение в группу";
  if ((state.pendingBoardInvites || []).some((x) => String(x?.from || "").trim() === peer)) return "Инвайт в доску";
  if ((state.pendingGroupJoinRequests || []).some((x) => String(x?.from || "").trim() === peer)) return "Запрос вступления";
  return null;
}

export function isRowMenuOpen(state: AppState, kind: ContextMenuTargetKind, id: string): boolean {
  if (kind !== "dm" && kind !== "group" && kind !== "board") return false;
  const rowId = String(id || "").trim();
  if (!rowId) return false;
  const modal = state.modal;
  if (!modal || modal.kind !== "context_menu") return false;
  const target = modal.payload.target;
  return target.kind === kind && String(target.id || "").trim() === rowId;
}

export function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

export type SidebarRowMeta = {
  sub: string | null;
  time: string | null;
  hasDraft: boolean;
  reactionEmoji?: string | null;
};

export function displayNameForFriend(state: AppState, f: FriendEntry): string {
  const id = String(f.id || "").trim();
  if (!id) return "—";
  const p = state.profiles?.[id];
  const dn = p?.display_name ? String(p.display_name).trim() : "";
  if (dn) return dn;
  const fdn = (f as any).display_name ? String((f as any).display_name).trim() : "";
  return fdn || id;
}

export function compactOneLine(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickPreviewReactionEmoji(state: AppState, msg: ChatMessage | null): string | null {
  if (!msg || msg.kind === "sys") return null;
  const selfId = String(state.selfId || "").trim();
  const from = String(msg.from || "").trim();
  const isSelf = msg.kind === "out" || (selfId && from === selfId);
  if (!isSelf) return null;
  const counts = msg.reactions?.counts;
  if (!counts || typeof counts !== "object") return null;
  const entries = Object.entries(counts)
    .map(([emoji, count]) => [String(emoji || "").trim(), Number(count)] as const)
    .filter(([emoji, count]) => emoji && Number.isFinite(count) && count > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function shouldSuppressRowClick(btn: HTMLElement): boolean {
  const now = Date.now();
  const localUntil = Number(btn.getAttribute("data-ctx-suppress-until") || 0);
  return Number.isFinite(localUntil) && localUntil > now;
}

export function isImageName(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/.test(n);
}

export function previewForConversation(state: AppState, key: string, kind: "dm" | "room", draftText?: string | null): SidebarRowMeta {
  const draft = compactOneLine(draftText || "");
  const conv = state.conversations[key] || [];
  const last = conv.length ? conv[conv.length - 1] : null;
  const time = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? formatTime(last.ts) : null;
  const reactionEmoji = pickPreviewReactionEmoji(state, last);

  let sub: string | null = null;
  if (draft) {
    sub = `Черновик: ${draft}`;
  } else if (last) {
    if (last.attachment?.kind === "file") {
      const nm = String(last.attachment.name || "файл");
      sub = isImageName(nm, last.attachment.mime) ? "Фото" : `Файл: ${nm}`;
    } else {
      const t = compactOneLine(String(last.text || ""));
      sub = t || null;
    }
    if (kind === "dm" && sub) {
      const from = String(last.from || "").trim();
      if (from && from === state.selfId) sub = `Вы: ${sub}`;
    }
    if (kind === "room" && sub) {
      const from = String(last.from || "").trim();
      if (from) {
        const who = from === state.selfId ? "Вы" : from;
        sub = `${who}: ${sub}`;
      }
    }
  }

  if (sub && sub.length > 84) sub = `${sub.slice(0, 81)}…`;
  return { sub, time, hasDraft: Boolean(draft), reactionEmoji };
}

export function friendRow(
  state: AppState,
  f: FriendEntry,
  selected: boolean,
  meta: SidebarRowMeta,
  onSelect: (t: TargetRef) => void,
  onOpenUser: (id: string) => void,
  attn?: boolean
): HTMLElement {
  const peerId = String(f.id || "").trim();
  const muted = peerId ? (state.muted || []).includes(peerId) : false;
  const pinKey = peerId ? dmKey(peerId) : "";
  const pinned = Boolean(pinKey && (state.pinned || []).includes(pinKey));
  let cls = selected ? "row row-sel" : "row";
  if (muted) cls += " row-muted-chat";
  if (attn) cls += " row-attn";
  if (isRowMenuOpen(state, "dm", peerId)) cls += " row-menu-open";
  const unread = Math.max(0, Number(f.unread || 0) || 0);
  const unreadLabel = unread > 99 ? "99+" : String(unread);
  const tailTopChildren: HTMLElement[] = [];
  if (meta.time) {
    tailTopChildren.push(el("span", { class: "row-time", "aria-label": `Время: ${meta.time}` }, [meta.time]));
  }
  const tailBottomChildren: HTMLElement[] = [];
  if (meta.reactionEmoji) {
    tailBottomChildren.push(
      el("span", { class: "row-reaction", "aria-label": `Реакция: ${meta.reactionEmoji}` }, [meta.reactionEmoji])
    );
  }
  if (unread > 0) {
    tailBottomChildren.push(el("span", { class: "row-unread", "aria-label": `Непрочитано: ${unread}` }, [unreadLabel]));
  }
  if (pinned) tailBottomChildren.push(el("span", { class: "row-pin", "aria-label": "Закреплено" }, ["📌"]));
  if (meta.hasDraft) tailBottomChildren.push(el("span", { class: "row-draft", "aria-label": "Есть черновик" }, ["черновик"]));
  if (muted) tailBottomChildren.push(el("span", { class: "row-muted", "aria-label": "Звук отключён" }, ["M"]));
  const tailChildren: HTMLElement[] = [];
  if (tailTopChildren.length) tailChildren.push(el("span", { class: "row-tail-top" }, tailTopChildren));
  if (tailBottomChildren.length) tailChildren.push(el("span", { class: "row-tail-bottom" }, tailBottomChildren));
  const tail = tailChildren.length
    ? el("span", { class: "row-tail", "aria-hidden": tailChildren.length ? "false" : "true" }, tailChildren)
    : null;
  const titleText = displayNameForFriend(state, f);
  const isIdTitle = titleText === String(f.id || "").trim();
  const mainChildren: Array<string | HTMLElement> = [el("span", { class: isIdTitle ? "row-title row-id" : "row-title row-name" }, [titleText])];
  if (meta.sub) {
    mainChildren.push(el("span", { class: meta.hasDraft ? "row-sub row-sub-draft" : "row-sub" }, [meta.sub]));
  }
  const main = el("span", { class: "row-main" }, mainChildren);
  const av = avatar("dm", f.id);
  av.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenUser(f.id);
  });
  const btn = el("button", { class: cls, type: "button" }, [
    av,
    main,
    ...(tail ? [tail] : []),
  ]);
  btn.setAttribute("data-ctx-kind", "dm");
  btn.setAttribute("data-ctx-id", f.id);
  btn.setAttribute("data-online", f.online ? "1" : "0");
  btn.addEventListener("click", (e) => {
    const ev = e as MouseEvent;
    if (btn.hasAttribute("data-ctx-kind") && shouldSuppressRowClick(btn)) {
      btn.removeAttribute("data-ctx-suppress-until");
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    // Prevent Ctrl+Click / RMB quirks (macOS) from triggering navigation when opening context menu.
    if (ev.ctrlKey) return;
    if (typeof ev.button === "number" && ev.button !== 0) return;
    onSelect({ kind: "dm", id: f.id });
  });
  return btn;
}

export function roomRow(
  prefix: string | null,
  label: string,
  selected: boolean,
  onClick: () => void,
  ctx?: { kind: "group" | "board"; id: string },
  meta?: SidebarRowMeta,
  opts?: { mention?: boolean; muted?: boolean; unread?: number; pinned?: boolean; menuOpen?: boolean }
): HTMLElement {
  let cls = selected ? "row row-sel" : "row";
  if (opts?.muted) cls += " row-muted-chat";
  if (opts?.menuOpen) cls += " row-menu-open";
  const unread = Math.max(0, Number(opts?.unread || 0) || 0);
  const unreadLabel = unread > 99 ? "99+" : String(unread);
  const tailTopChildren: HTMLElement[] = [];
  if (meta?.time) tailTopChildren.push(el("span", { class: "row-time", "aria-label": `Время: ${meta.time}` }, [meta.time]));
  const tailBottomChildren: HTMLElement[] = [];
  if (meta?.reactionEmoji) {
    tailBottomChildren.push(
      el("span", { class: "row-reaction", "aria-label": `Реакция: ${meta.reactionEmoji}` }, [meta.reactionEmoji])
    );
  }
  if (opts?.mention) tailBottomChildren.push(el("span", { class: "row-mention", "aria-label": "Упоминание" }, ["@"]));
  if (unread > 0) {
    tailBottomChildren.push(el("span", { class: "row-unread", "aria-label": `Непрочитано: ${unread}` }, [unreadLabel]));
  }
  if (opts?.pinned) tailBottomChildren.push(el("span", { class: "row-pin", "aria-label": "Закреплено" }, ["📌"]));
  if (meta?.hasDraft) tailBottomChildren.push(el("span", { class: "row-draft", "aria-label": "Есть черновик" }, ["черновик"]));
  if (opts?.muted) tailBottomChildren.push(el("span", { class: "row-muted", "aria-label": "Звук отключён" }, ["M"]));
  const tailChildren: HTMLElement[] = [];
  if (tailTopChildren.length) tailChildren.push(el("span", { class: "row-tail-top" }, tailTopChildren));
  if (tailBottomChildren.length) tailChildren.push(el("span", { class: "row-tail-bottom" }, tailBottomChildren));
  const tail = tailChildren.length ? el("span", { class: "row-tail" }, tailChildren) : null;
  const hasConversationMeta = Boolean(ctx);
  const hasSub = Boolean(meta?.sub);
  const mainChildren: Array<string | HTMLElement> = [
    el("span", { class: hasConversationMeta || hasSub ? "row-title row-label" : "row-label" }, [label]),
    ...(hasSub ? [el("span", { class: meta?.hasDraft ? "row-sub row-sub-draft" : "row-sub" }, [String(meta?.sub || "")])] : []),
  ];
  const btn = el("button", { class: cls, type: "button" }, [
    ...(prefix ? [el("span", { class: "row-prefix", "aria-hidden": "true" }, [prefix])] : []),
    ...(ctx ? [avatar(ctx.kind, ctx.id)] : []),
    ...(hasConversationMeta || hasSub ? [el("span", { class: "row-main" }, mainChildren)] : mainChildren),
    ...(tail ? [tail] : []),
  ]);
  if (ctx) {
    btn.setAttribute("data-ctx-kind", ctx.kind);
    btn.setAttribute("data-ctx-id", ctx.id);
  }
  btn.addEventListener("click", (e) => {
    const ev = e as MouseEvent;
    if (btn.hasAttribute("data-ctx-kind") && shouldSuppressRowClick(btn)) {
      btn.removeAttribute("data-ctx-suppress-until");
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (ev.ctrlKey) return;
    if (typeof ev.button === "number" && ev.button !== 0) return;
    onClick();
  });
  return btn;
}
