import type { Layout } from "../components/layout/types";
import type {
  ActionModalPayload,
  AppState,
  MobileSidebarTab,
  PageKind,
  SearchResultEntry,
  TargetRef,
  ThemeMode,
} from "../stores/types";
import { APP_MSG_MAX_LEN } from "../config/app";
import { renderHeader } from "../components/header/renderHeader";
import { renderSidebar } from "../components/sidebar/renderSidebar";
import { renderChat } from "../components/chat/renderChat";
import { renderFooter } from "../components/footer/renderFooter";
import { renderModal } from "../components/modals/renderModal";
import { renderAuthModal } from "../components/modals/renderAuthModal";
import { renderToast } from "../components/toast/renderToast";
import { el } from "../helpers/dom/el";
import { resetChatHistoryViewportRuntime } from "../helpers/chat/historyViewportRuntime";
import { preserveAuthModalInputs } from "../helpers/auth/preserveAuthModalInputs";
import { focusElement } from "../helpers/ui/focus";
import { scheduleChromeColorSync } from "../helpers/ui/chromeColors";
import { isIOS } from "../helpers/ui/iosInputAssistant";
import { isMobileLikeUi } from "../helpers/ui/mobileLike";
import { maxBoardScheduleDelayMs } from "../helpers/boards/boardSchedule";
import {
  getConversationViewportKey,
  getConversationViewportTarget,
  hasConversationViewportSelection,
} from "../helpers/navigation/mainConversationState";
import { applyRightPanelViewState, getRightPanelTitle, shouldShowRightPanel } from "../helpers/navigation/rightPanelState";
import { getRightPanelTarget } from "../helpers/navigation/viewState";
import { createLazyCallModalRuntime } from "./bootstrap/lazyCallModalRuntime";
import { recoverFromLazyImportError } from "./bootstrap/lazyImportRecovery";
import { applyOverlaySurface, resolveModalPresentation } from "./features/navigation/modalSurface";
import {
  contextMenuPayloadKey,
  formatDatetimeLocal,
  formatSenderLabel,
  forwardModalPayloadKey,
  mountChat,
  mountRightCol,
  parseDatetimeLocal,
  shouldRenderContextMenuAsSheet,
} from "./renderAppHelpers";
import type { SearchPage } from "../pages/search/createSearchPage";
import type { ProfilePage } from "../pages/profile/createProfilePage";
import type { SessionsPage } from "../pages/profile/createSessionsPage";
import type { UserPage } from "../pages/user/createUserPage";
import type { RoomPage } from "../pages/room/createRoomPage";
import type { FilesPage } from "../pages/files/createFilesPage";
import type { HelpPage } from "../pages/help/createHelpPage";
import type { CreateGroupPage } from "../pages/create/createGroupCreatePage";
import type { CreateBoardPage } from "../pages/create/createBoardCreatePage";
import type { AutoDownloadPrefs } from "../helpers/files/autoDownloadPrefs";

interface DeferredPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

interface DeferredPageRuntime<T extends DeferredPage> {
  page: T | null;
  promise: Promise<T | null> | null;
  loadFailed: boolean;
  loadingShell: HTMLElement | null;
  loadingText: HTMLElement | null;
  focusWhenReady: boolean;
}

function createDeferredPageRuntime<T extends DeferredPage>(): DeferredPageRuntime<T> {
  return {
    page: null,
    promise: null,
    loadFailed: false,
    loadingShell: null,
    loadingText: null,
    focusWhenReady: false,
  };
}

const searchPageRuntime = createDeferredPageRuntime<SearchPage>();
const profilePageRuntime = createDeferredPageRuntime<ProfilePage>();
const sessionsPageRuntime = createDeferredPageRuntime<SessionsPage>();
const userPageRuntime = createDeferredPageRuntime<UserPage>();
const groupPageRuntime = createDeferredPageRuntime<RoomPage>();
const boardPageRuntime = createDeferredPageRuntime<RoomPage>();
const filesPageRuntime = createDeferredPageRuntime<FilesPage>();
let helpPage: HelpPage | null = null;
let helpPagePromise: Promise<HelpPage | null> | null = null;
let helpPageLoadFailed = false;
let helpLoadingPage: HTMLElement | null = null;
let helpLoadingText: HTMLElement | null = null;
let latestHelpLayout: Layout | null = null;
let latestHelpState: AppState | null = null;
let helpFocusWhenReady = false;
const groupCreatePageRuntime = createDeferredPageRuntime<CreateGroupPage>();
const boardCreatePageRuntime = createDeferredPageRuntime<CreateBoardPage>();
let lastPage: PageKind | null = null;
const rightUserPageRuntime = createDeferredPageRuntime<UserPage>();
const rightGroupPageRuntime = createDeferredPageRuntime<RoomPage>();
const rightBoardPageRuntime = createDeferredPageRuntime<RoomPage>();
let rightPanelShell: HTMLElement | null = null;
let rightPanelTitleEl: HTMLElement | null = null;
let rightPanelBodyEl: HTMLElement | null = null;
const callModalRuntime = createLazyCallModalRuntime();
let forwardModalPage: HTMLElement | null = null;
let forwardModalNode: HTMLElement | null = null;
let forwardModalKey = "";
let latestDeferredRenderLayout: Layout | null = null;
let latestDeferredRenderState: AppState | null = null;

function ensureHelpLoadingPage(): HTMLElement {
  if (helpLoadingPage && helpLoadingText) return helpLoadingPage;
  const text = el("div", { class: "msg msg-sys help-page-loading" }, ["Загрузка справки…"]);
  helpLoadingText = text;
  helpLoadingPage = el("div", { class: "page info-page help-page-loading-shell" }, [text]);
  return helpLoadingPage;
}

function mountLoadedHelpPageIfActive() {
  if (!helpPage || !latestHelpLayout || !latestHelpState || lastPage !== "help") return;
  mountChat(latestHelpLayout, helpPage.root);
  helpPage.update(latestHelpState);
  if (helpFocusWhenReady) {
    helpFocusWhenReady = false;
    helpPage.focus();
  }
}

function ensureHelpPageLoaded(forceRetry = false) {
  if (helpPage || helpPagePromise) return;
  if (helpPageLoadFailed && !forceRetry) return;
  helpPageLoadFailed = false;
  if (helpLoadingText) helpLoadingText.textContent = "Загрузка справки…";
  helpPagePromise = import("../pages/help/createHelpPage")
    .then(({ createHelpPage }) => {
      const page = createHelpPage();
      helpPage = page;
      helpPagePromise = null;
      mountLoadedHelpPageIfActive();
      return page;
    })
    .catch((err) => {
      helpPagePromise = null;
      helpPageLoadFailed = true;
      const recovering = recoverFromLazyImportError(err, "page_help");
      if (helpLoadingText) helpLoadingText.textContent = recovering ? "Обновляем приложение…" : "Не удалось загрузить справку";
      return null;
    });
}

function ensureDeferredCenterPageShell<T extends DeferredPage>(runtime: DeferredPageRuntime<T>): HTMLElement {
  if (runtime.loadingShell && runtime.loadingText) return runtime.loadingShell;
  const text = el("div", { class: "msg msg-sys page-loading-text" }, ["Загрузка страницы…"]);
  runtime.loadingText = text;
  runtime.loadingShell = el("div", { class: "page info-page page-loading-shell" }, [text]);
  return runtime.loadingShell;
}

function ensureDeferredRightPanelShell<T extends DeferredPage>(runtime: DeferredPageRuntime<T>): HTMLElement {
  if (runtime.loadingShell && runtime.loadingText) return runtime.loadingShell;
  const text = el("div", { class: "msg msg-sys right-col-loading-text" }, ["Загрузка панели…"]);
  runtime.loadingText = text;
  runtime.loadingShell = el("div", { class: "right-col-loading-shell" }, [text]);
  return runtime.loadingShell;
}

function mountLoadedCenterPageIfActive<T extends DeferredPage>(page: PageKind, runtime: DeferredPageRuntime<T>) {
  if (!runtime.page || !latestDeferredRenderLayout || !latestDeferredRenderState || lastPage !== page) return;
  mountChat(latestDeferredRenderLayout, runtime.page.root);
  runtime.page.update(latestDeferredRenderState);
  if (runtime.focusWhenReady) {
    runtime.focusWhenReady = false;
    runtime.page.focus();
  }
}

