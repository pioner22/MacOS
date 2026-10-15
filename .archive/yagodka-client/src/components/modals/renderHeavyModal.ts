import type { AppState, TargetRef } from "../../stores/types";
import { safeUrl } from "../../helpers/security/safeUrl";
import { mediaKindForViewerMessage, resolveViewerSourceScope } from "../../helpers/chat/fileViewerScope";
import { renderForwardModal } from "./renderForwardModal";
import { renderFileViewerModal } from "./renderFileViewerModal";
import type { FileViewerMeta } from "./renderFileViewerModal";

type ForwardSelectModal = Extract<NonNullable<AppState["modal"]>, { kind: "forward_select" }>;
type FileViewerModal = Extract<NonNullable<AppState["modal"]>, { kind: "file_viewer" }>;

export interface HeavyForwardModalActions {
  onClose: () => void;
  onForwardSend: (targets: TargetRef[]) => void;
}

export interface HeavyFileViewerModalActions {
  onClose: () => void;
  onFileViewerNavigate: (dir: "prev" | "next") => void;
  onFileViewerJump: () => void;
  onFileViewerRecover?: () => void;
  onFileViewerShare: () => void;
  onFileViewerForward: () => void;
  onFileViewerDelete: () => void;
  onFileViewerOpenAt: (msgIdx: number) => void;
}

function formatUserLabel(displayName: string, handle: string, fallback: string): string {
  const dn = String(displayName || "").trim();
  if (dn) return dn;
  const h = String(handle || "").trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return fallback || "—";
}

