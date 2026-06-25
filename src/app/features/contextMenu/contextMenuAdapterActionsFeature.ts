export interface ContextMenuAdapterActionsFeatureDeps {
  beginFileDownload: (fileId: string) => void;
  openEmojiPopoverForReaction: (target: { key: string; msgId: number }) => void;
  acceptAuth: (peer: string) => void;
  declineAuth: (peer: string) => void;
  cancelAuth: (peer: string) => void;
  pickAvatarFor: (kind: any, id: string) => void;
  removeAvatar: (kind: any, id: string) => void;
  drainOutbox: () => void;
  ensureVirtualHistoryIndexVisible: (key: string, convLen: number, idx: number, searchActive: boolean) => void;
}

export interface ContextMenuAdapterActionsFeature {
  beginFileDownload: (fileId: string) => void;
  openEmojiPopoverForReaction: (target: { key: string; msgId: number }) => void;
  acceptAuth: (peer: string) => void;
  declineAuth: (peer: string) => void;
  cancelAuth: (peer: string) => void;
  pickAvatarFor: (kind: any, id: string) => void;
  removeAvatar: (kind: any, id: string) => void;
  drainOutbox: () => void;
  ensureVirtualHistoryIndexVisible: (key: string, convLen: number, idx: number, searchActive: boolean) => void;
}

export function createContextMenuAdapterActionsFeature(deps: ContextMenuAdapterActionsFeatureDeps): ContextMenuAdapterActionsFeature {
  const {
    beginFileDownload,
    openEmojiPopoverForReaction,
    acceptAuth,
    declineAuth,
    cancelAuth,
    pickAvatarFor,
    removeAvatar,
    drainOutbox,
    ensureVirtualHistoryIndexVisible,
  } = deps;

  return {
    beginFileDownload,
    openEmojiPopoverForReaction,
    acceptAuth,
    declineAuth,
    cancelAuth,
    pickAvatarFor,
    removeAvatar,
    drainOutbox,
    ensureVirtualHistoryIndexVisible,
  };
}
