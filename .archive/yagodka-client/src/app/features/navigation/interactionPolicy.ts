import type { AppState } from "../../../stores/types";
import { hasActiveConversationSelection } from "../../../helpers/navigation/mainConversationState";
import { getRightPanelTarget } from "../../../helpers/navigation/viewState";
import { resolveOverlayBackdropAction } from "./modalSurface";

export type InteractionAction =
  | "none"
  | "consume"
  | "close_modal"
  | "close_chat_search"
  | "close_sidebar"
  | "close_right_panel"
  | "set_page_main"
  | "clear_selected_target";

type BaseInteractionState = Pick<AppState, "modal" | "chatSearchOpen" | "rightPanel" | "page" | "selected">;

export interface EscapeInteractionState extends BaseInteractionState {
  mobileSidebarOpen: boolean;
  floatingSidebarOpen: boolean;
}

export function resolveEscapeInteractionAction(state: EscapeInteractionState): InteractionAction {
  if (state.modal) return "close_modal";
  if (state.chatSearchOpen) return "close_chat_search";
  if (state.mobileSidebarOpen || state.floatingSidebarOpen) return "close_sidebar";
  if (getRightPanelTarget(state)) return "close_right_panel";
  if (state.page !== "main") return "set_page_main";
  return "none";
}

export function resolveOverlayInteractionAction(
  modal: AppState["modal"] | null | undefined,
  nowMs = Date.now()
): InteractionAction {
  const backdropAction = resolveOverlayBackdropAction(modal, nowMs);
  if (backdropAction === "consume") return "consume";
  if (backdropAction === "close") return "close_modal";
  return "none";
}

export function resolveHeaderNavBackAction(state: Pick<AppState, "modal" | "page">): InteractionAction {
  if (state.modal) return "none";
  if (state.page !== "main") return "set_page_main";
  return "none";
}

export function resolveHeaderChatBackAction(state: Pick<AppState, "modal" | "page" | "selected">): InteractionAction {
  if (hasActiveConversationSelection(state)) return "clear_selected_target";
  return "none";
}