function normalizeHandle(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function resolveUserLabel(state: AppState, id: string): { label: string; handle: string } {
  const pid = String(id || "").trim();
  if (!pid) return { label: "—", handle: "" };
  const p = state.profiles?.[pid];
  if (p) {
    return {
      label: formatUserLabel(p.display_name || "", p.handle || "", pid),
      handle: normalizeHandle(String(p.handle || "")),
    };
  }
  const friend = (state.friends || []).find((f) => f.id === pid);
  if (friend) {
    return {
      label: formatUserLabel(friend.display_name || "", friend.handle || "", pid),
      handle: normalizeHandle(String(friend.handle || "")),
    };
  }
  return { label: pid, handle: "" };
}

function forwardRecentTargets(state: AppState, limit = 10): TargetRef[] {
  const max = Math.max(0, Math.min(24, Math.trunc(Number(limit) || 0)));
  if (!max) return [];

  const topPeerTs = new Map<string, number>();
  for (const entry of state.topPeers || []) {
    const id = String((entry as any)?.id || "").trim();
    const ts = Number((entry as any)?.last_ts ?? 0);
    if (!id || !Number.isFinite(ts) || ts <= 0) continue;
    const prev = topPeerTs.get(id) ?? 0;
    if (ts > prev) topPeerTs.set(id, ts);
  }

  const lastTs = (key: string): number => {
    const conv = state.conversations?.[key] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    const ts = Number((last as any)?.ts ?? 0);
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  };

  const items: Array<{ t: TargetRef; ts: number }> = [];

  for (const f of state.friends || []) {
    const id = String(f?.id || "").trim();
    if (!id) continue;
    const ts = Math.max(lastTs(`dm:${id}`), topPeerTs.get(id) ?? 0);
    if (ts <= 0) continue;
    items.push({ t: { kind: "dm", id }, ts });
  }

  for (const g of state.groups || []) {
    const id = String(g?.id || "").trim();
    if (!id) continue;
    const ts = lastTs(`room:${id}`);
    if (ts <= 0) continue;
    items.push({ t: { kind: "group", id }, ts });
  }

  for (const b of state.boards || []) {
    const id = String(b?.id || "").trim();
    if (!id) continue;
    const ts = lastTs(`room:${id}`);
    if (ts <= 0) continue;
    items.push({ t: { kind: "board", id }, ts });
  }

  items.sort((a, b) => b.ts - a.ts);
  const seen = new Set<string>();
  const out: TargetRef[] = [];
  for (const item of items) {
    const key = `${item.t.kind}:${item.t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.t);
    if (out.length >= max) break;
  }
  return out;
}

function buildFileViewerMeta(state: AppState, modal: FileViewerModal): FileViewerMeta | null {
  const chatKey = modal.chatKey ? String(modal.chatKey) : "";
  const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;
  if (!chatKey || msgIdx === null) return null;
  const conv = state.conversations[chatKey] || [];
  if (msgIdx < 0 || msgIdx >= conv.length) return null;
  const msg = conv[msgIdx];
  if (!msg || msg.kind === "sys") return null;
  const authorId = String((msg.kind === "out" ? state.selfId || msg.from : msg.from) || "").trim();
  if (!authorId) return null;
  const identity = resolveUserLabel(state, authorId);
  const ts = Number(msg.ts);
  return {
    authorId,
    authorLabel: identity.label,
    authorHandle: identity.handle,
    authorKind: "dm",
    timestamp: Number.isFinite(ts) ? ts : null,
  };
}

export function renderForwardSelectModal(
  state: AppState,
  modal: ForwardSelectModal,
  actions: HeavyForwardModalActions
): HTMLElement | null {
  const drafts =
    Array.isArray(modal.forwardDrafts) && modal.forwardDrafts.length
      ? modal.forwardDrafts
      : modal.forwardDraft
        ? [modal.forwardDraft]
        : [];
  if (!drafts.length) return null;
  const recents = forwardRecentTargets(state, 10);
  return renderForwardModal(
    drafts,
    state.friends || [],
    state.groups || [],
    state.boards || [],
    state.profiles || {},
    {
      pinnedKeys: state.pinned || [],
      archivedKeys: state.archived || [],
      conversations: state.conversations || {},
      topPeers: state.topPeers || [],
    },
    recents,
    modal.message,
    {
      onSend: actions.onForwardSend,
      onCancel: actions.onClose,
    }
  );
}

export function renderFileViewerHeavyModal(
  state: AppState,
  modal: FileViewerModal,
  actions: HeavyFileViewerModalActions
): HTMLElement {
  const canPrev = typeof modal.prevIdx === "number" && Number.isFinite(modal.prevIdx);
  const canNext = typeof modal.nextIdx === "number" && Number.isFinite(modal.nextIdx);
  const canJump = Boolean(modal.chatKey && typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx));
  const metaBase = buildFileViewerMeta(state, modal);
  const base = typeof location !== "undefined" ? location.href : "http://localhost/";
  const viewerMessage = (() => {
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;
    if (!chatKey || msgIdx === null) return null;
    const conv = state.conversations[chatKey] || [];
    if (msgIdx < 0 || msgIdx >= conv.length) return null;
    const msg = conv[msgIdx];
    if (!msg || msg.kind === "sys") return null;
    return { chatKey, msgIdx, msg };
  })();
  const posterUrl = (() => {
    if (!viewerMessage) return null;
    const att = viewerMessage.msg?.attachment;
    if (!att || att.kind !== "file") return null;
    const fileId = String(att.fileId || "").trim();
    if (!fileId) return null;
    const raw = state.fileThumbs?.[fileId]?.url ? state.fileThumbs[fileId].url : null;
    if (!raw) return null;
    return safeUrl(raw, { base, allowedProtocols: ["http:", "https:", "blob:"] });
  })();
  const rail = (() => {
    if (!viewerMessage) return [];
    const conv = state.conversations[viewerMessage.chatKey] || [];
    const scope = resolveViewerSourceScope(conv, viewerMessage.msgIdx);
    const buildItem = (idx: number) => {
      const msg = conv[idx];
      const kind = mediaKindForViewerMessage(msg);
      if (!msg || !kind) return null;
      const att = msg.attachment;
      if (!att || att.kind !== "file") return null;
      const name = String(att.name || "файл");
      const fileId = att.fileId ? String(att.fileId) : "";
      const thumbRaw = fileId && state.fileThumbs?.[fileId]?.url ? state.fileThumbs[fileId].url : null;
      const transferUrl =
        fileId && state.fileTransfers?.length
          ? state.fileTransfers.find((t) => String(t.id || "").trim() === fileId && Boolean(t.url))?.url || null
          : null;
      const thumbUrl = thumbRaw
        ? safeUrl(thumbRaw, { base, allowedProtocols: ["http:", "https:", "blob:"] })
        : kind === "image" && transferUrl
          ? safeUrl(transferUrl, { base, allowedProtocols: ["http:", "https:", "blob:"] })
          : null;
      return { msgIdx: idx, name, kind, thumbUrl, active: idx === viewerMessage.msgIdx };
    };
    if (!scope || scope.kind !== "album") return [];
    return scope.indices.map((idx) => buildItem(idx)).filter((x): x is NonNullable<ReturnType<typeof buildItem>> => Boolean(x));
  })();
  const meta: FileViewerMeta | null = (() => {
    if (!rail.length) return metaBase;
    const baseMeta = metaBase ? metaBase : {};
    return { ...baseMeta, rail };
  })();
  const canForward = Boolean(viewerMessage && !state.editing);
  const canDelete = (() => {
    if (!viewerMessage) return false;
    const msg = viewerMessage.msg;
    const msgId = typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : 0;
    const canAct = state.conn === "connected" && state.authed;
    const canOwner = Boolean(msg.kind === "out" && state.selfId && String(msg.from) === String(state.selfId));
    return Boolean(canAct && canOwner && msgId > 0);
  })();
  return renderFileViewerModal(
    modal.url,
    modal.name,
    modal.size,
    modal.mime,
    modal.caption ?? null,
    meta,
    {
      ...(actions.onFileViewerRecover ? { onRecover: actions.onFileViewerRecover } : {}),
      onClose: actions.onClose,
      ...(canPrev ? { onPrev: () => actions.onFileViewerNavigate("prev") } : {}),
      ...(canNext ? { onNext: () => actions.onFileViewerNavigate("next") } : {}),
      ...(canJump ? { onJump: () => actions.onFileViewerJump() } : {}),
      ...(actions.onFileViewerShare ? { onShare: () => actions.onFileViewerShare() } : {}),
      ...(viewerMessage ? { onForward: () => actions.onFileViewerForward(), canForward } : {}),
      ...(canDelete ? { onDelete: () => actions.onFileViewerDelete(), canDelete } : {}),
      ...(viewerMessage ? { onOpenAt: (msgIdx: number) => actions.onFileViewerOpenAt(msgIdx) } : {}),
    },
    { autoplay: Boolean(modal.autoplay), posterUrl, fallbackUrl: modal.fallbackUrl ?? null }
  );
}
