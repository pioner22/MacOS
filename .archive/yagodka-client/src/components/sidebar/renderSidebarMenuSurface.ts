import { el } from "../../helpers/dom/el";
import { buildAppShellProjection } from "../../helpers/navigation/appShellProjection";
import type { AppState, PageKind } from "../../stores/types";
import { roomRow } from "./renderSidebarHelpers";

export interface RenderSidebarMenuCtx {
  target?: HTMLElement;
  state: AppState;
  mobileUi: boolean;
  onSetPage: (page: PageKind) => void;
  onCreateGroup: () => void;
  onCreateBoard: () => void;
  onAuthOpen: () => void;
  onAuthLogout: () => void;
  mountDesktop: (children: HTMLElement[]) => void;
}

function toggleClass(node: HTMLElement | null | undefined, cls: string, enabled: boolean) {
  if (!node) return;
  const list = node.classList;
  if (list && typeof list.toggle === "function") {
    list.toggle(cls, enabled);
    return;
  }
  const raw = String((node as any).className || "");
  const parts = raw.split(/\s+/).filter(Boolean);
  const has = parts.includes(cls);
  if (enabled && !has) parts.push(cls);
  if (!enabled && has) parts.splice(parts.indexOf(cls), 1);
  (node as any).className = parts.join(" ");
}

function markMenuRow(row: HTMLElement, icon: string): HTMLElement {
  row.classList.add("sidebar-menu-row");
  row.dataset.menuIcon = icon;
  return row;
}

export function renderSidebarMenuSurface(ctx: RenderSidebarMenuCtx) {
  const { state, mobileUi, onSetPage, onCreateGroup, onCreateBoard, onAuthOpen, onAuthLogout, mountDesktop } = ctx;
  const shell = buildAppShellProjection(state);

  const profileRow = markMenuRow(roomRow(" ", "Профиль и настройки", shell.profileAreaOpen, () => onSetPage("profile"), undefined, {
    sub: "Ваш ID, имя, фото, оформление",
    time: null,
    hasDraft: false,
  }), "profile");
  toggleClass(profileRow, "row-settings", true);
  profileRow.setAttribute("title", "Настройки профиля и интерфейса");

  const searchRow = markMenuRow(roomRow(" ", "Поиск по истории", shell.isSearchPage, () => onSetPage("search"), undefined, {
    sub: "Сообщения, люди, медиа",
    time: null,
    hasDraft: false,
  }), "search");
  searchRow.setAttribute("title", "Глобальный поиск");

  const filesRow = markMenuRow(roomRow(" ", "Медиа и файлы", shell.isFilesPage, () => onSetPage("files"), undefined, {
    sub: "Передачи, загрузки, вложения",
    time: null,
    hasDraft: false,
  }), "files");
  filesRow.setAttribute("title", "Медиа, файлы и загрузки");
  const navRows: HTMLElement[] = [profileRow, searchRow, filesRow];

  const createGroupRow = markMenuRow(roomRow(" ", "Новая группа", shell.isGroupCreatePage, () => onCreateGroup(), undefined, {
    sub: "Чат с участниками",
    time: null,
    hasDraft: false,
  }), "create-group");
  createGroupRow.setAttribute("title", "Создать новую группу");

  const createBoardRow = markMenuRow(roomRow(" ", "Новый канал", shell.isBoardCreatePage, () => onCreateBoard(), undefined, {
    sub: "Новости и объявления",
    time: null,
    hasDraft: false,
  }), "create-board");
  createBoardRow.setAttribute("title", "Создать новый канал");
  const createRows: HTMLElement[] = [createGroupRow, createBoardRow];

  const infoRow = markMenuRow(roomRow(" ", "Справка и версия", shell.isHelpPage, () => onSetPage("help"), undefined, {
    sub: mobileUi ? "Версии и изменения" : "Помощь, версии и изменения",
    time: null,
    hasDraft: false,
  }), "help");
  infoRow.setAttribute("title", mobileUi ? "Справка и журнал обновлений" : "Подсказки по клавишам и журнал обновлений");

  const accountRows: HTMLElement[] = [];
  if (shell.canLogin) {
    const loginRow = markMenuRow(roomRow(" ", "Войти", false, () => onAuthOpen(), undefined, {
      sub: "Вход или регистрация",
      time: null,
      hasDraft: false,
    }), "login");
    loginRow.setAttribute("title", "Войти или зарегистрироваться");
    accountRows.push(loginRow);
  } else if (shell.canLogout) {
    const logoutRow = markMenuRow(roomRow(" ", mobileUi ? "Выход" : "Выход (F10)", false, () => onAuthLogout(), undefined, {
      sub: "Завершить сессию",
      time: null,
      hasDraft: false,
    }), "logout");
    logoutRow.setAttribute("title", mobileUi ? "Выйти из аккаунта" : "Выйти из аккаунта (F10)");
    accountRows.push(logoutRow);
  }

  mountDesktop([
    el("div", { class: "pane-section" }, ["Навигация"]),
    ...navRows,
    ...(accountRows.length ? [el("div", { class: "pane-section" }, ["Аккаунт"]), ...accountRows] : []),
    el("div", { class: "pane-section" }, ["Создание"]),
    ...createRows,
    el("div", { class: "pane-section" }, ["Справка"]),
    infoRow,
  ]);
}
