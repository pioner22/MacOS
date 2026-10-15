import { fileBadge } from "../../../helpers/files/fileBadge";
import { getConversationViewportKey } from "../../../helpers/navigation/mainConversationState";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, MessageHelperDraft } from "../../../stores/types";

export type ComposerHelperDraftResolution = { kind: "reply" | "forward"; key: string; draft: MessageHelperDraft } | null;

export interface ComposerHelperDraftFeatureDeps {
  store: Store<AppState>;
}

export interface ComposerHelperDraftFeature {
  clearComposerHelper: () => void;
  buildHelperDraft: (st: AppState, key: string, msg: ChatMessage) => MessageHelperDraft | null;
  helperDraftToRef: (draft: MessageHelperDraft | null) => ChatMessage["reply"];
  resolveComposerHelperDraft: (st: AppState) => ComposerHelperDraftResolution;
}

function helperPreviewFromMessage(msg: ChatMessage): string {
  const rawText = String(msg.text || "")
    .replace(/\s+/g, " ")
    .trim();
  const text = rawText && !rawText.startsWith("[file]") ? rawText : "";
  if (text) return text;
  const attachment = msg.attachment;
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

export function createComposerHelperDraftFeature(deps: ComposerHelperDraftFeatureDeps): ComposerHelperDraftFeature {
  const { store } = deps;

  const clearComposerHelper = () => {
    const st = store.get();
    if (!st.replyDraft && !st.forwardDraft) return;
    store.set({ replyDraft: null, forwardDraft: null });
  };

  const buildHelperDraft = (_st: AppState, key: string, msg: ChatMessage): MessageHelperDraft | null => {
    const k = String(key || "").trim();
    if (!k) return null;
    if (!msg || msg.kind === "sys") return null;
    const preview = helperPreviewFromMessage(msg);
    const from = String(msg.from || "").trim();
    const rawText = String(msg.text || "").trim();
    const text = rawText && !rawText.startsWith("[file]") ? rawText : "";
    const attachment = msg.attachment ?? null;
    const id = typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
    const localId = typeof msg.localId === "string" && msg.localId.trim() ? msg.localId.trim() : null;
    return {
      key: k,
      preview,
      ...(from ? { from } : {}),
      ...(text ? { text } : {}),
      ...(attachment ? { attachment } : {}),
      ...(id !== null ? { id } : {}),
      ...(localId ? { localId } : {}),
    };
  };

  const helperDraftToRef = (draft: MessageHelperDraft | null): ChatMessage["reply"] => {
    if (!draft) return null;
    const { key, preview, ...rest } = draft;
    return rest;
  };

  const resolveComposerHelperDraft = (st: AppState): ComposerHelperDraftResolution => {
    const key = getConversationViewportKey(st);
    if (!key) return null;
    const editing = Boolean(st.editing && st.editing.key === key);
    if (editing) return null;
    const replyDraft = st.replyDraft && st.replyDraft.key === key ? st.replyDraft : null;
    if (replyDraft) return { kind: "reply", key, draft: replyDraft };
    const forwardDraft = st.forwardDraft && st.forwardDraft.key === key ? st.forwardDraft : null;
    if (forwardDraft) return { kind: "forward", key, draft: forwardDraft };
    return null;
  };

  return {
    clearComposerHelper,
    buildHelperDraft,
    helperDraftToRef,
    resolveComposerHelperDraft,
  };
}
