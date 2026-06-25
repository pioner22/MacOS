import { el } from "../../helpers/dom/el";
import { formatTime } from "../../helpers/time";
import { conversationKey, dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { getConversationHistorySyncState } from "../../helpers/chat/historySync";
import { isPinnedMessage } from "../../helpers/chat/pinnedMessages";
import { isMessageContinuation } from "../../helpers/chat/messageGrouping";
import type { AppState, ChatMessage, ChatMessageRef, FileOfferIn, FileTransferEntry } from "../../stores/types";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { fileBadge } from "../../helpers/files/fileBadge";
import { MISSING_FILE_STATUS, isTerminalMissingVisualTransfer } from "../../helpers/files/fileMissingState";
import { isAudioLikeFile, isImageLikeFile, isVideoLikeFile, normalizeFileName } from "../../helpers/files/mediaKind";
import { resolveProgressiveMediaUrl } from "../../helpers/files/progressiveMedia";
import { safeUrl } from "../../helpers/security/safeUrl";
import { renderRichText } from "../../helpers/chat/richText";
import { renderBoardPost } from "../../helpers/boards/boardPost";
import { getActiveConversationTarget } from "../../helpers/navigation/mainConversationState";
import { sanitizeTargetRef } from "../../helpers/navigation/viewState";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { getCachedMediaAspectRatio } from "../../helpers/chat/mediaAspectCache";
import {
  HISTORY_VIRTUAL_THRESHOLD,
  HISTORY_VIRTUAL_WINDOW,
  clampVirtualAvg,
  getVirtualEnd,
  getVirtualMaxStart,
  getVirtualStart,
  shouldVirtualize,
} from "../../helpers/chat/virtualHistory";
import { CHAT_SEARCH_FILTERS } from "../../helpers/chat/chatSearch";
import { renderAttachmentFooterShell } from "./attachmentFooterShell";
import { renderDeferredVoicePlayer } from "./chatDeferredMediaRuntime";
import { renderDeferredSysMessage } from "./chatSpecialMessageRuntime";
import { renderDeferredVisualPreview } from "./chatVisualPreviewRuntime";
import { type FileAttachmentInfo, isVideoNoteName } from "./chatVisualPreviewShared";
import { renderChatFileActions, renderChatFilePills, resolveChatFileSurfaceInfo } from "./chatFileAttachmentSurface";
import { renderMediaOverlayControls } from "./mediaOverlayControls";
import { renderMessageContentShell } from "./messageContentShell";
import { renderMessageSelectionControl } from "./messageSelectionControl";
export {
  type ChatShiftAnchor,
  type UnreadDividerAnchor,
  captureChatShiftAnchor,
  findChatShiftAnchorElement,
  findUnreadAnchorIndex,
  unreadAnchorForMessage,
} from "../../helpers/chat/historyViewportAnchors";

export function dayKey(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  } catch {
    return "";
  }
}

export const EMPTY_CHAT: ChatMessage[] = [];
export const EMPTY_HITS: number[] = [];

export function formatDayLabel(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    // Prefer RU locale, but keep it robust if runtime doesn't support it.
    const label = d.toLocaleDateString("ru-RU", sameYear ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" });
    return label || dayKey(ts) || "—";
  } catch {
    return dayKey(ts) || "—";
  }
}

