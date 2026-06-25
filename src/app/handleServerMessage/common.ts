import type {
  ActionModalPayload,
  AppState,
  ChatAttachment,
  ChatMessage,
  ChatMessageRef,
  MessageReactions,
} from "../../stores/types";
import { getOrCreateInstanceId } from "../../helpers/device/clientTags";
import { playNotificationSound } from "../../helpers/notify/notifySound";
import { getTabNotifier } from "../../helpers/notify/tabNotifierLazy";
import { nowTs } from "../../helpers/time";

export const HISTORY_PAGE_SIZE = 200;
export const tabNotifier = getTabNotifier(getOrCreateInstanceId);
export const lastReadSavedAt = new Map<string, number>();
export const prefsBootstrapDoneForUser = new Set<string>();

export function upsertConversationByLocalId(state: any, key: string, msg: ChatMessage, localId: string): any {
  const convMap = state?.conversations && typeof state.conversations === "object" ? state.conversations : {};
  const prev = Array.isArray(convMap[key]) ? convMap[key] : [];
  if (prev.some((m: any) => String(m?.localId ?? "") === localId)) return state;
  return { ...state, conversations: { ...convMap, [key]: [...prev, msg] } };
}

export function updateConversationByLocalId(
  state: any,
  key: string,
  localId: string,
  update: (msg: ChatMessage) => ChatMessage
): any {
  const convMap = state?.conversations && typeof state.conversations === "object" ? state.conversations : {};
  const prev = Array.isArray(convMap[key]) ? convMap[key] : [];
  const idx = prev.findIndex((m: any) => String(m?.localId ?? "") === localId);
  if (idx < 0) return state;
  const next = [...prev];
  next[idx] = update(next[idx] as ChatMessage);
  return { ...state, conversations: { ...convMap, [key]: next } };
}

export function sysActionMessage(peer: string, text: string, payload: ActionModalPayload, localId: string): ChatMessage {
  return {
    ts: nowTs(),
    from: peer,
    text,
    kind: "sys",
    localId,
    id: null,
    attachment: { kind: "action", payload },
  };
}

export function oldestLoadedId(msgs: ChatMessage[]): number | null {
  let min: number | null = null;
  for (const m of msgs) {
    const id = m.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    if (min === null || id < min) min = id;
  }
  return min;
}

export function updateLastOutgoing(state: AppState, key: string, update: (msg: ChatMessage) => ChatMessage): AppState {
  const conv = state.conversations[key];
  if (!conv || conv.length === 0) return state;
  // ACK от сервера приходит в порядке отправки, поэтому обновляем "самое старое" исходящее без id,
  // иначе при быстрой отправке нескольких сообщений можно перепутать msg_id.
  for (let i = 0; i < conv.length; i += 1) {
    const msg = conv[i];
    if (msg.kind !== "out") continue;
    if (msg.id !== undefined && msg.id !== null) continue;
    const next = [...conv];
    next[i] = update(msg);
    return { ...state, conversations: { ...state.conversations, [key]: next } };
  }
  return state;
}

export function updateFirstPendingOutgoing(
  state: AppState,
  key: string,
  update: (msg: ChatMessage) => ChatMessage
): { state: AppState; localId: string | null } {
  const conv = state.conversations[key];
  if (!conv || conv.length === 0) return { state, localId: null };
  for (let i = 0; i < conv.length; i += 1) {
    const msg = conv[i];
    if (msg.kind !== "out") continue;
    if (msg.id !== undefined && msg.id !== null) continue;
    const next = [...conv];
    next[i] = update(msg);
    const lid = typeof msg.localId === "string" && msg.localId.trim() ? msg.localId.trim() : null;
    return { state: { ...state, conversations: { ...state.conversations, [key]: next } }, localId: lid };
  }
  return { state, localId: null };
}

export function humanizeError(raw: string): string {
  const code = String(raw ?? "").trim();
  if (!code) return "ошибка";
  const map: Record<string, string> = {
    not_in_group: "Вы не участник этого чата (примите приглашение или попросите добавить вас)",
    group_post_forbidden: "В этом чате вам запрещено писать",
    board_post_forbidden: "На доске писать может только владелец",
    board_check_failed: "Не удалось проверить права на доску",
    group_check_failed: "Не удалось проверить доступ к чату",
    broadcast_disabled: "Рассылка всем отключена",
    message_too_long: "Слишком длинное сообщение",
    bad_text: "Некорректный текст сообщения",
    bad_recipient: "Некорректный получатель",
    rate_limited: "Слишком часто. Попробуйте позже",
  };
  return map[code] ?? code;
}

