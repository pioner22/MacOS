import type { ChatMessage } from "../../stores/types";

export function messageStableKey(m: ChatMessage): string {
  if (m.id !== undefined && m.id !== null) return `id:${m.id}`;
  const localId = typeof m.localId === "string" ? m.localId.trim() : "";
  if (localId) return `local:${localId}`;
  return `ts:${m.ts}|from:${m.from}|room:${m.room ?? ""}|to:${m.to ?? ""}|text:${m.text}`;
}

function sortTs(m: ChatMessage): number {
  const ts = Number(m.ts);
  return Number.isFinite(ts) ? ts : 0;
}

function sortId(m: ChatMessage): number {
  const id = m.id;
  const n = typeof id === "number" ? id : id == null ? 0 : Number(id);
  return Number.isFinite(n) ? n : 0;
}

function serverId(m: ChatMessage): number | null {
  const raw = m?.id;
  const n = typeof raw === "number" ? raw : raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function mergeLocalFields(prev: ChatMessage, next: ChatMessage): ChatMessage {
  const reply = next.reply !== undefined ? next.reply : prev.reply;
  const forward = next.forward !== undefined ? next.forward : prev.forward;
  const localId = next.localId !== undefined ? next.localId : prev.localId;
  return {
    ...next,
    ...(localId !== undefined ? { localId } : {}),
    ...(reply !== undefined ? { reply } : {}),
    ...(forward !== undefined ? { forward } : {}),
  };
}

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of prev) map.set(messageStableKey(m), m);
  for (const m of incoming) {
    const key = messageStableKey(m);
    const existing = map.get(key);
    map.set(key, existing ? mergeLocalFields(existing, m) : m);
  }
  const merged = Array.from(map.values());
  merged.sort((a, b) => {
    const as = serverId(a);
    const bs = serverId(b);
    if (as !== null && bs !== null) return as - bs;
    const at = sortTs(a);
    const bt = sortTs(b);
    if (at !== bt) return at - bt;
    const ai = sortId(a);
    const bi = sortId(b);
    if (ai !== bi) return ai - bi;
    const al = typeof a.localId === "string" ? a.localId : "";
    const bl = typeof b.localId === "string" ? b.localId : "";
    if (al !== bl) return al.localeCompare(bl);
    return 0;
  });
  return merged;
}

export function prependedCount(prev: ChatMessage[], next: ChatMessage[]): number | null {
  if (!Array.isArray(prev) || prev.length === 0) return 0;
  if (!Array.isArray(next) || next.length === 0) return null;
  const anchorKey = messageStableKey(prev[0]);
  for (let idx = 0; idx < next.length; idx += 1) {
    if (messageStableKey(next[idx]) === anchorKey) return idx;
  }
  return null;
}
