import type { AppState } from "../../stores/types";
import { renderMembersAddModal } from "./renderMembersAddModal";
import { renderMembersRemoveModal } from "./renderMembersRemoveModal";
import { renderRenameModal } from "./renderRenameModal";
import { renderFileSendModal } from "./renderFileSendModal";
import { renderInviteUserModal } from "./renderInviteUserModal";
import { renderActionModal } from "./renderActionModal";
import { renderBoardPostModal } from "./renderBoardPostModal";
import { renderSendScheduleModal } from "./renderSendScheduleModal";
import { renderReactionsModal } from "./renderReactionsModal";
import type { ModalActions } from "./renderModal";

export function renderSecondaryModal(state: AppState, actions: ModalActions): HTMLElement | null {
  const modal = state.modal;
  if (!modal) return null;
  const kind = modal.kind;

  if (kind === "reactions") {
    return renderReactionsModal(state, modal, { onClose: actions.onClose });
  }

  if (kind === "send_schedule") {
    const canWhenOnline = (() => {
      const t = modal.target;
      if (modal.edit) return false;
      if (!t || t.kind !== "dm") return false;
      const peerId = String(t.id || "").trim();
      if (!peerId) return false;
      const friend = (state.friends || []).find((f) => String(f.id || "").trim() === peerId);
      return Boolean(friend && !friend.online);
    })();
    return renderSendScheduleModal(modal.text, modal.suggestedAt, modal.message, modal.title, modal.confirmLabel, {
      onSchedule: actions.onSendSchedule,
      ...(canWhenOnline ? { onWhenOnline: actions.onSendScheduleWhenOnline } : {}),
      onCancel: actions.onClose,
    });
  }

  if (kind === "board_post") {
    const bid = String(modal.boardId || "").trim();
    const b = bid ? (state.boards || []).find((x) => x.id === bid) : null;
    const label = String(b?.name || bid || "—");
    return renderBoardPostModal(label, {
      onPublish: actions.onBoardPostPublish,
      onCancel: actions.onClose,
    });
  }

  if (kind === "members_add") {
    return renderMembersAddModal(modal.title, modal.targetKind, modal.message, {
      onAdd: actions.onMembersAdd,
      onCancel: actions.onClose,
    });
  }

  if (kind === "members_remove") {
    return renderMembersRemoveModal(modal.title, modal.targetKind, modal.message, {
      onRemove: actions.onMembersRemove,
      onCancel: actions.onClose,
    });
  }

  if (kind === "rename") {
    return renderRenameModal(modal.title, modal.targetKind, modal.currentName, modal.message, {
      onRename: actions.onRename,
      onCancel: actions.onClose,
    });
  }

  if (kind === "file_send") {
    return renderFileSendModal(
      modal.files,
      modal.caption ?? "",
      { previewUrls: modal.previewUrls, captionDisabled: modal.captionDisabled, captionHint: modal.captionHint },
      {
        onSend: actions.onFileSendConfirm,
        onCancel: actions.onClose,
      }
    );
  }

  if (kind === "invite_user") {
    return renderInviteUserModal(modal.peer, state.selfId ?? null, state.groups || [], state.boards || [], modal.message, {
      onInvite: actions.onInviteUser,
      onCancel: actions.onClose,
    });
  }

  if (kind === "action") {
    return renderActionModal(modal.payload, modal.message, {
      onClose: actions.onClose,
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
    });
  }

  return null;
}