const ACTION_STRING_MAX = 1600;

function actionString(value: unknown, max = ACTION_STRING_MAX): string {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function actionStringOrNull(value: unknown, max = ACTION_STRING_MAX): string | null {
  const text = actionString(value, max);
  return text ? text : null;
}

function parseActionPayload(raw: any): ActionModalPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = actionString((raw as any).kind, 48);
  if (kind === "auth_in") {
    const peer = actionString((raw as any).peer, 128);
    if (!peer) return null;
    return { kind, peer, note: actionStringOrNull((raw as any).note, 400) };
  }
  if (kind === "auth_out") {
    const peer = actionString((raw as any).peer, 128);
    return peer ? { kind, peer } : null;
  }
  if (kind === "group_invite") {
    const groupId = actionString((raw as any).groupId ?? (raw as any).group_id, 128);
    const from = actionString((raw as any).from, 128);
    if (!groupId || !from) return null;
    return {
      kind,
      groupId,
      from,
      name: actionStringOrNull((raw as any).name, 180),
      handle: actionStringOrNull((raw as any).handle, 180),
      description: actionStringOrNull((raw as any).description, 1400),
      rules: actionStringOrNull((raw as any).rules, 1400),
    };
  }
  if (kind === "group_join_request") {
    const groupId = actionString((raw as any).groupId ?? (raw as any).group_id, 128);
    const from = actionString((raw as any).from ?? (raw as any).peer, 128);
    if (!groupId || !from) return null;
    return {
      kind,
      groupId,
      from,
      name: actionStringOrNull((raw as any).name, 180),
      handle: actionStringOrNull((raw as any).handle, 180),
    };
  }
  if (kind === "board_invite") {
    const boardId = actionString((raw as any).boardId ?? (raw as any).board_id, 128);
    const from = actionString((raw as any).from, 128);
    if (!boardId || !from) return null;
    return {
      kind,
      boardId,
      from,
      name: actionStringOrNull((raw as any).name, 180),
      handle: actionStringOrNull((raw as any).handle, 180),
      description: actionStringOrNull((raw as any).description, 1400),
      rules: actionStringOrNull((raw as any).rules, 1400),
    };
  }
  if (kind === "file_offer") {
    const fileId = actionString((raw as any).fileId ?? (raw as any).file_id, 180);
    const from = actionString((raw as any).from, 128);
    if (!fileId || !from) return null;
    const sizeRaw = Number((raw as any).size ?? 0);
    return {
      kind,
      fileId,
      from,
      name: actionString((raw as any).name, 240) || "файл",
      size: Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.trunc(sizeRaw) : 0,
      room: actionStringOrNull((raw as any).room, 128),
    };
  }
  return null;
}

export function parseAttachment(raw: any): ChatAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = String((raw as any).kind ?? "");
  if (kind === "action") {
    const payload = parseActionPayload((raw as any).payload);
    return payload ? { kind: "action", payload } : null;
  }
  if (kind !== "file") return null;
  const fileIdRaw = (raw as any).file_id ?? (raw as any).fileId ?? (raw as any).id ?? null;
  const fileIdText = fileIdRaw === null || fileIdRaw === undefined ? "" : String(fileIdRaw).trim();
  const fileId = fileIdText ? fileIdText : null;
  const name = String((raw as any).name ?? "файл");
  const size = Number((raw as any).size ?? 0) || 0;
  const mimeRaw = (raw as any).mime;
  const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? String(mimeRaw) : null;
  const positiveInt = (...values: unknown[]): number | null => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }
    return null;
  };
  const positiveFloat = (...values: unknown[]): number | null => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };
  const thumbW = positiveInt((raw as any).thumb_w, (raw as any).thumbW, (raw as any).w);
  const thumbH = positiveInt((raw as any).thumb_h, (raw as any).thumbH, (raw as any).h);
  const mediaW = positiveInt((raw as any).media_w, (raw as any).mediaW);
  const mediaH = positiveInt((raw as any).media_h, (raw as any).mediaH);
  const durationS = positiveFloat((raw as any).duration_s, (raw as any).durationS);
  return {
    kind: "file",
    fileId,
    name,
    size,
    mime,
    ...(thumbW ? { thumbW } : {}),
    ...(thumbH ? { thumbH } : {}),
    ...(mediaW ? { mediaW } : {}),
    ...(mediaH ? { mediaH } : {}),
    ...(durationS ? { durationS } : {}),
  };
}

