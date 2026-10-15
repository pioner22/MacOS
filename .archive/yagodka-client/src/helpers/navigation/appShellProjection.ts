import type { AppState } from "../../stores/types";
import { getActiveConversationTarget } from "./mainConversationState";
import { getPageViewTarget } from "./viewState";

export interface AppShellProjection {
  pageTitle: string;
  profileAreaOpen: boolean;
  isSearchPage: boolean;
  isFilesPage: boolean;
  isHelpPage: boolean;
  isGroupCreatePage: boolean;
  isBoardCreatePage: boolean;
  navBackToMain: boolean;
  navBackFromChat: boolean;
  navAction: "nav-back" | "chat-back" | "sidebar-toggle";
  navTitle: string;
  navAria: string;
  navIcon: string;
  showCallActions: boolean;
  showChatMenu: boolean;
  showAuthButton: boolean;
  canLogin: boolean;
  canLogout: boolean;
}

function dmLabel(state: AppState, id: string): string {
  const cleanId = String(id || "").trim();
  if (!cleanId) return "";
  const profile = state.profiles?.[cleanId];
  const displayName = profile?.display_name ? String(profile.display_name).trim() : "";
  const handle = profile?.handle ? String(profile.handle).trim() : "";
  return displayName || (handle ? (handle.startsWith("@") ? handle : `@${handle}`) : cleanId);
}

export function buildAppShellProjection(state: AppState): AppShellProjection {
  const pageTarget = getPageViewTarget(state);
  const activeConversation = getActiveConversationTarget(state);
  let pageTitle = "Чат";
  if (state.page === "search") pageTitle = "Поиск";
  else if (state.page === "help") pageTitle = "Info";
  else if (state.page === "profile") pageTitle = "Профиль";
  else if (state.page === "sessions") pageTitle = "Сессии";
  else if (state.page === "user") {
    const id = pageTarget?.kind === "dm" ? pageTarget.id : "";
    const label = dmLabel(state, id);
    pageTitle = label ? `Контакт: ${label}` : "Контакт";
  } else if (state.page === "group") {
    const id = pageTarget?.kind === "group" ? pageTarget.id : "";
    const room = id ? state.groups?.find((item) => item.id === id) : null;
    pageTitle = `Чат: ${String(room?.name || id || "—")}`;
  } else if (state.page === "board") {
    const id = pageTarget?.kind === "board" ? pageTarget.id : "";
    const board = id ? state.boards?.find((item) => item.id === id) : null;
    pageTitle = `Доска: ${String(board?.name || id || "—")}`;
  } else if (state.page === "files") pageTitle = "Файлы";
  else if (state.page === "group_create") pageTitle = "Создать чат";
  else if (state.page === "board_create") pageTitle = "Создать доску";
  else if (activeConversation) {
    if (activeConversation.kind === "dm") {
      pageTitle = `Чат с: ${dmLabel(state, activeConversation.id) || activeConversation.id}`;
    } else if (activeConversation.kind === "group") {
      const room = (state.groups || []).find((item) => item.id === activeConversation.id);
      pageTitle = `Чат: ${String(room?.name || activeConversation.id)}`;
    } else {
      const board = (state.boards || []).find((item) => item.id === activeConversation.id);
      pageTitle = `Доска: ${String(board?.name || activeConversation.id)}`;
    }
  }

  const profileAreaOpen = state.page === "profile" || state.page === "sessions";
  const navBackToMain = state.page !== "main";
  const navBackFromChat = Boolean(activeConversation);
  const navAction: AppShellProjection["navAction"] = navBackToMain ? "nav-back" : navBackFromChat ? "chat-back" : "sidebar-toggle";
  const navTitle = navBackToMain || navBackFromChat ? "Назад" : "Меню";
  const navAria = navBackToMain ? "Назад" : navBackFromChat ? "Назад к списку" : "Открыть меню";
  const navIcon = navAction === "sidebar-toggle" ? "☰" : "←";
  const showCallActions = Boolean(activeConversation && activeConversation.kind !== "board");
  const showChatMenu = Boolean(activeConversation);
  const showAuthButton = Boolean(!state.authed && state.authMode !== "auto");
  const canLogin = Boolean(state.conn === "connected" && !state.authed);
  const canLogout = Boolean(state.authed);

  return {
    pageTitle,
    profileAreaOpen,
    isSearchPage: state.page === "search",
    isFilesPage: state.page === "files",
    isHelpPage: state.page === "help",
    isGroupCreatePage: state.page === "group_create",
    isBoardCreatePage: state.page === "board_create",
    navBackToMain,
    navBackFromChat,
    navAction,
    navTitle,
    navAria,
    navIcon,
    showCallActions,
    showChatMenu,
    showAuthButton,
    canLogin,
    canLogout,
  };
}
