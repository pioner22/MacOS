import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";

export interface FileTransferStateFeatureDeps {
  store: Store<AppState>;
  scheduleSaveFileTransfers: () => void;
}

export interface FileTransferStateFeature {
  updateTransferByLocalId: (localId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => void;
  updateTransferByFileId: (fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => void;
  updateConversationFileMessage: (key: string, localId: string, apply: (msg: any) => any) => void;
  removeConversationFileMessage: (key: string, localId: string) => void;
}

export function createFileTransferStateFeature(deps: FileTransferStateFeatureDeps): FileTransferStateFeature {
  const { store, scheduleSaveFileTransfers } = deps;

  const updateTransfers = (match: (entry: FileTransferEntry) => boolean, apply: (entry: FileTransferEntry) => FileTransferEntry) => {
    store.set((prev) => {
      let changed = false;
      const next = prev.fileTransfers.map((entry) => {
        if (!match(entry)) return entry;
        changed = true;
        return apply(entry);
      });
      return changed ? applyFileTransferMutation(prev, next) : prev;
    });
    scheduleSaveFileTransfers();
  };

  const updateTransferByLocalId = (localId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => {
    updateTransfers((entry) => entry.localId === localId, apply);
  };

  const updateTransferByFileId = (fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => {
    updateTransfers((entry) => entry.id === fileId, apply);
  };

  const updateConversationFileMessage = (key: string, localId: string, apply: (msg: any) => any) => {
    store.set((prev) => {
      const conv = prev.conversations[key];
      if (!Array.isArray(conv) || conv.length === 0) return prev;
      const idx = conv.findIndex(
        (m: any) => m?.attachment?.kind === "file" && String(m.attachment?.localId ?? "") === String(localId)
      );
      if (idx < 0) return prev;
      const next = [...conv];
      next[idx] = apply(next[idx]);
      return { ...prev, conversations: { ...prev.conversations, [key]: next } };
    });
  };

  const removeConversationFileMessage = (key: string, localId: string) => {
    const lid = String(localId || "").trim();
    if (!lid) return;
    store.set((prev) => {
      const conv = prev.conversations[key];
      if (!Array.isArray(conv) || conv.length === 0) return prev;
      const next = conv.filter((m: any) => String(m?.attachment?.localId ?? "") !== lid);
      if (next.length === conv.length) return prev;
      return { ...prev, conversations: { ...prev.conversations, [key]: next } };
    });
  };

  return {
    updateTransferByLocalId,
    updateTransferByFileId,
    updateConversationFileMessage,
    removeConversationFileMessage,
  };
}
