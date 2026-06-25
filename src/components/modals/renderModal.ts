import type { AppState, TargetRef } from "../../stores/types";
import { el } from "../../helpers/dom/el";
import { renderAuthModal } from "./renderAuthModal";
import { renderUpdateModal } from "./renderUpdateModal";
import { renderPwaUpdateModal } from "./renderPwaUpdateModal";
import { renderDesktopUpdateModal } from "./renderDesktopUpdateModal";
import { renderWelcomeModal } from "./renderWelcomeModal";
import { renderLogoutModal } from "./renderLogoutModal";
import { renderConfirmModal } from "./renderConfirmModal";
import { renderContextMenu } from "./renderContextMenu";
type HeavyModalModule = typeof import("./renderHeavyModal");
type SecondaryModalModule = typeof import("./renderSecondaryModal");
type ForwardSelectModal = Extract<NonNullable<AppState["modal"]>, { kind: "forward_select" }>;
type FileViewerModal = Extract<NonNullable<AppState["modal"]>, { kind: "file_viewer" }>;
type SecondaryModalKind =
  | "reactions"
  | "send_schedule"
  | "board_post"
  | "members_add"
  | "members_remove"
  | "rename"
  | "file_send"
  | "invite_user"
  | "action";

let heavyModalModule: HeavyModalModule | null = null;
let heavyModalPromise: Promise<HeavyModalModule | null> | null = null;
let heavyModalLoadFailed = false;
let secondaryModalModule: SecondaryModalModule | null = null;
let secondaryModalPromise: Promise<SecondaryModalModule | null> | null = null;
let secondaryModalLoadFailed = false;
let forwardHost: HTMLElement | null = null;
let latestForwardState: AppState | null = null;
let latestForwardModal: ForwardSelectModal | null = null;
let latestForwardActions: ModalActions | null = null;
let fileViewerHost: HTMLElement | null = null;
let latestFileViewerState: AppState | null = null;
let latestFileViewerModal: FileViewerModal | null = null;
let latestFileViewerActions: ModalActions | null = null;
let secondaryHost: HTMLElement | null = null;
let latestSecondaryState: AppState | null = null;
let latestSecondaryActions: ModalActions | null = null;

function createDeferredModalShell(className: string, title: string, message: string): HTMLElement {
  return el("div", { class: `modal ${className} modal-deferred`, role: "status", "aria-live": "polite", "aria-busy": "true" }, [
    el("div", { class: "modal-title" }, [title]),
    el("div", { class: "modal-line modal-copy" }, [message]),
  ]);
}

function secondaryModalTitle(kind: SecondaryModalKind | null | undefined): string {
  if (kind === "reactions") return "Реакции";
  if (kind === "send_schedule") return "Отложенная отправка";
  if (kind === "board_post") return "Публикация";
  if (kind === "members_add") return "Добавить участников";
  if (kind === "members_remove") return "Удалить участников";
  if (kind === "rename") return "Переименовать";
  if (kind === "file_send") return "Отправка файлов";
  if (kind === "invite_user") return "Приглашение";
  if (kind === "action") return "Действие";
  return "Окно";
}

function setForwardPlaceholder(message: string) {
  if (!forwardHost) return;
  forwardHost.replaceChildren(createDeferredModalShell("modal-forward", "Переслать", message));
}

function setFileViewerPlaceholder(message: string) {
  if (!fileViewerHost) return;
  fileViewerHost.replaceChildren(createDeferredModalShell("modal-viewer", "Файл", message));
}

function setSecondaryPlaceholder(message: string) {
  if (!secondaryHost) return;
  const kind =
    latestSecondaryState?.modal && latestSecondaryState.modal.kind !== "forward_select" && latestSecondaryState.modal.kind !== "file_viewer"
      ? (latestSecondaryState.modal.kind as SecondaryModalKind)
      : null;
  secondaryHost.replaceChildren(createDeferredModalShell("modal-secondary", secondaryModalTitle(kind), message));
}

