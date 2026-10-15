import type { ChatMessage } from "../../stores/types";

export function messageSelectionKey(msg: ChatMessage | null | undefined): string | null {
  if (!msg) return null;
  const id = typeof msg.id === "number" && Number.isFinite(msg.id) ? Math.trunc(msg.id) : null;
  if (id && id > 0) return `id:${id}`;
  const localId = typeof msg.localId === "string" ? msg.localId.trim() : "";
  if (localId) return `local:${localId}`;
  return null;
}
