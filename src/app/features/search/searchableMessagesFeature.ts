import { conversationKey } from "../../../helpers/chat/conversationKey";
import { fileBadge } from "../../../helpers/files/fileBadge";
import { classifyAudioAttachment } from "../../../helpers/files/audioAttachmentKind";
import type { ChatSearchFlags } from "../../../helpers/chat/chatSearch";
import type { AppState, ChatMessage } from "../../../stores/types";

export function searchableMessagesForSelected(st: AppState) {
  if (!st.selected) return [];
  const key = conversationKey(st.selected);
  const msgs = st.conversations[key] || [];
  const linkRe = /(https?:\/\/|www\.)\S+/i;

  const senderTokensForMessage = (msg: ChatMessage): string => {
    const senderId = String(msg?.from || "").trim();
    if (!senderId) return "";
    const friend = st.friends.find((f) => f.id === senderId);
    const profile = st.profiles?.[senderId];
    const displayName = String(friend?.display_name || profile?.display_name || "").trim();
    const handleRaw = String(friend?.handle || profile?.handle || "").trim();
    const handle = handleRaw.startsWith("@") ? handleRaw : handleRaw ? `@${handleRaw}` : "";
    return [senderId, displayName, handleRaw, handle].filter(Boolean).join(" ");
  };

  const flagsForMessage = (msg: ChatMessage): ChatSearchFlags => {
    const flags: ChatSearchFlags = {};
    const attachment = msg?.attachment;
    if (attachment?.kind === "file") {
      const badge = fileBadge(attachment.name, attachment.mime);
      if (badge.kind === "image" || badge.kind === "video") {
        flags.media = true;
      } else if (badge.kind === "audio") {
        const audioKind = classifyAudioAttachment(attachment.name, attachment.mime);
        flags[audioKind] = true;
      } else {
        flags.files = true;
      }
    }
    const text = String(msg?.text || "");
    if (text && linkRe.test(text)) flags.links = true;
    return flags;
  };

  return msgs.map((m) => ({
    text: m.text,
    attachmentName: m.attachment?.kind === "file" ? m.attachment.name : null,
    senderTokens: senderTokensForMessage(m),
    flags: flagsForMessage(m),
  }));
}