function refreshDeferredHeavyModals() {
  if (forwardHost) {
    if (heavyModalModule && latestForwardState && latestForwardModal && latestForwardActions) {
      const node = heavyModalModule.renderForwardSelectModal(latestForwardState, latestForwardModal, {
        onClose: latestForwardActions.onClose,
        onForwardSend: latestForwardActions.onForwardSend,
      });
      if (node) forwardHost.replaceChildren(node);
      else setForwardPlaceholder("Нет сообщений для пересылки");
    } else {
      setForwardPlaceholder(heavyModalLoadFailed ? "Не удалось загрузить окно пересылки" : "Загрузка окна пересылки…");
    }
  }

  if (fileViewerHost) {
    if (heavyModalModule && latestFileViewerState && latestFileViewerModal && latestFileViewerActions) {
      fileViewerHost.replaceChildren(
        heavyModalModule.renderFileViewerHeavyModal(latestFileViewerState, latestFileViewerModal, {
          onClose: latestFileViewerActions.onClose,
          onFileViewerNavigate: latestFileViewerActions.onFileViewerNavigate,
          onFileViewerJump: latestFileViewerActions.onFileViewerJump,
          ...(latestFileViewerActions.onFileViewerRecover ? { onFileViewerRecover: latestFileViewerActions.onFileViewerRecover } : {}),
          onFileViewerShare: latestFileViewerActions.onFileViewerShare,
          onFileViewerForward: latestFileViewerActions.onFileViewerForward,
          onFileViewerDelete: latestFileViewerActions.onFileViewerDelete,
          onFileViewerOpenAt: latestFileViewerActions.onFileViewerOpenAt,
        })
      );
    } else {
      setFileViewerPlaceholder(heavyModalLoadFailed ? "Не удалось загрузить просмотр файла" : "Загрузка файла…");
    }
  }
}

function refreshDeferredSecondaryModal() {
  if (!secondaryHost) return;
  if (secondaryModalModule && latestSecondaryState && latestSecondaryActions) {
    const node = secondaryModalModule.renderSecondaryModal(latestSecondaryState, latestSecondaryActions);
    if (node) {
      secondaryHost.replaceChildren(node);
      return;
    }
  }
  setSecondaryPlaceholder(secondaryModalLoadFailed ? "Не удалось загрузить окно" : "Загрузка окна…");
}

function ensureHeavyModalModule() {
  if (heavyModalModule || heavyModalPromise) return;
  heavyModalPromise = import("./renderHeavyModal")
    .then((mod) => {
      heavyModalModule = mod;
      heavyModalLoadFailed = false;
      refreshDeferredHeavyModals();
      return mod;
    })
    .catch(() => {
      heavyModalLoadFailed = true;
      refreshDeferredHeavyModals();
      return null;
    })
    .finally(() => {
      heavyModalPromise = null;
    });
}

function ensureSecondaryModalModule() {
  if (secondaryModalModule || secondaryModalPromise) return;
  secondaryModalPromise = import("./renderSecondaryModal")
    .then((mod) => {
      secondaryModalModule = mod;
      secondaryModalLoadFailed = false;
      refreshDeferredSecondaryModal();
      return mod;
    })
    .catch(() => {
      secondaryModalLoadFailed = true;
      refreshDeferredSecondaryModal();
      return null;
    })
    .finally(() => {
      secondaryModalPromise = null;
    });
}

function ensureForwardHost(): HTMLElement {
  if (forwardHost) return forwardHost;
  forwardHost = el("div", { class: "deferred-modal-host deferred-forward-host" }, []);
  (forwardHost as any).__disposeForwardModal = () => {
    latestForwardState = null;
    latestForwardModal = null;
    latestForwardActions = null;
    setForwardPlaceholder("Загрузка окна пересылки…");
  };
  setForwardPlaceholder("Загрузка окна пересылки…");
  return forwardHost;
}

function ensureFileViewerHost(): HTMLElement {
  if (fileViewerHost) return fileViewerHost;
  fileViewerHost = el("div", { class: "deferred-modal-host deferred-file-viewer-host" }, []);
  setFileViewerPlaceholder("Загрузка файла…");
  return fileViewerHost;
}

function ensureSecondaryHost(): HTMLElement {
  if (secondaryHost) return secondaryHost;
  secondaryHost = el("div", { class: "deferred-modal-host deferred-secondary-host" }, []);
  setSecondaryPlaceholder("Загрузка окна…");
  return secondaryHost;
}