function ensureDeferredCenterPageLoaded<T extends DeferredPage>(
  runtime: DeferredPageRuntime<T>,
  page: PageKind,
  load: () => Promise<T>,
  forceRetry = false
) {
  if (runtime.page || runtime.promise) return;
  if (runtime.loadFailed && !forceRetry) return;
  runtime.loadFailed = false;
  if (runtime.loadingText) runtime.loadingText.textContent = "Загрузка страницы…";
  runtime.promise = load()
    .then((loadedPage) => {
      runtime.page = loadedPage;
      runtime.promise = null;
      mountLoadedCenterPageIfActive(page, runtime);
      return loadedPage;
    })
    .catch((err) => {
      runtime.promise = null;
      runtime.loadFailed = true;
      const recovering = recoverFromLazyImportError(err, `page_${page}`);
      if (runtime.loadingText) runtime.loadingText.textContent = recovering ? "Обновляем приложение…" : "Не удалось загрузить страницу";
      return null;
    });
}

function renderDeferredCenterPage<T extends DeferredPage>(
  layout: Layout,
  state: AppState,
  page: PageKind,
  runtime: DeferredPageRuntime<T>,
  load: () => Promise<T>,
  pageChanged: boolean
) {
  if (runtime.page) {
    mountChat(layout, runtime.page.root);
    runtime.page.update(state);
    if (pageChanged) runtime.page.focus();
    return;
  }
  if (pageChanged) runtime.focusWhenReady = true;
  mountChat(layout, ensureDeferredCenterPageShell(runtime));
  ensureDeferredCenterPageLoaded(runtime, page, load, pageChanged);
}

function ensureDeferredRightPanelLoaded<T extends DeferredPage>(
  runtime: DeferredPageRuntime<T>,
  load: () => Promise<T>,
  onReady: (page: T) => void,
  forceRetry = false
) {
  if (runtime.page || runtime.promise) return;
  if (runtime.loadFailed && !forceRetry) return;
  runtime.loadFailed = false;
  if (runtime.loadingText) runtime.loadingText.textContent = "Загрузка панели…";
  runtime.promise = load()
    .then((loadedPage) => {
      runtime.page = loadedPage;
      runtime.promise = null;
      onReady(loadedPage);
      return loadedPage;
    })
    .catch((err) => {
      runtime.promise = null;
      runtime.loadFailed = true;
      const recovering = recoverFromLazyImportError(err, "right_panel");
      if (runtime.loadingText) runtime.loadingText.textContent = recovering ? "Обновляем приложение…" : "Не удалось загрузить панель";
      return null;
    });
}

function disposeForwardModalCache() {
  try {
    (forwardModalNode as any)?.__disposeForwardModal?.();
  } catch {
    // ignore
  }
  forwardModalNode = null;
  forwardModalPage = null;
  forwardModalKey = "";
}

function ensureRightPanelShell(actions: RenderActions): { shell: HTMLElement; title: HTMLElement; body: HTMLElement } {
  if (rightPanelShell && rightPanelTitleEl && rightPanelBodyEl) {
    return { shell: rightPanelShell, title: rightPanelTitleEl, body: rightPanelBodyEl };
  }
  const title = el("div", { class: "right-col-title" }, [""]);
  const closeBtn = el(
    "button",
    { class: "btn right-col-close", type: "button", "aria-label": "Закрыть панель", "data-action": "right-col-close" },
    ["×"]
  ) as HTMLButtonElement;
  closeBtn.addEventListener("click", () => actions.onCloseRightPanel());
  const head = el("div", { class: "right-col-head" }, [title, closeBtn]);
  const body = el("div", { class: "right-col-body" }, []);
  const shell = el("div", { class: "right-col-shell" }, [head, body]);
  rightPanelShell = shell;
  rightPanelTitleEl = title;
  rightPanelBodyEl = body;
  return { shell, title, body };
}

export interface RenderActions {
  onSelectTarget: (t: TargetRef) => void;
  onOpenUser: (id: string) => void;
  onRoomMemberRemove: (kind: TargetRef["kind"], roomId: string, memberId: string) => void;
  onBlockToggle: (memberId: string) => void;
  onRoomWriteToggle: (kind: TargetRef["kind"], roomId: string, memberId: string, value: boolean) => void;
  onRoomRefresh: (kind: TargetRef["kind"], roomId: string) => void;
  onRoomInfoSave: (kind: TargetRef["kind"], roomId: string, description: string, rules: string) => void;
  onRoomLeave: (kind: TargetRef["kind"], roomId: string) => void;
  onRoomDisband: (kind: TargetRef["kind"], roomId: string) => void;
  onCloseRightPanel: () => void;
  onOpenActionModal: (payload: ActionModalPayload) => void;
  onOpenHelp: () => void;
  onOpenGroupCreate: () => void;
  onOpenBoardCreate: () => void;
  onSetPage: (page: PageKind) => void;
  onSetMobileSidebarTab: (tab: MobileSidebarTab) => void;
  onSetSidebarFolderId: (folderId: string) => void;
  onSetSidebarQuery: (query: string) => void;
  onToggleSidebarArchive: () => void;
  onAuthLogin: () => void;
  onAuthRegister: () => void;
  onAuthTouchId: () => void;
  onAuthModeChange: (mode: "register" | "login") => void;
  onAuthUseDifferentAccount: () => void;
  onAuthOpen: () => void;
  onAuthLogout: () => void;
  onOpenSidebarToolsMenu: (x: number, y: number) => void;
  onCloseModal: () => void;
  onCallRequestMediaAccess: () => void;
  onCallOpenMediaSettings: (kind: "camera" | "microphone") => void;
  onCallAccept: (callId: string) => void;
  onCallDecline: (callId: string) => void;
  onConfirmModal: () => void;
  onDismissUpdate: () => void;
  onReloadUpdate: () => void;
  onApplyPwaUpdate: () => void;
  onDeferPwaUpdate: () => void;
  onDesktopUpdateCheck: () => void;
  onDesktopUpdateDownload: () => void;
  onDesktopUpdateInstall: () => void;
  onSkinChange: (skinId: string) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onSessionsRefresh: () => void;
  onSessionsLogoutOthers: () => void;
  onGroupCreate: () => void;
  onBoardCreate: () => void;
  onMembersAdd: () => void;
  onMembersRemove: () => void;
  onRename: () => void;
  onSendSchedule: () => void;
  onSendScheduleWhenOnline: () => void;
  onForwardSend: (targets: TargetRef[]) => void;
  onInviteUser: () => void;
  onAuthRequest: (peer: string) => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupJoin: (groupId: string) => void;
  onBoardJoin: (boardId: string) => void;
  onOpenHistoryHit: (t: TargetRef, query: string, msgIdx?: number) => void;
  onSearchHistoryDelete: (items: Array<{ target: TargetRef; idx: number }>, mode: "local" | "remote") => void;
  onSearchHistoryForward: (items: Array<{ target: TargetRef; idx: number }>) => void;
  onSearchPinToggle: (targets: TargetRef[]) => void;
  onSearchServerForward: (items: SearchResultEntry[]) => void;
  onGroupInviteAccept: (groupId: string) => void;
  onGroupInviteDecline: (groupId: string) => void;
  onGroupJoinAccept: (groupId: string, peer: string) => void;
  onGroupJoinDecline: (groupId: string, peer: string) => void;
  onBoardInviteJoin: (boardId: string) => void;
  onBoardInviteDecline: (boardId: string) => void;
  onFileOfferAccept: (fileId: string) => void;
  onFileOfferReject: (fileId: string) => void;
  onFileSendConfirm: (captionText: string) => void;
  onFileSend: (file: File | null, target: TargetRef | null) => void;
  onClearCompletedFiles: () => void;
  onAutoDownloadPrefsSave: (prefs: AutoDownloadPrefs) => void;
  onSearchQueryChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  onBoardPostPublish: (text: string) => void;
  onProfileDraftChange: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onProfileSave: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onProfileRefresh: () => void;
  onProfileCopyId: () => void;
  onProfileShareId: () => void;
  onProfileAvatarSelect: (file: File | null) => void;
  onProfileAvatarClear: () => void;
  onPushEnable: () => void;
  onPushDisable: () => void;
  onNotifyInAppEnable: () => void;
  onNotifyInAppDisable: () => void;
  onNotifySoundEnable: () => void;
  onNotifySoundDisable: () => void;
  onForcePwaUpdate: () => void;
  onContextMenuAction: (itemId: string) => void;
  onFileViewerNavigate: (dir: "prev" | "next") => void;
  onFileViewerJump: () => void;
  onFileViewerRecover?: () => void;
  onFileViewerShare: () => void;
  onFileViewerForward: () => void;
  onFileViewerDelete: () => void;
  onFileViewerOpenAt: (msgIdx: number) => void;
}

