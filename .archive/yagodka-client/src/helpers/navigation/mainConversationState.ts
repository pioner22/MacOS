import { conversationKey } from "../chat/conversationKey";
import type { AppState, TargetRef } from "../../stores/types";
import { sanitizeTargetRef } from "./viewState";

type MainConversationSurfaceState = Pick<AppState, "page" | "modal" | "selected">;

function cleanId(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function isMainPage(page: unknown): boolean {
  return page === undefined || page === null || page === "main";
}

function isConversationViewportModal(modal: AppState["modal"] | null | undefined): boolean {
  if (!modal) return true;
  return modal.kind === "context_menu" || modal.kind === "file_viewer" || modal.kind === "call";
}

export function isMainConversationSurface(state: Pick<AppState, "page" | "modal">): boolean {
  return Boolean(isMainPage(state.page) && !state.modal);
}

export function isConversationViewportSurface(state: Pick<AppState, "page" | "modal">): boolean {
  return Boolean(isMainPage(state.page) && isConversationViewportModal(state.modal));
}

export function getActiveConversationTarget(state: MainConversationSurfaceState): TargetRef | null {
  if (!isMainConversationSurface(state)) return null;
  return sanitizeTargetRef(state.selected);
}

export function getConversationViewportTarget(state: MainConversationSurfaceState): TargetRef | null {
  if (!isConversationViewportSurface(state)) return null;
  return sanitizeTargetRef(state.selected);
}

export function getActiveConversationKey(state: MainConversationSurfaceState): string {
  const target = getActiveConversationTarget(state);
  return target ? conversationKey(target) : "";
}

export function getConversationViewportKey(state: MainConversationSurfaceState): string {
  const target = getConversationViewportTarget(state);
  return target ? conversationKey(target) : "";
}

export function hasActiveConversationSelection(state: MainConversationSurfaceState): boolean {
  return Boolean(getActiveConversationTarget(state));
}

export function hasConversationViewportSelection(state: MainConversationSurfaceState): boolean {
  return Boolean(getConversationViewportTarget(state));
}

export function isActiveConversationTarget(
  state: MainConversationSurfaceState,
  target: TargetRef | null | undefined
): boolean {
  const active = getActiveConversationTarget(state);
  const next = sanitizeTargetRef(target);
  return Boolean(active && next && active.kind === next.kind && active.id === next.id);
}

export function isViewingDmPeer(state: MainConversationSurfaceState, peerId: string): boolean {
  const active = getActiveConversationTarget(state);
  const id = cleanId(peerId);
  return Boolean(active && active.kind === "dm" && active.id === id);
}

export function isViewingRoomId(state: MainConversationSurfaceState, roomId: string): boolean {
  const active = getActiveConversationTarget(state);
  const id = cleanId(roomId);
  return Boolean(active && active.kind !== "dm" && active.id === id);
}