export function parseMessageRef(raw: any): ChatMessageRef | null {
  if (!raw || typeof raw !== "object") return null;
  const ref: ChatMessageRef = {};
  const idRaw = (raw as any).id ?? (raw as any).msg_id ?? null;
  const id = typeof idRaw === "number" && Number.isFinite(idRaw) ? Math.trunc(idRaw) : Math.trunc(Number(idRaw) || 0);
  if (id > 0) ref.id = id;
  const localIdRaw = (raw as any).localId ?? (raw as any).local_id ?? null;
  if (typeof localIdRaw === "string" && localIdRaw.trim()) ref.localId = localIdRaw.trim();
  const fromRaw = (raw as any).from;
  if (typeof fromRaw === "string" && fromRaw.trim()) ref.from = fromRaw.trim();
  const textRaw = (raw as any).text;
  if (typeof textRaw === "string" && textRaw.trim()) ref.text = textRaw;
  const attachment = parseAttachment((raw as any).attachment);
  if (attachment) ref.attachment = attachment;
  const viaBotRaw = (raw as any).via_bot ?? (raw as any).viaBot ?? null;
  if (typeof viaBotRaw === "string" && viaBotRaw.trim()) ref.via_bot = viaBotRaw.trim();
  const postAuthorRaw = (raw as any).post_author ?? (raw as any).postAuthor ?? null;
  if (typeof postAuthorRaw === "string" && postAuthorRaw.trim()) ref.post_author = postAuthorRaw.trim();
  const hiddenRaw = (raw as any).hidden_profile ?? (raw as any).hiddenProfile ?? null;
  const hidden_profile =
    hiddenRaw === true || hiddenRaw === 1 || hiddenRaw === "1" || hiddenRaw === "true" || hiddenRaw === "yes";
  if (hidden_profile) ref.hidden_profile = true;
  return Object.keys(ref).length ? ref : null;
}

export function parseReactions(raw: any): MessageReactions | null {
  if (!raw || typeof raw !== "object") return null;
  const countsRaw = (raw as any).counts;
  if (!countsRaw || typeof countsRaw !== "object") return null;
  const counts: Record<string, number> = {};
  for (const [emoji, cnt] of Object.entries(countsRaw as Record<string, unknown>)) {
    const e = String(emoji || "").trim();
    const n = typeof cnt === "number" && Number.isFinite(cnt) ? Math.trunc(cnt) : Math.trunc(Number(cnt) || 0);
    if (!e || n <= 0) continue;
    counts[e] = n;
  }
  const mineRaw = (raw as any).mine;
  const mine = typeof mineRaw === "string" && mineRaw.trim() ? String(mineRaw) : null;
  if (!Object.keys(counts).length && mine === null) return null;
  return { counts, mine };
}

export function isDocHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState !== "visible";
  } catch {
    return false;
  }
}

export function notifyPermission(): "default" | "granted" | "denied" {
  try {
    return (Notification?.permission ?? "default") as "default" | "granted" | "denied";
  } catch {
    return "default";
  }
}

export function showInAppNotification(state: AppState, notifKey: string, title: string, body: string, tag: string): void {
  if (!state.notifyInAppEnabled) return;
  if (notifyPermission() !== "granted") return;
  if (!tabNotifier.shouldShowSystemNotification(notifKey)) return;
  try {
    // We control notification sound ourselves (see notifySound toggle). Ask the OS to keep it silent
    // to avoid double sounds / inconsistent platform behavior.
    new Notification(title, { body, tag, silent: true });
  } catch {
    // ignore
  }
}

export function maybePlaySound(
  state: AppState,
  kind: Parameters<typeof playNotificationSound>[0],
  notifKey: string,
  shouldPlay: boolean
): void {
  if (!shouldPlay) return;
  if (!state.notifySoundEnabled) return;
  if (!tabNotifier.shouldPlaySound(notifKey)) return;
  void playNotificationSound(kind).catch(() => {});
}