export function renderApp(layout: Layout, state: AppState, actions: RenderActions) {
  latestDeferredRenderLayout = layout;
  latestDeferredRenderState = state;
  const pageChanged = state.page !== lastPage;
  lastPage = state.page;
  const modalPresentation = resolveModalPresentation({ authed: state.authed, modal: state.modal });
  const fullScreenKind = modalPresentation.fullScreenKind;
  const fullScreenActive = modalPresentation.fullScreenActive;
  const conversationViewportTarget = getConversationViewportTarget(state);
  const conversationViewportKey = getConversationViewportKey(state);
  const messageContextMenuOpen = Boolean(state.modal?.kind === "context_menu" && state.modal.payload.target.kind === "message");

  // Контекстное меню не должно "ломать" макет и прятать composer.
  // Composer показываем только когда выбран чат/контакт/доска (как в tweb).
  const chatInputVisible = !fullScreenActive && Boolean(conversationViewportTarget);
  const mobileUi = isMobileLikeUi();
  const rightTarget = getRightPanelTarget(state);
  const showRightPanel = shouldShowRightPanel(state, { fullScreenActive, mobileUi });
  const authModalVisible = modalPresentation.authModalVisible;
  const profileSurfaceActive = state.page === "profile" || state.page === "sessions";
  if (typeof document !== "undefined") {
    document.body.classList.toggle("has-right-col", showRightPanel);
    document.body.classList.toggle("has-auth-pages", fullScreenActive);
    document.documentElement.classList.toggle("has-auth-pages", fullScreenActive);
    document.documentElement.classList.toggle("has-profile-surface", profileSurfaceActive);
    document.body.classList.toggle("has-profile-surface", profileSurfaceActive);
    layout.root?.classList.toggle("app-frame-auth", fullScreenActive);
    layout.root?.classList.toggle("app-frame-main", !fullScreenActive);
    layout.root?.classList.toggle("has-message-context-menu", messageContextMenuOpen);
    document.body?.classList.toggle("has-message-context-menu", messageContextMenuOpen);
    scheduleChromeColorSync();
  }
  layout.rightCol.classList.toggle("hidden", !showRightPanel);
  layout.rightCol.setAttribute("aria-hidden", showRightPanel ? "false" : "true");
  layout.inputWrap.classList.toggle("hidden", !chatInputVisible);
  layout.inputWrap.classList.toggle("input-wrap-no-composer", !chatInputVisible);

  const rawInput = (layout.input.value || state.input || "").toString();
  const sendText = rawInput.trimEnd();
  const sendLen = sendText.length;
  const tooLong = sendLen > APP_MSG_MAX_LEN;
  const nearLimit = sendLen >= APP_MSG_MAX_LEN - 200;

  const countEl = layout.inputWrap.querySelector(".composer-count") as HTMLElement | null;
  if (countEl) countEl.textContent = `${sendLen}/${APP_MSG_MAX_LEN}`;
  layout.inputWrap.classList.toggle("composer-too-long", tooLong);
  layout.inputWrap.classList.toggle("composer-near-limit", nearLimit && !tooLong);

  const sel = conversationViewportTarget;
  const selectedKey = conversationViewportKey;
  const editing = state.editing && state.editing.key === selectedKey ? state.editing : null;
  const replyDraft = !editing && state.replyDraft && state.replyDraft.key === selectedKey ? state.replyDraft : null;
  const forwardDraft = !editing && state.forwardDraft && state.forwardDraft.key === selectedKey ? state.forwardDraft : null;
  const helperDraft = replyDraft || forwardDraft;
  const helperKind = replyDraft ? "reply" : forwardDraft ? "forward" : null;
  const selectionActive = (() => {
    if (!selectedKey) return false;
    const selState = state.chatSelection && state.chatSelection.key === selectedKey ? state.chatSelection : null;
    return Boolean(selState && Array.isArray(selState.ids) && selState.ids.length > 0);
  })();
  layout.inputWrap.classList.toggle("is-selecting", selectionActive);
  if (selectionActive && typeof document !== "undefined" && document.activeElement === layout.input) {
    try {
      layout.input.blur();
    } catch {
      // ignore
    }
  }
  const isBoardReadOnly = (() => {
    if (!chatInputVisible) return false;
    if (!sel || sel.kind !== "board") return false;
    const b = (state.boards || []).find((x) => x.id === sel.id);
    const owner = String(b?.owner_id || "").trim();
    const me = String(state.selfId || "").trim();
    return Boolean(owner && me && owner !== me);
  })();
  const isGroupWriteBlocked = (() => {
    if (!chatInputVisible) return false;
    if (!sel || sel.kind !== "group") return false;
    const g = (state.groups || []).find((x) => x.id === sel.id);
    const owner = String(g?.owner_id || "").trim();
    const me = String(state.selfId || "").trim();
    if (!me || (owner && owner === me)) return false;
    const banned = (g?.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean);
    return banned.includes(me);
  })();

  let composerDisabledReason: string | null = null;
  if (!chatInputVisible) composerDisabledReason = null;
  else if (state.conn !== "connected") composerDisabledReason = "Нет соединения";
  else if (!state.authed) composerDisabledReason = "Нажмите «Войти», чтобы писать";
  else if (!sel) composerDisabledReason = "Выберите чат слева";
  else if (isGroupWriteBlocked) composerDisabledReason = "Вам запрещено писать в чате";
  else if (isBoardReadOnly) composerDisabledReason = "На доске пишет только владелец";

  const composerEnabled = chatInputVisible && composerDisabledReason === null;
  const boardEditorAvailable = composerEnabled && Boolean(sel && sel.kind === "board") && !isBoardReadOnly && !editing;
  const boardEditorOpen = Boolean(boardEditorAvailable && state.boardComposerOpen);
  layout.boardEditorBtn.classList.toggle("hidden", !boardEditorAvailable);
  layout.boardEditorBtn.classList.toggle("btn-active", boardEditorOpen);
  layout.boardEditorBtn.disabled = !boardEditorAvailable;
  layout.boardEditorWrap.classList.toggle("hidden", !boardEditorOpen);
  layout.inputWrap.classList.toggle("board-editor-open", boardEditorOpen);

  if (boardEditorOpen && sel?.kind === "board") {
    const kbdOpen = (() => {
      if (typeof document === "undefined") return false;
      const de = document.documentElement;
      return Boolean(de && (de as any).classList?.contains?.("kbd-open"));
    })();
    // iOS/Safari: the keyboard accessory bar (prev/next/✓) appears when multiple form fields exist.
    // While the keyboard is open we hide scheduling UI; disabling the datetime input also helps reduce
    // the accessory bar to a minimal “Done” control.
    layout.boardScheduleInput.disabled = kbdOpen;

    const now = Date.now();
    const maxAt = now + maxBoardScheduleDelayMs();
    layout.boardScheduleInput.min = formatDatetimeLocal(now);
    layout.boardScheduleInput.max = formatDatetimeLocal(maxAt);

    const scheduleTs = parseDatetimeLocal(layout.boardScheduleInput.value);
    const scheduleOk = scheduleTs !== null && scheduleTs >= now && scheduleTs <= maxAt;
    const scheduleHasValue = Boolean(layout.boardScheduleInput.value);
    layout.boardScheduleInput.classList.toggle("is-invalid", scheduleHasValue && !scheduleOk);
    if (scheduleHasValue && !scheduleOk) layout.boardScheduleInput.setAttribute("aria-invalid", "true");
    else layout.boardScheduleInput.removeAttribute("aria-invalid");
    const scheduleCanSendNow = composerEnabled && Boolean(sel);
    const scheduleText = sendText.trim();
    layout.boardScheduleBtn.disabled = !scheduleCanSendNow || !scheduleText || tooLong || !scheduleOk;
    layout.boardScheduleClearBtn.disabled = !layout.boardScheduleInput.value;

    const scheduled = (state.boardScheduledPosts || []).filter((x) => x.boardId === sel.id).sort((a, b) => a.scheduleAt - b.scheduleAt);
    if (!scheduled.length) {
      layout.boardScheduleList.replaceChildren(el("div", { class: "board-editor-preview-empty" }, ["Нет запланированных публикаций."]));
    } else {
      const visible = scheduled.slice(0, 12);
      const list = visible.map((it) => {
        const when = (() => {
          try {
            return new Date(it.scheduleAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
          } catch {
            return String(it.scheduleAt);
          }
        })();
        const firstLine = String(it.text || "").trim().split("\n")[0] || "—";
        const label = firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
        return el("div", { class: "board-sched-item" }, [
          el("div", { class: "board-sched-meta" }, [el("div", { class: "board-sched-time" }, [when]), el("div", { class: "board-sched-text" }, [label])]),
          el("button", { class: "btn board-sched-cancel", type: "button", "data-action": "board-schedule-cancel", "data-sched-id": it.id, "aria-label": "Отменить" }, ["×"]),
        ]);
      });
      if (scheduled.length > visible.length) {
        list.push(el("div", { class: "board-sched-more" }, [`И ещё ${scheduled.length - visible.length}…`]));
      }
      layout.boardScheduleList.replaceChildren(...list);
    }
  } else {
    // Keep hidden scheduling field disabled when the board editor is closed.
    // This also helps iOS reduce the keyboard accessory bar (prev/next/✓) while typing in composer.
    layout.boardScheduleInput.disabled = true;
    layout.boardScheduleBtn.disabled = true;
    layout.boardScheduleClearBtn.disabled = true;
    layout.boardScheduleInput.classList.remove("is-invalid");
    layout.boardScheduleInput.removeAttribute("aria-invalid");
    layout.boardScheduleList.replaceChildren(el("div", { class: "board-editor-preview-empty" }, [""]));
  }

  layout.input.disabled = !composerEnabled;
  layout.input.placeholder = composerDisabledReason || (editing ? "Изменить сообщение" : boardEditorOpen ? "Текст объявления…" : "Сообщение");
  layout.input.setAttribute("enterkeyhint", boardEditorOpen ? "enter" : "send");

  const canSendNow = composerEnabled && Boolean(sel);
  const composerText = sendText.trim();
  const canSendText = Boolean(composerText) && !tooLong && !boardEditorOpen;
  layout.sendBtn.disabled = !canSendNow || !canSendText;
  layout.sendBtn.classList.toggle("btn-active", canSendNow && canSendText);
  layout.sendBtn.classList.toggle(
    "is-menu-open",
    Boolean(state.modal?.kind === "context_menu" && state.modal.payload.target.kind === "composer_send")
  );
  layout.boardPublishBtn.disabled = !boardEditorOpen || !canSendNow || !composerText || tooLong;
  layout.attachBtn.disabled = !canSendNow || !sel || isBoardReadOnly || Boolean(editing);
  layout.emojiBtn.disabled = !canSendNow || !sel || isBoardReadOnly;
  layout.inputWrap.classList.toggle("composer-editing", Boolean(editing));
  const hint = layout.inputWrap.querySelector(".composer-hint") as HTMLElement | null;
  if (hint) hint.textContent = editing ? "Enter — сохранить, Shift+Enter — новая строка" : boardEditorOpen ? (mobileUi ? "«Опубликовать» — в редакторе" : "Ctrl+Enter — опубликовать") : "Shift+Enter — новая строка";

  const editBar = layout.inputWrap.querySelector("#composer-edit") as HTMLElement | null;
  const editText = layout.inputWrap.querySelector("#composer-edit-text") as HTMLElement | null;
  if (editBar) {
    editBar.classList.toggle("hidden", !editing);
    if (editing && editText) {
      const conv = selectedKey ? state.conversations[selectedKey] : null;
      const msg = conv ? conv.find((m) => typeof m.id === "number" && m.id === editing.id) : null;
      const preview = String(msg?.text || "").trim() || `#${editing.id}`;
      editText.textContent = preview.length > 140 ? `${preview.slice(0, 137)}…` : preview;
    } else if (editText) {
      editText.textContent = "";
    }
  }

  const helperBar = layout.inputWrap.querySelector("#composer-helper") as HTMLElement | null;
  const helperIcon = layout.inputWrap.querySelector("#composer-helper-icon") as HTMLElement | null;
  const helperTitle = layout.inputWrap.querySelector("#composer-helper-title") as HTMLElement | null;
  const helperText = layout.inputWrap.querySelector("#composer-helper-text") as HTMLElement | null;
  const helperMenuBtn = layout.inputWrap.querySelector("#composer-helper-menu") as HTMLButtonElement | null;
  if (helperBar) {
    helperBar.classList.toggle("hidden", !helperDraft);
    helperBar.classList.toggle("composer-helper-forward", helperKind === "forward");
    if (helperIcon) helperIcon.textContent = helperKind === "forward" ? "↪" : "↩";
    if (helperTitle) {
      const sender = helperDraft?.from ? formatSenderLabel(state, helperDraft.from) : "";
      const titleBase = helperKind === "forward" ? "Переслано" : "Ответ";
      helperTitle.textContent = sender ? `${titleBase}: ${sender}` : titleBase;
    }
    if (helperText) helperText.textContent = helperDraft?.preview || "";
  }
  if (helperMenuBtn) {
    const open = Boolean(state.modal && state.modal.kind === "context_menu" && state.modal.payload.target.kind === "composer_helper");
    helperMenuBtn.classList.toggle("is-menu-open", open);
  }

  renderHeader(layout, state);
  const sidebarScrollTop = layout.sidebarBody.scrollTop;
  const sidebarScrollLeft = layout.sidebarBody.scrollLeft;
  const prevSidebarSearch = layout.sidebar.querySelector("input.sidebar-search-input") as HTMLInputElement | null;
  const sidebarSearchHadFocus = Boolean(prevSidebarSearch && document.activeElement === prevSidebarSearch);
  const sidebarSearchSelStart = prevSidebarSearch?.selectionStart ?? null;
  const sidebarSearchSelEnd = prevSidebarSearch?.selectionEnd ?? null;
  renderSidebar(
    layout.sidebar,
    state,
    actions.onSelectTarget,
    actions.onOpenUser,
    actions.onOpenActionModal,
    actions.onSetPage,
    actions.onOpenGroupCreate,
    actions.onOpenBoardCreate,
    actions.onSetMobileSidebarTab,
    actions.onSetSidebarFolderId,
    actions.onSetSidebarQuery,
    actions.onAuthOpen,
    actions.onAuthLogout,
    actions.onOpenSidebarToolsMenu,
    actions.onToggleSidebarArchive,
    layout.sidebarDock
  );
  const shouldResetSidebarScroll =
    layout.sidebarBody.dataset.sidebarResetScroll === "1" || layout.sidebar.dataset.sidebarResetScroll === "1";
  if (shouldResetSidebarScroll) {
    delete layout.sidebarBody.dataset.sidebarResetScroll;
    delete layout.sidebar.dataset.sidebarResetScroll;
    layout.sidebarBody.scrollTop = 0;
    layout.sidebarBody.scrollLeft = 0;
  } else {
    if (layout.sidebarBody.scrollTop !== sidebarScrollTop) layout.sidebarBody.scrollTop = sidebarScrollTop;
    if (layout.sidebarBody.scrollLeft !== sidebarScrollLeft) layout.sidebarBody.scrollLeft = sidebarScrollLeft;
  }
  if (sidebarSearchHadFocus) {
    const nextSidebarSearch = layout.sidebar.querySelector("input.sidebar-search-input") as HTMLInputElement | null;
    if (nextSidebarSearch) {
      focusElement(nextSidebarSearch);
      try {
        const len = nextSidebarSearch.value.length;
        const start = sidebarSearchSelStart === null ? len : Math.max(0, Math.min(len, sidebarSearchSelStart));
        const end = sidebarSearchSelEnd === null ? len : Math.max(0, Math.min(len, sidebarSearchSelEnd));
        nextSidebarSearch.setSelectionRange(start, end);
      } catch {
        // ignore
      }
    }
  }

  const disableSidebarSearchForIosKbdNav = (() => {
    try {
      if (!isIOS()) return false;
      return document.activeElement === layout.input;
    } catch {
      return false;
    }
  })();
  const sidebarSearchNow = layout.sidebar.querySelector("input.sidebar-search-input") as HTMLInputElement | null;
  if (sidebarSearchNow) sidebarSearchNow.disabled = disableSidebarSearchForIosKbdNav;

  const prevAuthIdInput = authModalVisible ? (document.getElementById("auth-id") as HTMLInputElement | null) : null;
  const prevAuthPwInput = authModalVisible ? (document.getElementById("auth-manual-entry") as HTMLInputElement | null) : null;
  const prevAuthPw1Input = authModalVisible ? (document.getElementById("auth-manual-entry-a") as HTMLInputElement | null) : null;
  const prevAuthPw2Input = authModalVisible ? (document.getElementById("auth-manual-entry-b") as HTMLInputElement | null) : null;
  const prevAuthSkinSelect = authModalVisible ? (document.getElementById("auth-skin") as HTMLSelectElement | null) : null;
  const prevFileSendCaptionInput =
    state.modal?.kind === "file_send" ? (document.getElementById("file-send-caption") as HTMLTextAreaElement | null) : null;
  const prevBoardPostInput =
    state.modal?.kind === "board_post" ? (document.getElementById("board-post-text") as HTMLTextAreaElement | null) : null;
  const prevMembersAddInput = state.modal?.kind === "members_add" ? (document.getElementById("members-add-input") as HTMLInputElement | null) : null;
  const prevMembersAddEntryInput = state.modal?.kind === "members_add" ? (document.getElementById("members-add-entry") as HTMLInputElement | null) : null;
  const prevMembersRemoveInput =
    state.modal?.kind === "members_remove" ? (document.getElementById("members-remove-input") as HTMLInputElement | null) : null;
  const prevRenameInput = state.modal?.kind === "rename" ? (document.getElementById("rename-name") as HTMLInputElement | null) : null;
  const prevSendScheduleInput =
    state.modal?.kind === "send_schedule" ? (document.getElementById("send-schedule-at") as HTMLInputElement | null) : null;
  const hadAuthModal = Boolean(prevAuthIdInput || prevAuthPwInput || prevAuthPw1Input || prevAuthPw2Input || prevAuthSkinSelect);
  const hadFileSendModal = Boolean(prevFileSendCaptionInput);
  const hadBoardPostModal = Boolean(prevBoardPostInput);
  const hadSendScheduleModal = Boolean(prevSendScheduleInput);
  const prevAuthId = prevAuthIdInput?.value ?? "";
  const prevAuthPw = prevAuthPwInput?.value ?? "";
  const prevAuthPw1 = prevAuthPw1Input?.value ?? "";
  const prevAuthPw2 = prevAuthPw2Input?.value ?? "";
  const prevActiveId = (document.activeElement as HTMLElement | null)?.id ?? "";
  const prevFileSendCaption = prevFileSendCaptionInput?.value ?? "";
  const prevBoardPostText = prevBoardPostInput?.value ?? "";
  const prevMembersAdd = prevMembersAddInput?.value ?? "";
  const prevMembersAddEntry = prevMembersAddEntryInput?.value ?? "";
  const prevMembersRemove = prevMembersRemoveInput?.value ?? "";
  const prevRename = prevRenameInput?.value ?? "";
  const prevSendScheduleAt = prevSendScheduleInput?.value ?? "";

  const modalActions = {
    onAuthLogin: actions.onAuthLogin,
    onAuthRegister: actions.onAuthRegister,
    onAuthTouchId: actions.onAuthTouchId,
    onAuthModeChange: actions.onAuthModeChange,
    onAuthOpen: actions.onAuthOpen,
    onAuthUseDifferentAccount: actions.onAuthUseDifferentAccount,
    onClose: actions.onCloseModal,
    onConfirm: actions.onConfirmModal,
    onBoardPostPublish: actions.onBoardPostPublish,
    onDismissUpdate: actions.onDismissUpdate,
    onReloadUpdate: actions.onReloadUpdate,
    onApplyPwaUpdate: actions.onApplyPwaUpdate,
    onDeferPwaUpdate: actions.onDeferPwaUpdate,
    onDesktopUpdateCheck: actions.onDesktopUpdateCheck,
    onDesktopUpdateDownload: actions.onDesktopUpdateDownload,
    onDesktopUpdateInstall: actions.onDesktopUpdateInstall,
    onSkinChange: actions.onSkinChange,
    onMembersAdd: actions.onMembersAdd,
    onMembersRemove: actions.onMembersRemove,
    onRename: actions.onRename,
    onSendSchedule: actions.onSendSchedule,
    onSendScheduleWhenOnline: actions.onSendScheduleWhenOnline,
    onInviteUser: actions.onInviteUser,
    onAuthAccept: actions.onAuthAccept,
    onAuthDecline: actions.onAuthDecline,
    onAuthCancel: actions.onAuthCancel,
    onGroupInviteAccept: actions.onGroupInviteAccept,
    onGroupInviteDecline: actions.onGroupInviteDecline,
    onGroupJoinAccept: actions.onGroupJoinAccept,
    onGroupJoinDecline: actions.onGroupJoinDecline,
    onBoardInviteJoin: actions.onBoardInviteJoin,
    onBoardInviteDecline: actions.onBoardInviteDecline,
    onFileOfferAccept: actions.onFileOfferAccept,
    onFileOfferReject: actions.onFileOfferReject,
    onFileSendConfirm: actions.onFileSendConfirm,
    onFileViewerNavigate: actions.onFileViewerNavigate,
    onFileViewerJump: actions.onFileViewerJump,
    ...(actions.onFileViewerRecover ? { onFileViewerRecover: actions.onFileViewerRecover } : {}),
    onFileViewerShare: actions.onFileViewerShare,
    onFileViewerForward: actions.onFileViewerForward,
    onFileViewerDelete: actions.onFileViewerDelete,
    onFileViewerOpenAt: actions.onFileViewerOpenAt,
    onContextMenuAction: actions.onContextMenuAction,
    onForwardSend: actions.onForwardSend,
  };
  const authMessage = state.modal?.kind === "auth" ? state.modal.message : undefined;
  const authModalNode = authModalVisible
      ? renderAuthModal(state.authMode, state.authRememberedId, authMessage, state.status, state.conn, state.skins, state.skin, {
          onLogin: actions.onAuthLogin,
          onRegister: actions.onAuthRegister,
          onTouchId: actions.onAuthTouchId,
          onModeChange: actions.onAuthModeChange,
          onUseDifferentAccount: actions.onAuthUseDifferentAccount,
          onSkinChange: actions.onSkinChange,
          onClose: actions.onCloseModal,
        })
    : null;
  const overlayState = layout.overlay as any;
  const reuseContextMenuNode =
    state.modal?.kind === "context_menu"
      ? (() => {
          const existing = layout.overlay.firstElementChild as HTMLElement | null;
          if (!existing || !existing.classList.contains("ctx-menu")) return null;
          const sheet = shouldRenderContextMenuAsSheet(state.modal.payload);
          const key = contextMenuPayloadKey(state.modal.payload, sheet);
          const prevKey = String(overlayState.__ctxMenuKey || "");
          overlayState.__ctxMenuKey = key;
          return prevKey && prevKey === key ? existing : null;
        })()
      : null;
  if (state.modal?.kind !== "context_menu") {
    overlayState.__ctxMenuKey = null;
  }

  const callModalNode =
    state.modal?.kind === "call"
      ? callModalRuntime.render(state, state.modal, {
          onHangup: actions.onCloseModal,
          onRequestMediaAccess: actions.onCallRequestMediaAccess,
          onOpenMediaSettings: actions.onCallOpenMediaSettings,
          onAccept: (cid) => actions.onCallAccept(cid),
          onDecline: (cid) => actions.onCallDecline(cid),
          onOpenExternal: (url) => {
            try {
              window.open(url, "_blank", "noopener,noreferrer");
            } catch {
              // ignore
            }
          },
        })
      : null;

  if (state.modal?.kind !== "call") {
    callModalRuntime.clear();
  }

  const forwardModal = state.modal?.kind === "forward_select" ? state.modal : null;
  const forwardInline = !fullScreenActive && Boolean(forwardModal);
  const forwardPageKey = forwardInline && forwardModal ? `${forwardModalPayloadKey(forwardModal)}:${mobileUi ? 1 : 0}` : "";
  if (!forwardInline && forwardModalPage) {
    disposeForwardModalCache();
  } else if (forwardInline && forwardModalPage && forwardModalKey !== forwardPageKey) {
    disposeForwardModalCache();
  }
  const reuseForwardPage = forwardInline && Boolean(forwardModalPage && forwardModalKey && forwardModalKey === forwardPageKey);

  const modalNode = reuseForwardPage
    ? null
    : state.modal?.kind === "call"
      ? callModalNode
      : fullScreenKind
        ? fullScreenKind === "auth"
          ? authModalNode
          : state.modal
            ? state.modal.kind === "context_menu" && reuseContextMenuNode
              ? reuseContextMenuNode
              : renderModal(state, modalActions)
            : null
        : state.modal
          ? state.modal.kind === "auth"
            ? authModalNode
            : state.modal.kind === "context_menu" && reuseContextMenuNode
              ? reuseContextMenuNode
              : renderModal(state, modalActions)
          : null;

  // Большинство модалок рендерим inline (в теле чата), чтобы не перекрывать всё приложение.
  // Исключения:
  // - context_menu: всегда поверх (overlay) из-за позиционирования по курсору/тапу
  // - file_viewer: поверх (overlay) как fullscreen viewer (Telegram‑паттерн)
  const inlineModal = modalPresentation.inlineModal;
  layout.chat.classList.toggle("chat-page", state.page !== "main" || inlineModal);
  const showChatTop = !inlineModal && hasConversationViewportSelection(state);
  layout.chatTop.classList.toggle("hidden", !showChatTop);
  if (!showChatTop) {
    // When switching to pages/modals, clear chat header state so returning to chat is treated as "fresh".
    layout.chatTop.replaceChildren();
    layout.chatHost.removeAttribute("data-chat-key");
    layout.chatJump.classList.add("hidden");
    const hostState = layout.chatHost as any;
    resetChatHistoryViewportRuntime(layout.chatHost);
    if (hostState) {
      hostState.__chatRenderState = null;
    }
    if (pageChanged) {
      try {
        layout.chatHost.scrollTop = 0;
      } catch {
        // ignore
      }
    }
  }
  if (inlineModal && state.modal?.kind === "forward_select") {
    if (reuseForwardPage && forwardModalPage) {
      const warn = forwardModalPage.querySelector(".modal-warn") as HTMLElement | null;
      if (warn) warn.textContent = state.modal.message || "";
      mountChat(layout, forwardModalPage);
    } else if (modalNode) {
      forwardModalNode = modalNode;
      forwardModalKey = forwardPageKey;
      forwardModalPage = el(
        "div",
        { class: "page modal-page" },
        mobileUi ? [modalNode] : [modalNode, el("div", { class: "msg msg-sys" }, ["Esc — назад"])]
      );
      mountChat(layout, forwardModalPage);
    }
  } else if (inlineModal && modalNode) {
    mountChat(layout, el("div", { class: "page modal-page" }, mobileUi ? [modalNode] : [modalNode, el("div", { class: "msg msg-sys" }, ["Esc — назад"])]));
  } else if (state.page === "main") {
    const prevSearch = layout.chatTop.querySelector("#chat-search-input") as HTMLInputElement | null;
    const searchHadFocus = Boolean(prevSearch && document.activeElement === prevSearch);
    const searchSelStart = prevSearch?.selectionStart ?? null;
    const searchSelEnd = prevSearch?.selectionEnd ?? null;
    renderChat(layout, state);
    if (state.chatSearchOpen && searchHadFocus) {
      const nextSearch = layout.chatTop.querySelector("#chat-search-input") as HTMLInputElement | null;
      if (nextSearch) {
        focusElement(nextSearch);
        try {
          const len = nextSearch.value.length;
          const start = searchSelStart === null ? len : Math.max(0, Math.min(len, searchSelStart));
          const end = searchSelEnd === null ? len : Math.max(0, Math.min(len, searchSelEnd));
          nextSearch.setSelectionRange(start, end);
        } catch {
          // ignore
        }
      }
    }
  } else if (state.page === "help") {
    latestHelpLayout = layout;
    latestHelpState = state;
    if (helpPage) {
      mountChat(layout, helpPage.root);
      helpPage.update(state);
      if (pageChanged) helpPage.focus();
    } else {
      if (pageChanged) helpFocusWhenReady = true;
      mountChat(layout, ensureHelpLoadingPage());
      ensureHelpPageLoaded(pageChanged);
    }
  } else if (state.page === "group_create") {
    renderDeferredCenterPage(
      layout,
      state,
      "group_create",
      groupCreatePageRuntime,
      () =>
        import("../pages/create/createGroupCreatePage").then(({ createGroupCreatePage }) =>
          createGroupCreatePage({
            onCreate: actions.onGroupCreate,
            onCancel: () => actions.onSetPage("main"),
          })
        ),
      pageChanged
    );
  } else if (state.page === "board_create") {
    renderDeferredCenterPage(
      layout,
      state,
      "board_create",
      boardCreatePageRuntime,
      () =>
        import("../pages/create/createBoardCreatePage").then(({ createBoardCreatePage }) =>
          createBoardCreatePage({
            onCreate: actions.onBoardCreate,
            onCancel: () => actions.onSetPage("main"),
          })
        ),
      pageChanged
    );
  } else if (state.page === "search") {
    renderDeferredCenterPage(
      layout,
      state,
      "search",
      searchPageRuntime,
      () =>
        import("../pages/search/createSearchPage").then(({ createSearchPage }) =>
          createSearchPage({
            onQueryChange: actions.onSearchQueryChange,
            onSubmit: actions.onSearchSubmit,
            onSelectTarget: actions.onSelectTarget,
            onAuthRequest: actions.onAuthRequest,
            onAuthAccept: actions.onAuthAccept,
            onAuthDecline: actions.onAuthDecline,
            onAuthCancel: actions.onAuthCancel,
            onGroupJoin: actions.onGroupJoin,
            onBoardJoin: actions.onBoardJoin,
            onSearchPinToggle: actions.onSearchPinToggle,
            onSearchServerForward: actions.onSearchServerForward,
            onOpenHistoryHit: actions.onOpenHistoryHit,
            onSearchHistoryDelete: actions.onSearchHistoryDelete,
            onSearchHistoryForward: actions.onSearchHistoryForward,
          })
        ),
      pageChanged
    );
  } else if (state.page === "profile") {
    renderDeferredCenterPage(
      layout,
      state,
      "profile",
      profilePageRuntime,
      () =>
        import("../pages/profile/createProfilePage").then(({ createProfilePage }) =>
          createProfilePage({
            onDraftChange: actions.onProfileDraftChange,
            onSave: actions.onProfileSave,
            onRefresh: actions.onProfileRefresh,
            onCopyId: actions.onProfileCopyId,
            onShareId: actions.onProfileShareId,
            onOpenSessionsPage: () => actions.onSetPage("sessions"),
            onSkinChange: actions.onSkinChange,
            onThemeChange: actions.onThemeChange,
            onAvatarSelect: actions.onProfileAvatarSelect,
            onAvatarClear: actions.onProfileAvatarClear,
            onPushEnable: actions.onPushEnable,
            onPushDisable: actions.onPushDisable,
            onNotifyInAppEnable: actions.onNotifyInAppEnable,
            onNotifyInAppDisable: actions.onNotifyInAppDisable,
            onNotifySoundEnable: actions.onNotifySoundEnable,
            onNotifySoundDisable: actions.onNotifySoundDisable,
            onForcePwaUpdate: actions.onForcePwaUpdate,
          })
        ),
      pageChanged
    );
  } else if (state.page === "sessions") {
    renderDeferredCenterPage(
      layout,
      state,
      "sessions",
      sessionsPageRuntime,
      () =>
        import("../pages/profile/createSessionsPage").then(({ createSessionsPage }) =>
          createSessionsPage({
            onBackToProfile: () => actions.onSetPage("profile"),
            onRefresh: actions.onSessionsRefresh,
            onLogoutOthers: actions.onSessionsLogoutOthers,
          })
        ),
      pageChanged
    );
  } else if (state.page === "user") {
    renderDeferredCenterPage(
      layout,
      state,
      "user",
      userPageRuntime,
      () =>
        import("../pages/user/createUserPage").then(({ createUserPage }) =>
          createUserPage({
            onBack: () => actions.onSetPage("main"),
            onOpenChat: (id: string) => {
              actions.onSetPage("main");
              actions.onSelectTarget({ kind: "dm", id });
            },
          })
        ),
      pageChanged
    );
  } else if (state.page === "group") {
    renderDeferredCenterPage(
      layout,
      state,
      "group",
      groupPageRuntime,
      () =>
        import("../pages/room/createRoomPage").then(({ createRoomPage }) =>
          createRoomPage("group", {
            onBack: () => actions.onSetPage("main"),
            onOpenChat: (id: string) => {
              actions.onSetPage("main");
              actions.onSelectTarget({ kind: "group", id });
            },
            onOpenFiles: () => actions.onSetPage("files"),
            onOpenUser: (id: string) => actions.onOpenUser(id),
            onGroupJoin: actions.onGroupJoin,
            onBoardJoin: actions.onBoardJoin,
            onGroupInviteAccept: actions.onGroupInviteAccept,
            onGroupInviteDecline: actions.onGroupInviteDecline,
            onGroupJoinAccept: actions.onGroupJoinAccept,
            onGroupJoinDecline: actions.onGroupJoinDecline,
            onBoardInviteJoin: actions.onBoardInviteJoin,
            onBoardInviteDecline: actions.onBoardInviteDecline,
            onRemoveMember: (kind, roomId, memberId) => actions.onRoomMemberRemove(kind, roomId, memberId),
            onBlockToggle: (memberId) => actions.onBlockToggle(memberId),
            onWriteToggle: (kind, roomId, memberId, value) => actions.onRoomWriteToggle(kind, roomId, memberId, value),
            onRefresh: (kind, roomId) => actions.onRoomRefresh(kind, roomId),
            onInfoSave: (kind, roomId, description, rules) => actions.onRoomInfoSave(kind, roomId, description, rules),
            onLeave: (kind, roomId) => actions.onRoomLeave(kind, roomId),
            onDisband: (kind, roomId) => actions.onRoomDisband(kind, roomId),
          })
        ),
      pageChanged
    );
  } else if (state.page === "board") {
    renderDeferredCenterPage(
      layout,
      state,
      "board",
      boardPageRuntime,
      () =>
        import("../pages/room/createRoomPage").then(({ createRoomPage }) =>
          createRoomPage("board", {
            onBack: () => actions.onSetPage("main"),
            onOpenChat: (id: string) => {
              actions.onSetPage("main");
              actions.onSelectTarget({ kind: "board", id });
            },
            onOpenFiles: () => actions.onSetPage("files"),
            onOpenUser: (id: string) => actions.onOpenUser(id),
            onGroupJoin: actions.onGroupJoin,
            onBoardJoin: actions.onBoardJoin,
            onGroupInviteAccept: actions.onGroupInviteAccept,
            onGroupInviteDecline: actions.onGroupInviteDecline,
            onGroupJoinAccept: actions.onGroupJoinAccept,
            onGroupJoinDecline: actions.onGroupJoinDecline,
            onBoardInviteJoin: actions.onBoardInviteJoin,
            onBoardInviteDecline: actions.onBoardInviteDecline,
            onRemoveMember: (kind, roomId, memberId) => actions.onRoomMemberRemove(kind, roomId, memberId),
            onBlockToggle: (memberId) => actions.onBlockToggle(memberId),
            onWriteToggle: (kind, roomId, memberId, value) => actions.onRoomWriteToggle(kind, roomId, memberId, value),
            onRefresh: (kind, roomId) => actions.onRoomRefresh(kind, roomId),
            onInfoSave: (kind, roomId, description, rules) => actions.onRoomInfoSave(kind, roomId, description, rules),
            onLeave: (kind, roomId) => actions.onRoomLeave(kind, roomId),
            onDisband: (kind, roomId) => actions.onRoomDisband(kind, roomId),
          })
        ),
      pageChanged
    );
  } else if (state.page === "files") {
    renderDeferredCenterPage(
      layout,
      state,
      "files",
      filesPageRuntime,
      () =>
        import("../pages/files/createFilesPage").then(({ createFilesPage }) =>
          createFilesPage({
            onFileSend: actions.onFileSend,
            onFileOfferAccept: actions.onFileOfferAccept,
            onFileOfferReject: actions.onFileOfferReject,
            onClearCompleted: actions.onClearCompletedFiles,
            onAutoDownloadPrefsSave: actions.onAutoDownloadPrefsSave,
            onOpenUser: actions.onOpenUser,
          })
        ),
      pageChanged
    );
  }

  if (showRightPanel && rightTarget) {
    const { shell, title, body } = ensureRightPanelShell(actions);
    if (rightTarget.kind === "dm") {
      title.textContent = getRightPanelTitle(rightTarget);
      if (rightUserPageRuntime.page) {
        const viewState = applyRightPanelViewState(state, rightTarget);
        rightUserPageRuntime.page.update(viewState);
        body.replaceChildren(rightUserPageRuntime.page.root);
      } else {
        body.replaceChildren(ensureDeferredRightPanelShell(rightUserPageRuntime));
        ensureDeferredRightPanelLoaded(
          rightUserPageRuntime,
          () =>
            import("../pages/user/createUserPage").then(({ createUserPage }) =>
              createUserPage({
                onBack: actions.onCloseRightPanel,
                onOpenChat: (id: string) => actions.onSelectTarget({ kind: "dm", id }),
              })
            ),
          (page) => {
            const activeLayout = latestDeferredRenderLayout;
            const activeState = latestDeferredRenderState;
            if (!activeLayout || !activeState) return;
            const activeTarget = getRightPanelTarget(activeState);
            if (!activeTarget || activeTarget.kind !== "dm") return;
            const { shell, title, body } = ensureRightPanelShell(actions);
            title.textContent = getRightPanelTitle(activeTarget);
            const viewState = applyRightPanelViewState(activeState, activeTarget);
            page.update(viewState);
            body.replaceChildren(page.root);
            mountRightCol(activeLayout, shell);
          }
        );
      }
    } else if (rightTarget.kind === "group") {
      title.textContent = getRightPanelTitle(rightTarget);
      if (rightGroupPageRuntime.page) {
        const viewState = applyRightPanelViewState(state, rightTarget);
        rightGroupPageRuntime.page.update(viewState);
        body.replaceChildren(rightGroupPageRuntime.page.root);
      } else {
        body.replaceChildren(ensureDeferredRightPanelShell(rightGroupPageRuntime));
        ensureDeferredRightPanelLoaded(
          rightGroupPageRuntime,
          () =>
            import("../pages/room/createRoomPage").then(({ createRoomPage }) =>
              createRoomPage("group", {
                onBack: actions.onCloseRightPanel,
                onOpenChat: (id: string) => actions.onSelectTarget({ kind: "group", id }),
                onOpenFiles: () => actions.onSetPage("files"),
                onOpenUser: (id: string) => actions.onOpenUser(id),
                onGroupJoin: actions.onGroupJoin,
                onBoardJoin: actions.onBoardJoin,
                onGroupInviteAccept: actions.onGroupInviteAccept,
                onGroupInviteDecline: actions.onGroupInviteDecline,
                onGroupJoinAccept: actions.onGroupJoinAccept,
                onGroupJoinDecline: actions.onGroupJoinDecline,
                onBoardInviteJoin: actions.onBoardInviteJoin,
                onBoardInviteDecline: actions.onBoardInviteDecline,
                onRemoveMember: (kind, roomId, memberId) => actions.onRoomMemberRemove(kind, roomId, memberId),
                onBlockToggle: (memberId) => actions.onBlockToggle(memberId),
                onWriteToggle: (kind, roomId, memberId, value) => actions.onRoomWriteToggle(kind, roomId, memberId, value),
                onRefresh: (kind, roomId) => actions.onRoomRefresh(kind, roomId),
                onInfoSave: (kind, roomId, description, rules) => actions.onRoomInfoSave(kind, roomId, description, rules),
                onLeave: (kind, roomId) => actions.onRoomLeave(kind, roomId),
                onDisband: (kind, roomId) => actions.onRoomDisband(kind, roomId),
              })
            ),
          (page) => {
            const activeLayout = latestDeferredRenderLayout;
            const activeState = latestDeferredRenderState;
            if (!activeLayout || !activeState) return;
            const activeTarget = getRightPanelTarget(activeState);
            if (!activeTarget || activeTarget.kind !== "group") return;
            const { shell, title, body } = ensureRightPanelShell(actions);
            title.textContent = getRightPanelTitle(activeTarget);
            const viewState = applyRightPanelViewState(activeState, activeTarget);
            page.update(viewState);
            body.replaceChildren(page.root);
            mountRightCol(activeLayout, shell);
          }
        );
      }
    } else if (rightTarget.kind === "board") {
      title.textContent = getRightPanelTitle(rightTarget);
      if (rightBoardPageRuntime.page) {
        const viewState = applyRightPanelViewState(state, rightTarget);
        rightBoardPageRuntime.page.update(viewState);
        body.replaceChildren(rightBoardPageRuntime.page.root);
      } else {
        body.replaceChildren(ensureDeferredRightPanelShell(rightBoardPageRuntime));
        ensureDeferredRightPanelLoaded(
          rightBoardPageRuntime,
          () =>
            import("../pages/room/createRoomPage").then(({ createRoomPage }) =>
              createRoomPage("board", {
                onBack: actions.onCloseRightPanel,
                onOpenChat: (id: string) => actions.onSelectTarget({ kind: "board", id }),
                onOpenFiles: () => actions.onSetPage("files"),
                onOpenUser: (id: string) => actions.onOpenUser(id),
                onGroupJoin: actions.onGroupJoin,
                onBoardJoin: actions.onBoardJoin,
                onGroupInviteAccept: actions.onGroupInviteAccept,
                onGroupInviteDecline: actions.onGroupInviteDecline,
                onGroupJoinAccept: actions.onGroupJoinAccept,
                onGroupJoinDecline: actions.onGroupJoinDecline,
                onBoardInviteJoin: actions.onBoardInviteJoin,
                onBoardInviteDecline: actions.onBoardInviteDecline,
                onRemoveMember: (kind, roomId, memberId) => actions.onRoomMemberRemove(kind, roomId, memberId),
                onBlockToggle: (memberId) => actions.onBlockToggle(memberId),
                onWriteToggle: (kind, roomId, memberId, value) => actions.onRoomWriteToggle(kind, roomId, memberId, value),
                onRefresh: (kind, roomId) => actions.onRoomRefresh(kind, roomId),
                onInfoSave: (kind, roomId, description, rules) => actions.onRoomInfoSave(kind, roomId, description, rules),
                onLeave: (kind, roomId) => actions.onRoomLeave(kind, roomId),
                onDisband: (kind, roomId) => actions.onRoomDisband(kind, roomId),
              })
            ),
          (page) => {
            const activeLayout = latestDeferredRenderLayout;
            const activeState = latestDeferredRenderState;
            if (!activeLayout || !activeState) return;
            const activeTarget = getRightPanelTarget(activeState);
            if (!activeTarget || activeTarget.kind !== "board") return;
            const { shell, title, body } = ensureRightPanelShell(actions);
            title.textContent = getRightPanelTitle(activeTarget);
            const viewState = applyRightPanelViewState(activeState, activeTarget);
            page.update(viewState);
            body.replaceChildren(page.root);
            mountRightCol(activeLayout, shell);
          }
        );
      }
    }
    mountRightCol(layout, shell);
  } else {
    layout.rightCol.replaceChildren();
  }

  renderFooter(layout.footer, state);
  renderToast(layout.toastHost, state.toast);

  applyOverlaySurface(layout.overlay, modalPresentation.overlaySurface, modalNode);
  if (!modalPresentation.overlaySurface || !modalNode) {
    overlayState.__ctxMenuKey = null;
  }

  if (authModalVisible) {
    // Preserve typed credentials across re-renders (e.g. connection status updates, skin list load).
    const idEl = document.getElementById("auth-id") as HTMLInputElement | null;
    const pwEl = document.getElementById("auth-manual-entry") as HTMLInputElement | null;
    const pw1El = document.getElementById("auth-manual-entry-a") as HTMLInputElement | null;
    const pw2El = document.getElementById("auth-manual-entry-b") as HTMLInputElement | null;
    preserveAuthModalInputs({
      hadAuthModal,
      prev: { id: prevAuthId, pw: prevAuthPw, pw1: prevAuthPw1, pw2: prevAuthPw2 },
      next: { idEl, pwEl, pw1El, pw2El },
    });

    queueMicrotask(() => {
      const id = document.getElementById("auth-id") as HTMLInputElement | null;
      const pw = document.getElementById("auth-manual-entry") as HTMLInputElement | null;
      const pw1 = document.getElementById("auth-manual-entry-a") as HTMLInputElement | null;
      const pw2 = document.getElementById("auth-manual-entry-b") as HTMLInputElement | null;
      const skin = document.getElementById("auth-skin") as HTMLSelectElement | null;
      if (prevActiveId === "auth-skin" && skin) skin.focus();
      else if (prevActiveId === "auth-manual-entry-b" && pw2) focusElement(pw2);
      else if (prevActiveId === "auth-manual-entry-a" && pw1) focusElement(pw1);
      else if (prevActiveId === "auth-manual-entry" && pw) focusElement(pw);
      else if (prevActiveId === "auth-id" && id) focusElement(id);
      else if (!hadAuthModal) {
        if (state.authMode === "register" && pw1) focusElement(pw1);
        else if (state.authMode === "login") {
          if (id && !id.value) focusElement(id);
          else if (pw) focusElement(pw);
          else if (id) focusElement(id);
        } else if (id) {
          focusElement(id);
        }
      }
    });
  }

  if (state.modal?.kind === "members_add") {
    const input = document.getElementById("members-add-input") as HTMLInputElement | null;
    const entry = document.getElementById("members-add-entry") as HTMLInputElement | null;
    if (input && input.value !== prevMembersAdd) input.value = prevMembersAdd;
    if (entry && entry.value !== prevMembersAddEntry) entry.value = prevMembersAddEntry;
    queueMicrotask(() => {
      focusElement(entry);
    });
  }

  if (state.modal?.kind === "members_remove") {
    const input = document.getElementById("members-remove-input") as HTMLInputElement | null;
    if (input && input.value !== prevMembersRemove) input.value = prevMembersRemove;
    queueMicrotask(() => {
      focusElement(input, { select: true });
    });
  }

  if (state.modal?.kind === "file_send") {
    const input = document.getElementById("file-send-caption") as HTMLTextAreaElement | null;
    if (input && prevFileSendCaption && input.value !== prevFileSendCaption) input.value = prevFileSendCaption;
    queueMicrotask(() => {
      if (!input) return;
      if (prevActiveId === "file-send-caption") {
        focusElement(input);
      } else if (!hadFileSendModal && !input.disabled) {
        focusElement(input);
      }
    });
  }

  if (state.modal?.kind === "board_post") {
    const input = document.getElementById("board-post-text") as HTMLTextAreaElement | null;
    if (input && input.value !== prevBoardPostText) {
      input.value = prevBoardPostText;
      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } catch {
        // ignore
      }
    }
    queueMicrotask(() => {
      if (!input) return;
      if (prevActiveId === "board-post-text") {
        focusElement(input);
      } else if (!hadBoardPostModal) {
        focusElement(input);
      }
    });
  }

  if (state.modal?.kind === "rename") {
    const input = document.getElementById("rename-name") as HTMLInputElement | null;
    if (input && input.value !== prevRename) input.value = prevRename;
    queueMicrotask(() => {
      focusElement(input, { select: true });
    });
  }

  if (state.modal?.kind === "send_schedule") {
    const input = document.getElementById("send-schedule-at") as HTMLInputElement | null;
    if (input && hadSendScheduleModal && input.value !== prevSendScheduleAt) input.value = prevSendScheduleAt;
    queueMicrotask(() => {
      if (!input) return;
      if (prevActiveId === "send-schedule-at") {
        focusElement(input);
      } else if (!hadSendScheduleModal && !input.disabled) {
        focusElement(input);
      }
    });
  }

  if (state.modal?.kind === "confirm") {
    queueMicrotask(() => {
      const host = inlineModal ? layout.chat : layout.overlay;
      const btn = host.querySelector(".modal .btn") as HTMLButtonElement | null;
      if (btn) btn.focus();
    });
  }

  if (state.modal?.kind === "action") {
    queueMicrotask(() => {
      const host = inlineModal ? layout.chat : layout.overlay;
      const btn = host.querySelector(".modal .btn") as HTMLButtonElement | null;
      if (btn) btn.focus();
    });
  }

  if (state.modal?.kind === "logout") {
    queueMicrotask(() => {
      const btn = layout.overlay.querySelector(".modal-logout .btn") as HTMLButtonElement | null;
      if (btn) focusElement(btn);
    });
  }
}
