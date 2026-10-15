import type { AppState, TargetRef } from "../../../stores/types";

export function formatSearchHistoryTargetLabel(st: AppState, target: TargetRef): string {
  const id = String(target?.id || "").trim();
  if (!id) return "";
  if (target.kind === "dm") {
    const friend = st.friends.find((f) => f.id === id);
    const profile = st.profiles?.[id];
    const displayName = String(friend?.display_name || profile?.display_name || "").trim();
    const handleRaw = String(friend?.handle || profile?.handle || "").trim();
    const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
    if (displayName) return displayName;
    if (handle) return handle;
    return `ID: ${id}`;
  }
  const entry = target.kind === "group" ? st.groups.find((g) => g.id === id) : st.boards.find((b) => b.id === id);
  const name = String(entry?.name || "").trim();
  return name ? `${name} (#${id})` : `#${id}`;
}

export function formatSearchHistorySenderLabel(st: AppState, senderId: string): string {
  const id = String(senderId || "").trim();
  if (!id) return "";
  if (String(st.selfId || "") === id) return "Я";
  const friend = st.friends.find((f) => f.id === id);
  const profile = st.profiles?.[id];
  const displayName = String(friend?.display_name || profile?.display_name || "").trim();
  const handleRaw = String(friend?.handle || profile?.handle || "").trim();
  const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
  if (displayName) return displayName;
  if (handle) return handle;
  return id;
}
