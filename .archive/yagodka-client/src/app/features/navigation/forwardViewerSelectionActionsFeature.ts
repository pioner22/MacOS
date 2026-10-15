import type { MessageHelperDraft, TargetRef } from "../../../stores/types";

interface ForwardActionsDeps {
  openForwardModal: (draftInput: MessageHelperDraft | MessageHelperDraft[]) => void;
  forwardFromFileViewer: () => void;
  sendForwardToTargets: (targets: TargetRef[]) => void;
  handleChatSelectionForward: () => void;
}

interface FileViewerActionsDeps {
  shareFromFileViewer: () => Promise<void>;
  deleteFromFileViewer: () => void;
}

interface ChatSelectionCopyDownloadDeps {
  handleChatSelectionCopy: () => Promise<void>;
  handleChatSelectionDownload: () => Promise<void>;
}

interface ChatSelectionSendDeleteDeps {
  handleChatSelectionSendNow: () => void;
  handleChatSelectionDelete: () => void;
}

interface ChatSelectionPinDeps {
  handleChatSelectionPin: () => void;
}

export interface ForwardViewerSelectionActionsFeatureDeps {
  forwardActions: ForwardActionsDeps;
  fileViewerActions: FileViewerActionsDeps;
  chatSelectionCopyDownload: ChatSelectionCopyDownloadDeps;
  chatSelectionSendDelete: ChatSelectionSendDeleteDeps;
  chatSelectionPin: ChatSelectionPinDeps;
}

export interface ForwardViewerSelectionActionsFeature {
  openForwardModal: (draftInput: MessageHelperDraft | MessageHelperDraft[]) => void;
  shareFromFileViewer: () => Promise<void>;
  forwardFromFileViewer: () => void;
  deleteFromFileViewer: () => void;
  sendForwardToTargets: (targets: TargetRef[]) => void;
  handleChatSelectionForward: () => void;
  handleChatSelectionCopy: () => Promise<void>;
  handleChatSelectionDownload: () => Promise<void>;
  handleChatSelectionSendNow: () => void;
  handleChatSelectionDelete: () => void;
  handleChatSelectionPin: () => void;
}

export function createForwardViewerSelectionActionsFeature(
  deps: ForwardViewerSelectionActionsFeatureDeps
): ForwardViewerSelectionActionsFeature {
  const { forwardActions, fileViewerActions, chatSelectionCopyDownload, chatSelectionSendDelete, chatSelectionPin } = deps;

  const openForwardModal = (draftInput: MessageHelperDraft | MessageHelperDraft[]) => {
    forwardActions.openForwardModal(draftInput);
  };

  const shareFromFileViewer = async () => {
    await fileViewerActions.shareFromFileViewer();
  };

  const forwardFromFileViewer = () => {
    forwardActions.forwardFromFileViewer();
  };

  const deleteFromFileViewer = () => {
    fileViewerActions.deleteFromFileViewer();
  };

  const sendForwardToTargets = (targets: TargetRef[]) => {
    forwardActions.sendForwardToTargets(targets);
  };

  const handleChatSelectionForward = () => {
    forwardActions.handleChatSelectionForward();
  };

  const handleChatSelectionCopy = async () => {
    await chatSelectionCopyDownload.handleChatSelectionCopy();
  };

  const handleChatSelectionDownload = async () => {
    await chatSelectionCopyDownload.handleChatSelectionDownload();
  };

  const handleChatSelectionSendNow = () => {
    chatSelectionSendDelete.handleChatSelectionSendNow();
  };

  const handleChatSelectionDelete = () => {
    chatSelectionSendDelete.handleChatSelectionDelete();
  };

  const handleChatSelectionPin = () => {
    chatSelectionPin.handleChatSelectionPin();
  };

  return {
    openForwardModal,
    shareFromFileViewer,
    forwardFromFileViewer,
    deleteFromFileViewer,
    sendForwardToTargets,
    handleChatSelectionForward,
    handleChatSelectionCopy,
    handleChatSelectionDownload,
    handleChatSelectionSendNow,
    handleChatSelectionDelete,
    handleChatSelectionPin,
  };
}
