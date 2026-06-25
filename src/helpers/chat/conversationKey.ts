import type { TargetRef } from "../../stores/types";

export function dmKey(peerId: string): string {
  return `dm:${peerId}`;
}

export function roomKey(roomId: string): string {
  return `room:${roomId}`;
}

export function conversationKey(target: TargetRef): string {
  return target.kind === "dm" ? dmKey(target.id) : roomKey(target.id);
}