export interface ModalActions {
  onAuthLogin: () => void;
  onAuthRegister: () => void;
  onAuthTouchId: () => void;
  onAuthModeChange: (mode: "register" | "login") => void;
  onAuthOpen: () => void;
  onAuthUseDifferentAccount: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onBoardPostPublish: (text: string) => void;
  onDismissUpdate: () => void;
  onReloadUpdate: () => void;
  onApplyPwaUpdate: () => void;
  onDeferPwaUpdate: () => void;
  onDesktopUpdateCheck: () => void;
  onDesktopUpdateDownload: () => void;
  onDesktopUpdateInstall: () => void;
  onSkinChange: (skinId: string) => void;
  onMembersAdd: () => void;
  onMembersRemove: () => void;
  onRename: () => void;
  onSendSchedule: () => void;
  onSendScheduleWhenOnline: () => void;
  onInviteUser: () => void;
  onFileSendConfirm: (captionText: string) => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupInviteAccept: (groupId: string) => void;
  onGroupInviteDecline: (groupId: string) => void;
  onGroupJoinAccept: (groupId: string, peer: string) => void;
  onGroupJoinDecline: (groupId: string, peer: string) => void;
  onBoardInviteJoin: (boardId: string) => void;
  onBoardInviteDecline: (boardId: string) => void;
  onFileOfferAccept: (fileId: string) => void;
  onFileOfferReject: (fileId: string) => void;
  onContextMenuAction: (itemId: string) => void;
  onFileViewerNavigate: (dir: "prev" | "next") => void;
  onFileViewerJump: () => void;
  onFileViewerRecover?: () => void;
  onFileViewerShare: () => void;
  onFileViewerForward: () => void;
  onFileViewerDelete: () => void;
  onFileViewerOpenAt: (msgIdx: number) => void;
  onForwardSend: (targets: TargetRef[]) => void;
}

export function renderModal(state: AppState, actions: ModalActions): HTMLElement | null {
  const modal = state.modal;
  if (!modal) return null;
  const kind = modal.kind;
  if (kind === "auth") {
    return renderAuthModal(state.authMode, state.authRememberedId, modal.message, state.status, state.conn, state.skins, state.skin, {
      onLogin: actions.onAuthLogin,
      onRegister: actions.onAuthRegister,
      onTouchId: actions.onAuthTouchId,
      onModeChange: actions.onAuthModeChange,
      onUseDifferentAccount: actions.onAuthUseDifferentAccount,
      onSkinChange: actions.onSkinChange,
      onClose: actions.onClose,
    });
  }
  if (kind === "welcome") {
    return renderWelcomeModal(state.status, {
      authMode: state.authMode,
      rememberedId: state.authRememberedId,
      conn: state.conn,
    });
  }
  if (kind === "logout") {
    return renderLogoutModal(state.status, state.authRememberedId, {
      onClose: actions.onClose,
      onRelogin: actions.onAuthOpen,
      onUseDifferentAccount: actions.onAuthUseDifferentAccount,
    });
  }
  if (kind === "update") {
    return renderUpdateModal(state.clientVersion, state.updateLatest ?? "", {
      onDismiss: actions.onDismissUpdate,
      onReload: actions.onReloadUpdate,
    });
  }
  if (kind === "pwa_update") {
    return renderPwaUpdateModal(state.clientVersion, state.updateLatest ?? "", state.pwaUpdate, {
      onDismiss: actions.onDeferPwaUpdate,
      onApply: actions.onApplyPwaUpdate,
    });
  }
  if (kind === "desktop_update") {
    return renderDesktopUpdateModal(state.desktopUpdate, {
      onClose: actions.onClose,
      onCheck: actions.onDesktopUpdateCheck,
      onDownload: actions.onDesktopUpdateDownload,
      onInstall: actions.onDesktopUpdateInstall,
    });
  }
  if (kind === "forward_select") {
    latestForwardState = state;
    latestForwardModal = modal;
    latestForwardActions = actions;
    const host = ensureForwardHost();
    if (heavyModalModule) refreshDeferredHeavyModals();
    else ensureHeavyModalModule();
    return host;
  }
  if (kind === "confirm") {
    return renderConfirmModal(modal.title, modal.message, modal.confirmLabel, modal.cancelLabel, modal.danger, {
      onConfirm: actions.onConfirm,
      onCancel: actions.onClose,
    });
  }
  if (kind === "file_viewer") {
    const viewerChanged = latestFileViewerModal !== modal;
    latestFileViewerState = state;
    latestFileViewerModal = modal;
    latestFileViewerActions = actions;
    const host = ensureFileViewerHost();
    if (heavyModalModule) {
      if (viewerChanged || !host.firstElementChild) refreshDeferredHeavyModals();
    }
    else ensureHeavyModalModule();
    return host;
  }
  if (kind === "context_menu") {
    return renderContextMenu(modal.payload, {
      onClose: actions.onClose,
      onSelect: actions.onContextMenuAction,
    });
  }
  if (
    kind === "reactions" ||
    kind === "send_schedule" ||
    kind === "board_post" ||
    kind === "members_add" ||
    kind === "members_remove" ||
    kind === "rename" ||
    kind === "file_send" ||
    kind === "invite_user" ||
    kind === "action"
  ) {
    latestSecondaryState = state;
    latestSecondaryActions = actions;
    const host = ensureSecondaryHost();
    if (secondaryModalModule) refreshDeferredSecondaryModal();
    else ensureSecondaryModalModule();
    return host;
  }
  return null;
}