export function formatSelectionCount(count: number): string {
  const n = Math.max(0, Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word = "сообщений";
  if (mod10 === 1 && mod100 !== 11) word = "сообщение";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "сообщения";
  return `${n} ${word}`;
}

export function shortenChatFileNameTelegram(
  name: string,
  maxWords = 4,
  maxChars = 25
): { title: string; display: string } {
  const title = String(name || "").trim() || "файл";
  const dotIndex = title.lastIndexOf(".");
  const hasExt = dotIndex > 0 && dotIndex < title.length - 1;
  const base = hasExt ? title.slice(0, dotIndex) : title;
  const ext = hasExt ? title.slice(dotIndex) : "";
  const body = base.trim() || title;

  let wordCount = 0;
  let inWord = false;

  for (let idx = 0; idx < body.length; idx++) {
    const ch = body[idx];
    const isSep = ch === " " || ch === "_" || ch === "-" || ch === "\t";
    if (!inWord && !isSep) inWord = true;
    if (inWord && isSep) {
      inWord = false;
      wordCount += 1;
    }
  }
  if (inWord) wordCount += 1;

  const needsShorten = body.length > maxChars || wordCount > maxWords;
  if (!needsShorten) return { title, display: title };

  const prefix = body
    .slice(0, Math.max(1, Math.min(body.length, maxChars)))
    .trimEnd()
    .replace(/[\s_-]+$/g, "");
  const safePrefix = prefix || body.slice(0, Math.max(1, Math.min(body.length, maxChars))).trimEnd();
  return { title, display: `${safePrefix}…${ext}` };
}

export function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

export function chatTitleNodes(state: AppState): Array<string | HTMLElement> {
  const sel = getActiveConversationTarget(state) ?? sanitizeTargetRef(state.selected);
  if (!sel) return ["Чат"];
  if (sel.kind === "dm") {
    const p = state.profiles?.[sel.id];
    const dn = p?.display_name ? String(p.display_name).trim() : "";
    const h = p?.handle ? String(p.handle).trim() : "";
    const label = dn || (h ? (h.startsWith("@") ? h : `@${h}`) : sel.id);
    return [avatar("dm", sel.id), `Чат с: ${label}`];
  }
  if (sel.kind === "group") {
    const g = (state.groups || []).find((x) => x.id === sel.id);
    return [avatar("group", sel.id), `Чат: ${String(g?.name || sel.id)}`];
  }
  const b = (state.boards || []).find((x) => x.id === sel.id);
  return [avatar("board", sel.id), `Доска: ${String(b?.name || sel.id)}`];
}

export function formatBytes(size: number): string {
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

export function resolveUserAccent(seed: string): string | null {
  const s = String(seed ?? "").trim();
  if (!s) return null;
  const hue = avatarHue(s);
  return `hsl(${hue} 68% 58%)`;
}

export { normalizeFileName, isImageLikeFile, isVideoLikeFile, isAudioLikeFile };

function isVoiceNoteName(name: string): boolean {
  const n = normalizeFileName(name);
  return n.startsWith("voice_") || n.startsWith("voice-note") || n.startsWith("voice_note") || n.includes("_voice_note");
}

export function transferStatus(entry: FileTransferEntry): string {
  if (entry.status === "uploading") return "Загрузка";
  if (entry.status === "downloading") return "Скачивание";
  if (entry.status === "uploaded") return "Файл загружен";
  if (entry.status === "complete") return "Готово";
  if (entry.status === "rejected") return "Отклонено";
  if (isTerminalMissingVisualTransfer(entry)) return MISSING_FILE_STATUS;
  if (entry.status === "error") return `Ошибка: ${entry.error || "неизвестно"}`;
  return entry.direction === "out" ? "Ожидание подтверждения" : "Ожидание отправителя";
}

export function statusLabel(m: ChatMessage): string {
  const status = m.status;
  if (!status) return "";
  const hasServerId = typeof m.id === "number" && Number.isFinite(m.id) && m.id > 0;
  if (status === "sending") return "…";
  if (status === "queued") return hasServerId ? "✓" : "…";
  if (status === "sent") return "✓";
  if (status === "delivered") return "✓✓";
  if (status === "read") return "✓✓";
  if (status === "error") return "!";
  return "";
}

export function statusTitle(m: ChatMessage): string {
  const status = m.status;
  if (!status) return "";
  const scheduleAt = typeof m.scheduleAt === "number" && Number.isFinite(m.scheduleAt) ? m.scheduleAt : 0;
  if (status === "queued" && scheduleAt > Date.now()) {
    try {
      const when = new Date(scheduleAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      return when ? `Запланировано на ${when}` : "Запланировано";
    } catch {
      return "Запланировано";
    }
  }
  const hasServerId = typeof m.id === "number" && Number.isFinite(m.id) && m.id > 0;
  if (status === "sending") return "Отправляется…";
  if (status === "queued") return m.whenOnline || hasServerId ? "В очереди (адресат оффлайн)" : "В очереди (нет соединения)";
  if (status === "sent") return "Отправлено";
  if (status === "delivered") return "Доставлено";
  if (status === "read") return "Прочитано";
  if (status === "error") return "Ошибка отправки";
  return "";
}

export function formatUserLabel(displayName: string, handle: string, fallback: string): string {
  const dn = String(displayName || "").trim();
  if (dn) return dn;
  const h = String(handle || "").trim();
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return fallback || "—";
}

export function resolveUserLabel(state: AppState, id: string, friendLabels?: Map<string, string>): string {
  const pid = String(id || "").trim();
  if (!pid) return "—";
  const p = state.profiles?.[pid];
  if (p) return formatUserLabel(p.display_name || "", p.handle || "", pid);
  const fromFriends = friendLabels?.get(pid);
  return fromFriends || pid;
}

export function resolveUserHandle(state: AppState, id: string): string {
  const pid = String(id || "").trim();
  if (!pid) return "";
  const p = state.profiles?.[pid];
  return normalizeHandle(String(p?.handle || ""));
}

export function normalizeHandle(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

export function refPreview(ref: ChatMessageRef): string {
  const rawText = String(ref?.text || "")
    .replace(/\s+/g, " ")
    .trim();
  const text = rawText && !rawText.startsWith("[file]") ? rawText : "";
  if (text) return text;
  const attachment = ref?.attachment;
  if (attachment?.kind === "file") {
    const name = String(attachment.name || "файл");
    const badge = fileBadge(name, attachment.mime);
    let kindLabel = "Файл";
    if (badge.kind === "image") kindLabel = "Фото";
    else if (badge.kind === "video") kindLabel = "Видео";
    else if (badge.kind === "audio") kindLabel = "Аудио";
    else if (badge.kind === "archive") kindLabel = "Архив";
    else if (badge.kind === "doc") kindLabel = "Документ";
    else if (badge.kind === "pdf") kindLabel = "PDF";
    return name ? `${kindLabel}: ${name}` : kindLabel;
  }
  if (attachment?.kind === "action") return "Действие";
  return "Сообщение";
}

export function renderMessageRef(
  state: AppState,
  ref: ChatMessageRef | null | undefined,
  kind: "reply" | "forward",
  friendLabels?: Map<string, string>
): HTMLElement | null {
  if (!ref) return null;
  const fromId = String(ref.from || "").trim();
  const sender = fromId ? resolveUserLabel(state, fromId, friendLabels) : "";
  const isForward = kind === "forward";
  const isReply = kind === "reply";
  const titleBase = isForward ? "Переслано" : "Ответ";
  const viaBot = normalizeHandle(String(ref.via_bot || (ref as any).viaBot || ""));
  const postAuthor = String(ref.post_author || (ref as any).postAuthor || "").trim();
  const hiddenProfile = Boolean(ref.hidden_profile ?? (ref as any).hiddenProfile ?? false);
  const canShowSender = Boolean(sender) && !(isForward && hiddenProfile);
  const title = canShowSender ? (isForward ? `Переслано от ${sender}` : `Ответ: ${sender}`) : titleBase;
  const metaParts: string[] = [];
  const senderHandle = !hiddenProfile && fromId ? resolveUserHandle(state, fromId) : "";
  if (senderHandle && !sender.includes(senderHandle)) metaParts.push(senderHandle);
  if (hiddenProfile) metaParts.push("Скрытый профиль");
  if (viaBot) metaParts.push(`через ${viaBot}`);
  if (postAuthor) metaParts.push(`Автор: ${postAuthor}`);
  const meta = metaParts.join(" · ");
  const headerChildren: HTMLElement[] = [];
  if (isForward && fromId && !hiddenProfile) {
    const avatarNode = avatar("dm", fromId);
    avatarNode.classList.add("msg-ref-avatar");
    headerChildren.push(avatarNode);
  }
  const titleWrap = el("div", { class: "msg-ref-title-wrap" }, [el("div", { class: "msg-ref-title" }, [title])]);
  if (meta) titleWrap.appendChild(el("div", { class: "msg-ref-meta" }, [meta]));
  headerChildren.push(titleWrap);
  const header = el("div", { class: "msg-ref-header" }, headerChildren);
  const text = el("div", { class: "msg-ref-text" }, [refPreview(ref)]);
  let mediaNode: HTMLElement | null = null;
  if (ref.attachment?.kind === "file") {
    const name = String(ref.attachment.name || "файл");
    const badge = fileBadge(name, ref.attachment.mime);
    mediaNode = el(
      "div",
      { class: `msg-ref-media msg-ref-media-${badge.kind}`, style: `--msg-ref-media-hue: ${badge.hue};`, "aria-hidden": "true" },
      [badge.label]
    );
  }
  const hasMedia = Boolean(mediaNode);
  const cls = `msg-ref msg-ref-${kind}${isReply ? " msg-ref-quote" : ""}${hasMedia ? " msg-ref-with-media" : ""}`;
  if (hasMedia && mediaNode) {
    const body = el("div", { class: "msg-ref-body" }, [header, text]);
    return el("div", { class: cls }, [mediaNode, body]);
  }
  return el("div", { class: cls }, [header, text]);
}

export function searchResultPreview(m: ChatMessage): string {
  const text = String(m.text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text;
  const attachment = m.attachment;
  if (attachment?.kind === "file") {
    const name = String(attachment.name || "файл");
    const badge = fileBadge(name, attachment.mime);
    return `${badge.label}: ${name}`;
  }
  if (m.kind === "sys") return "Системное сообщение";
  return "Сообщение";
}

export function trimSearchPreview(text: string, maxLen = 180): string {
  const t = String(text || "").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

export type AlbumItem = {
  idx: number;
  msg: ChatMessage;
  info: FileAttachmentInfo;
};

export function buildMessageMeta(m: ChatMessage): HTMLElement[] {
  const meta: HTMLElement[] = [el("span", { class: "msg-meta-item msg-time" }, [formatTime(m.ts)])];
  if (m.edited) {
    const editedTs = typeof m.edited_ts === "number" && Number.isFinite(m.edited_ts) ? m.edited_ts : null;
    const time = editedTs !== null ? formatTime(editedTs) : "";
    meta.push(
      el(
        "span",
        {
          class: "msg-meta-item msg-edited",
          "aria-label": time ? `Изменено в ${time}` : "Изменено",
          ...(time ? { title: `Изменено: ${time}` } : { title: "Изменено" }),
        },
        ["ред."]
      )
    );
  }
  const status = m.kind === "out" ? statusLabel(m) : "";
  if (status) {
    meta.push(
      el("span", { class: `msg-meta-item msg-status msg-status-${m.status || "delivered"}`, title: statusTitle(m) || undefined }, [status])
    );
  }
  return meta;
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export function renderReactions(m: ChatMessage): HTMLElement | null {
  const raw = m.reactions;
  if (!raw || typeof raw !== "object") return null;
  const countsRaw = (raw as any).counts;
  if (!countsRaw || typeof countsRaw !== "object") return null;
  const entries: Array<{ emoji: string; count: number }> = [];
  for (const [emoji, cnt] of Object.entries(countsRaw as Record<string, unknown>)) {
    const e = String(emoji || "").trim();
    const n = typeof cnt === "number" && Number.isFinite(cnt) ? Math.trunc(cnt) : Math.trunc(Number(cnt) || 0);
    if (!e || n <= 0) continue;
    entries.push({ emoji: e, count: n });
  }
  if (!entries.length) return null;

  entries.sort((a, b) => {
    const ai = QUICK_REACTIONS.indexOf(a.emoji);
    const bi = QUICK_REACTIONS.indexOf(b.emoji);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    if (a.count !== b.count) return b.count - a.count;
    return a.emoji.localeCompare(b.emoji);
  });

  const mine = typeof (raw as any).mine === "string" ? String((raw as any).mine).trim() : null;
  const shown = entries.slice(0, 12);
  const nodes = shown.map(({ emoji, count }) => {
    const active = mine === emoji;
    const label = `${emoji} ${count}`;
    const btn = el(
      "button",
      {
        class: active ? "msg-react is-active" : "msg-react",
        type: "button",
        "data-action": "msg-react",
        "data-emoji": emoji,
        "aria-pressed": active ? "true" : "false",
        title: active ? `Убрать реакцию ${emoji}` : mine ? `Заменить реакцию на ${emoji}` : `Поставить реакцию ${emoji}`,
      },
      [el("span", { class: "msg-react-emoji", "aria-hidden": "true" }, [emoji]), el("span", { class: "msg-react-count" }, [String(count)])]
    ) as HTMLButtonElement;
    btn.setAttribute("aria-label", label);
    return btn;
  });

  const remaining = entries.length - shown.length;
  if (remaining > 0) {
    const more = el(
      "button",
      {
        class: "msg-react msg-react-more",
        type: "button",
        "data-action": "msg-react-more",
        title: "Показать все реакции",
        "aria-label": "Показать все реакции",
      },
      [`+${remaining}`]
    ) as HTMLButtonElement;
    nodes.push(more);
  }

  const add = el(
    "button",
    {
      class: "msg-react msg-react-add",
      type: "button",
      "data-action": "msg-react-add",
      title: mine ? "Изменить реакцию" : "Добавить реакцию",
      "aria-label": mine ? "Изменить реакцию" : "Добавить реакцию",
    },
    ["＋"]
  ) as HTMLButtonElement;
  nodes.push(add);
  return el("div", { class: "msg-reacts" }, nodes);
}

export function getFileAttachmentInfo(state: AppState, m: ChatMessage, opts?: { mobileUi: boolean }): FileAttachmentInfo | null {
  const att = m.attachment;
  if (!att || att.kind !== "file") return null;
  const positiveInt = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };
  const transfer =
    (att.localId ? state.fileTransfers.find((t) => t.localId === att.localId) : null) ||
    (att.fileId ? state.fileTransfers.find((t) => t.id === att.fileId) : null) ||
    null;
  const offer = !transfer && att.fileId ? state.fileOffersIn.find((o) => o.id === att.fileId) ?? null : null;
  const name = String(transfer?.name || offer?.name || att.name || "файл");
  const size = Number(transfer?.size ?? offer?.size ?? att.size ?? 0) || 0;
  const mime = att.mime || transfer?.mime || offer?.mime || null;
  const isImage = isImageLikeFile(name, mime);
  const isVideo = isVideoLikeFile(name, mime);
  const isAudio = isAudioLikeFile(name, mime);
  const activeConversation = getActiveConversationTarget(state) ?? sanitizeTargetRef(state.selected);
  const selectedKey = activeConversation ? conversationKey(activeConversation) : "";
  const messageKey = m.room ? roomKey(String(m.room || "")) : dmKey(String(m.kind === "out" ? (m.to || "") : (m.from || "")));
  const previewOnly = Boolean(selectedKey && messageKey === selectedKey && getConversationHistorySyncState(state, messageKey).previewOnly);
  const base = typeof location !== "undefined" ? location.href : "http://localhost/";
  const shouldTrustRuntimeUrl = (raw: string | null | undefined): boolean => {
    const value = String(raw || "").trim();
    if (!value) return false;
    if (!previewOnly) return true;
    return value.startsWith("blob:");
  };
  const url = shouldTrustRuntimeUrl(transfer?.url)
    ? safeUrl(String(transfer?.url || ""), { base, allowedProtocols: ["http:", "https:", "blob:"] })
    : null;
  const mobileUi = opts?.mobileUi ?? false;
  const hideProgressText = Boolean(transfer && (transfer.status === "uploading" || transfer.status === "downloading"));
  const statusLine = transfer
    ? hideProgressText
      ? ""
      : transferStatus(transfer)
    : offer
      ? mobileUi
        ? "Входящий файл (принять в «Файлы»)"
        : "Входящий файл (принять в «Файлы» / F7)"
      : "";
  const hasProgress = Boolean(transfer && (transfer.status === "uploading" || transfer.status === "downloading"));
  const fileId = att.fileId ? String(att.fileId) : transfer?.id ? String(transfer.id) : offer?.id ? String(offer.id) : null;
  const thumbUrl =
    fileId && shouldTrustRuntimeUrl(state.fileThumbs?.[fileId]?.url)
      ? safeUrl(state.fileThumbs[fileId].url, { base, allowedProtocols: ["http:", "https:", "blob:"] })
      : null;
  const thumbMeta = fileId ? state.fileThumbs?.[fileId] ?? null : null;
  const thumbW = positiveInt(thumbMeta?.w) ?? positiveInt(att.thumbW);
  const thumbH = positiveInt(thumbMeta?.h) ?? positiveInt(att.thumbH);
  const mediaW = positiveInt(thumbMeta?.mediaW) ?? positiveInt(att.mediaW);
  const mediaH = positiveInt(thumbMeta?.mediaH) ?? positiveInt(att.mediaH);
  return {
    name,
    size,
    mime,
    fileId,
    url,
    thumbUrl,
    thumbW,
    thumbH,
    mediaW,
    mediaH,
    transfer,
    offer,
    statusLine,
    isImage,
    isVideo,
    isAudio,
    hasProgress,
  };
}

export function isWebpStickerCandidate(info: FileAttachmentInfo, ratio: number): boolean {
  if (!info.isImage) return false;
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return false;
  if (r < 0.85 || r > 1.18) return false;
  const size = Number(info.size || 0) || 0;
  if (size <= 0 || size > 600_000) return false;
  const name = String(info.name || "").trim().toLowerCase();
  const mime = String(info.mime || "").trim().toLowerCase();
  const isWebp = mime === "image/webp" || name.endsWith(".webp");
  return isWebp;
}

export function isRoundVideoCandidate(info: FileAttachmentInfo, ratio: number): boolean {
  void info;
  void ratio;
  return false;
}

export function extractFileCaptionText(text: unknown): string {
  const caption = String(text ?? "").trim();
  if (!caption || caption.startsWith("[file]")) return "";
  return caption;
}

export function isAlbumCandidate(msg: ChatMessage, info: FileAttachmentInfo | null): info is FileAttachmentInfo {
  if (!info || !(info.isImage || info.isVideo)) return false;
  if (msg.kind === "sys") return false;
  if (info.offer) return false;
  if (!info.url && !info.fileId) return false;
  return true;
}

export function skeletonLine(widthPct: number, cls = "skel-line"): HTMLElement {
  const w = Math.max(8, Math.min(100, Math.round(widthPct)));
  return el("div", { class: cls, style: `width: ${w}%;` }, [""]);
}

export function skeletonMsg(kind: "in" | "out", seed: number): HTMLElement {
  const variants: Array<[number, number, number]> = [
    [76, 42, 22],
    [64, 30, 18],
    [82, 54, 26],
    [58, 36, 20],
    [70, 46, 24],
  ];
  const v = variants[Math.abs(seed) % variants.length] || variants[0];
  const body = el("div", { class: "msg-body" }, [
    skeletonLine(v[0], "skel-line"),
    skeletonLine(v[1], "skel-line"),
    skeletonLine(v[2], "skel-line skel-meta"),
  ]);
  const children: HTMLElement[] = [];
  children.push(el("div", { class: "msg-avatar" }, [el("span", { class: "avatar avatar-skel", "aria-hidden": "true" }, [""])]));
  children.push(body);
  return el("div", { class: `msg msg-${kind} msg-skel`, "aria-hidden": "true" }, children);
}

export const EMOJI_SEGMENT_RE = /\p{Extended_Pictographic}/u;

export function isEmojiOnlyText(text: string): boolean {
  const raw = String(text ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
    let hasEmoji = false;
    for (const part of seg.segment(trimmed)) {
      const chunk = part.segment;
      if (!chunk || !chunk.trim()) continue;
      if (EMOJI_SEGMENT_RE.test(chunk)) {
        hasEmoji = true;
        continue;
      }
      return false;
    }
    return hasEmoji;
  }
  let hasEmoji = false;
  for (const ch of Array.from(trimmed)) {
    if (!ch.trim()) continue;
    if (EMOJI_SEGMENT_RE.test(ch)) {
      hasEmoji = true;
      continue;
    }
    return false;
  }
  return hasEmoji;
}

export function roomLabel(name: string | null | undefined, id: string, handle?: string | null): string {
  const base = name ? `${name} (${id})` : id;
  if (handle) {
    const h = handle.startsWith("@") ? handle : `@${handle}`;
    return `${base} ${h}`;
  }
  return base;
}

export function renderMultilineText(text: string): HTMLElement {
  const cleaned = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n");
  const nodes = lines.map((line) => el("div", { class: "invite-line" }, renderRichText(line)));
  return el("div", { class: "invite-text" }, nodes);
}

export function applyMessageDataset(
  line: HTMLElement,
  msgKind: string,
  meta: {
    boardUi?: boolean;
    mobileUi?: boolean;
    refKind?: "reply" | "forward";
    hasReacts?: boolean;
    hasCaption?: boolean;
    hasText?: boolean;
    emojiOnly?: boolean;
    attachKind?: string;
    fileKind?: string;
    actionKind?: string;
    album?: boolean;
    sticker?: boolean;
    roundVideo?: boolean;
    footerKind?: string;
  }
) {
  const setData = (name: string, value?: string) => {
    if (!value) return;
    line.setAttribute(name, value);
  };
  const setFlag = (name: string, ok?: boolean) => {
    if (!ok) return;
    line.setAttribute(name, "1");
  };
  line.setAttribute("data-msg-kind", String(msgKind || ""));
  setData("data-msg-attach", meta.attachKind);
  setData("data-msg-file", meta.fileKind);
  setData("data-msg-action", meta.actionKind);
  setData("data-msg-footer", meta.footerKind);
  if (meta.refKind) {
    setData("data-msg-ref", meta.refKind);
    setFlag("data-msg-has-ref", true);
  }
  setFlag("data-msg-has-reacts", meta.hasReacts);
  setFlag("data-msg-has-caption", meta.hasCaption);
  setFlag("data-msg-has-text", meta.hasText);
  setFlag("data-msg-emoji-only", meta.emojiOnly);
  setFlag("data-msg-board", meta.boardUi);
  setFlag("data-msg-mobile", meta.mobileUi);
  setFlag("data-msg-album", meta.album);
  setFlag("data-msg-sticker", meta.sticker);
  setFlag("data-msg-round-video", meta.roundVideo);
}

export function messageLine(
  state: AppState,
  m: ChatMessage,
  friendLabels?: Map<string, string>,
  opts?: { mobileUi: boolean; boardUi?: boolean; msgIdx?: number; selectionMode?: boolean; selected?: boolean }
): HTMLElement {
  if (m.kind === "sys") {
    const actionKind = m.attachment?.kind === "action" ? String(m.attachment.payload?.kind || "") : "";
    const line = renderDeferredSysMessage({ message: m });
    applyMessageDataset(line, m.kind, {
      boardUi: Boolean(opts?.boardUi),
      mobileUi: opts?.mobileUi,
      attachKind: m.attachment?.kind,
      actionKind,
      hasText: Boolean(String(m.text || "").trim()),
      emojiOnly: isEmojiOnlyText(m.text || ""),
    });
    return line;
  }
  const fromId = String(m.from || "").trim();
  const selfId = String(state.selfId || "").trim();
  const displayFromId = m.kind === "out" ? selfId : fromId;
  const accentId = displayFromId;
  const resolvedLabel = displayFromId ? resolveUserLabel(state, displayFromId, friendLabels) : "";
  const fromLabel = resolvedLabel && resolvedLabel !== "—" ? resolvedLabel : m.kind === "out" ? "Я" : "—";
  const fromHandle = displayFromId ? resolveUserHandle(state, displayFromId) : "";
  const showHandle = Boolean(fromHandle && !fromLabel.includes(fromHandle));
  const titleLabel = showHandle ? `${fromLabel} ${fromHandle}` : fromLabel;
  const showFrom = true;
  const canOpenProfile = Boolean(displayFromId);
  const boardUi = Boolean(opts?.boardUi);
  const meta = buildMessageMeta(m);
  const metaNode = el("div", { class: "msg-meta" }, meta);
  const bodyChildren: HTMLElement[] = [];
  let fileRowEl: HTMLElement | null = null;
  let selectionBtnPlacedInFileRow = false;
  let visualMediaActions: HTMLElement[] = [];
  let footerKind = "";
  if (showFrom) {
    const attrs = canOpenProfile
      ? {
          class: "msg-from msg-from-btn",
          type: "button",
          "data-action": "user-open",
          "data-user-id": displayFromId,
          title: `Профиль: ${titleLabel}`,
        }
      : { class: "msg-from" };
    const labelChildren = [el("span", { class: "msg-from-name" }, [fromLabel])];
    if (showHandle) labelChildren.push(el("span", { class: "msg-from-handle" }, [fromHandle]));
    const node = canOpenProfile ? el("button", attrs, labelChildren) : el("div", attrs, labelChildren);
    bodyChildren.push(node);
  }
  const ref = m.reply || m.forward;
  const refKind = m.reply ? "reply" : m.forward ? "forward" : undefined;
  if (ref) {
    const kind = m.reply ? "reply" : "forward";
    const refNode = renderMessageRef(state, ref, kind, friendLabels);
    if (refNode) bodyChildren.push(refNode);
  }
  const info = getFileAttachmentInfo(state, m, opts);
  const attachKind = m.attachment?.kind ? String(m.attachment.kind) : "";
  let hasCaption = false;
  let hasText = false;
  let emojiOnly = false;
  let fileKind = "";
  let sticker = false;
  let roundVideo = false;
  if (info) {
    const name = info.name;
    const size = info.size;
    const mime = info.mime;
    const url = info.url;
    const transfer = info.transfer;
    const offer = info.offer;
    const statusLine = info.statusLine;

    const metaEls: HTMLElement[] = [];
    metaEls.push(el("div", { class: "file-meta" }, [`Размер: ${formatBytes(size)}`]));
    if (statusLine) metaEls.push(el("div", { class: "file-meta" }, [statusLine]));
    if (transfer?.acceptedBy?.length) metaEls.push(el("div", { class: "file-meta" }, [`Приняли: ${transfer.acceptedBy.join(", ")}`]));
    if (transfer?.receivedBy?.length) metaEls.push(el("div", { class: "file-meta" }, [`Получили: ${transfer.receivedBy.join(", ")}`]));

    const badge = fileBadge(name, mime);
    const fileSurface = resolveChatFileSurfaceInfo(info);
    const icon = el("span", { class: `file-icon file-icon-${badge.kind}`, "aria-hidden": "true" }, [badge.label]);
    icon.style.setProperty("--file-h", String(badge.hue));
    const fileName = boardUi ? { title: name, display: name } : shortenChatFileNameTelegram(name, 4, 25);
    const fileNameEl = el("div", { class: "file-name", title: fileName.title }, [fileName.display]);
    const mainChildren: HTMLElement[] = [el("div", { class: "file-title" }, [icon, fileNameEl]), renderChatFilePills(info, fileSurface), ...metaEls];
    const isImage = info.isImage;
    const isVideo = info.isVideo;
    const isAudio = info.isAudio;
    const voice = isAudio && isVoiceNoteName(name);
    const videoNote = isVideo && isVideoNoteName(name);
    const isVisualMedia = isImage || isVideo;
    const audioUrl = isAudio ? resolveProgressiveMediaUrl({ fileId: info.fileId, url, name: info.name, size: info.size, mime: info.mime }) : url;
    if (!isVisualMedia && transfer && (transfer.status === "uploading" || transfer.status === "downloading")) {
      const progress = Math.max(0, Math.min(100, Math.round(transfer.progress || 0)));
      const label = transfer.status === "uploading" ? `Загрузка ${progress}%` : `Скачивание ${progress}%`;
      const candy = el("span", { class: "file-progress-candy", "aria-hidden": "true" });
      candy.style.setProperty("--file-progress", `${progress}%`);
      mainChildren.push(
        el(
          "div",
          {
            class: "file-progress",
            role: "progressbar",
            title: label,
            "aria-label": label,
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(progress),
          },
          [candy]
        )
      );
    }

    if (isAudio) {
      if (voice) {
        mainChildren.splice(
          1,
          0,
          renderDeferredVoicePlayer({
            url: audioUrl || null,
            fileId: info.fileId,
            name: info.name,
            size: info.size,
            mime: info.mime,
            msgIdx: typeof opts?.msgIdx === "number" && Number.isFinite(opts.msgIdx) ? Math.trunc(opts.msgIdx) : null,
          })
        );
      } else {
        mainChildren.splice(
          1,
          0,
          renderDeferredVoicePlayer({
            url: audioUrl || null,
            fileId: info.fileId,
            name: info.name,
            size: info.size,
            mime: info.mime,
            msgIdx: typeof opts?.msgIdx === "number" && Number.isFinite(opts.msgIdx) ? Math.trunc(opts.msgIdx) : null,
          })
        );
      }
    }

    const rowChildren: HTMLElement[] = [el("div", { class: "file-main" }, mainChildren)];

    const caption = String(m.text || "").trim();
    const viewerCaption = caption && !caption.startsWith("[file]") ? caption : "";
    const actions = renderChatFileActions(info, fileSurface, {
      caption: viewerCaption,
      msgIdx: opts?.msgIdx,
      visualMedia: isImage || isVideo,
    });
    const hasViewerCaption = Boolean(viewerCaption);
    const ratio = info.fileId ? getCachedMediaAspectRatio(info.fileId) : null;
    const canApplyMediaFlags = Boolean(!boardUi && !hasViewerCaption && ratio !== null);
    const stickerCandidate = canApplyMediaFlags && ratio !== null ? isWebpStickerCandidate(info, ratio) : false;
    const roundVideoCandidate = canApplyMediaFlags && ratio !== null ? isRoundVideoCandidate(info, ratio) : false;
    if (isVisualMedia) {
      const previewOpts = { caption: viewerCaption, msgIdx: opts?.msgIdx, mobileUi: opts?.mobileUi };
      const preview = renderDeferredVisualPreview({ info, opts: previewOpts });
      if (preview) rowChildren.unshift(preview);
    }

    const hasProgress = info.hasProgress;
    const fileRowClass = isVisualMedia
      ? `file-row file-row-chat file-row-image ${fileSurface.rowClass}${isVideo ? " file-row-video" : ""}${videoNote ? " file-row-video-note" : ""}${hasProgress ? " file-row-progress" : ""}`
      : isAudio
        ? `file-row file-row-chat file-row-audio ${fileSurface.rowClass}${voice ? " file-row-voice" : ""}`
        : `file-row file-row-chat ${fileSurface.rowClass}`;
    if (!isVisualMedia) rowChildren.push(el("div", { class: "file-actions" }, actions));
    else visualMediaActions = actions;
    fileRowEl = el("div", { class: fileRowClass }, rowChildren);
    bodyChildren.push(fileRowEl);
    let captionNode: HTMLElement | null = null;
    if (viewerCaption) {
      const emojiOnlyCaption = isEmojiOnlyText(viewerCaption);
      hasCaption = true;
      hasText = true;
      emojiOnly = emojiOnlyCaption;
      const boardUi = Boolean(opts?.boardUi);
      captionNode =
        boardUi && !emojiOnlyCaption
          ? el("div", { class: "msg-text msg-caption msg-text-board" }, [renderBoardPost(viewerCaption)])
          : el("div", { class: `msg-text msg-caption${emojiOnlyCaption ? " msg-emoji-only" : ""}` }, renderRichText(viewerCaption));
    }
    fileKind = isImage ? "image" : isVideo ? "video" : isAudio ? "audio" : "file";

    if (canApplyMediaFlags) {
      sticker = stickerCandidate;
      roundVideo = roundVideoCandidate;
    }
    if (captionNode || !isVisualMedia) {
      bodyChildren.push(renderAttachmentFooterShell({ caption: captionNode, meta: metaNode, media: isVisualMedia }));
      footerKind = "stacked";
    } else {
      bodyChildren.push(metaNode);
      footerKind = "overlay";
    }
  } else {
    const trimmedText = String(m.text || "").trim();
    const textEmojiOnly = isEmojiOnlyText(trimmedText);
    hasText = Boolean(trimmedText);
    emojiOnly = textEmojiOnly;
    const boardUi = Boolean(opts?.boardUi);
    const textNode =
      boardUi && !textEmojiOnly
        ? el("div", { class: "msg-text msg-text-board" }, [renderBoardPost(m.text)])
        : el("div", { class: `msg-text${textEmojiOnly ? " msg-emoji-only" : ""}` }, renderRichText(m.text));
    bodyChildren.push(renderMessageContentShell(textNode, metaNode));
  }
  const reacts = renderReactions(m);
  if (reacts) bodyChildren.push(reacts);
  const selectionMode = Boolean(opts?.selectionMode);
  const selected = Boolean(opts?.selected);
  const selectionIdx = typeof opts?.msgIdx === "number" && Number.isFinite(opts.msgIdx) ? Math.trunc(opts.msgIdx) : null;
  const selectionDisabled =
    m.attachment?.kind === "action" || m.status === "sending" || m.status === "queued" || m.status === "error";
  const selectionBtn =
    selectionMode && selectionIdx !== null && !selectionDisabled
      ? renderMessageSelectionControl({
          selectionIdx,
          selected,
        })
      : null;

  if (selectionBtn && fileRowEl && !Boolean(opts?.boardUi)) {
    if (fileKind === "audio" || fileKind === "file") {
      selectionBtnPlacedInFileRow = true;
      fileRowEl.prepend(selectionBtn);
    } else if (fileKind === "image" || fileKind === "video") {
      selectionBtnPlacedInFileRow = true;
    }
  }
  if (fileRowEl && (fileKind === "image" || fileKind === "video")) {
    const overlayControls = renderMediaOverlayControls({ selectionBtn, actions: visualMediaActions });
    if (overlayControls) fileRowEl.append(overlayControls);
  }

  const lineChildren: HTMLElement[] = [];
  if (displayFromId) {
    const avatarNode = avatar("dm", displayFromId);
    if (canOpenProfile) {
      lineChildren.push(
        el("div", { class: "msg-avatar" }, [
          el(
            "button",
            { class: "msg-avatar-btn", type: "button", "data-action": "user-open", "data-user-id": displayFromId, title: `Профиль: ${titleLabel}` },
            [avatarNode]
          ),
        ])
      );
    } else {
      lineChildren.push(el("div", { class: "msg-avatar" }, [avatarNode]));
    }
  }
  const bodyNode = el("div", { class: "msg-body" }, bodyChildren);
  if (m.kind === "out") {
    lineChildren.push(bodyNode);
    if (selectionBtn && !selectionBtnPlacedInFileRow) lineChildren.push(selectionBtn);
  } else {
    if (selectionBtn && !selectionBtnPlacedInFileRow) lineChildren.push(selectionBtn);
    lineChildren.push(bodyNode);
  }
  const cls = m.attachment ? `msg msg-${m.kind} msg-attach` : `msg msg-${m.kind}`;
  const line = el("div", { class: cls }, lineChildren);
  applyMessageDataset(line, m.kind, {
    boardUi: Boolean(opts?.boardUi),
    mobileUi: opts?.mobileUi,
    refKind,
    hasReacts: Boolean(reacts),
    hasCaption,
    hasText,
    emojiOnly,
    attachKind,
    fileKind,
    sticker,
    roundVideo,
    footerKind,
  });
  const accent = resolveUserAccent(accentId);
  if (accent) {
    line.style.setProperty("--msg-accent", accent);
    line.style.setProperty("--msg-from-color", accent);
  }
  return line;
}
