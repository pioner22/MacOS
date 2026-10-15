import { getCachedFileBlob } from "../../../helpers/files/fileBlobCache";
import { isVideoLikeFile } from "../../../helpers/files/mediaKind";
import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";
import type { FileViewerModalParams, FileViewerModalState } from "./fileViewerFeature";

type FileViewerCacheMeta = {
  name: string;
  size: number;
  mime: string | null;
  caption?: string | null;
  chatKey?: string | null;
  msgIdx?: number | null;
};

export interface FileViewerCacheFeatureDeps {
  store: Store<AppState>;
  scheduleSaveFileTransfers: () => void;
}

export interface FileViewerCacheFeature {
  tryOpenFileViewerFromCache: (
    fileId: string,
    meta: FileViewerCacheMeta,
    buildModalState: (params: FileViewerModalParams) => FileViewerModalState
  ) => Promise<boolean>;
}

export function createFileViewerCacheFeature(deps: FileViewerCacheFeatureDeps): FileViewerCacheFeature {
  const { store, scheduleSaveFileTransfers } = deps;

  const tryOpenFileViewerFromCache = async (
    fileId: string,
    meta: FileViewerCacheMeta,
    buildModalState: (params: FileViewerModalParams) => FileViewerModalState
  ): Promise<boolean> => {
    const st = store.get();
    if (!st.selfId) return false;
    const cached = await getCachedFileBlob(st.selfId, fileId);
    if (!cached) return false;

    let url: string | null = null;
    try {
      url = URL.createObjectURL(cached.blob);
    } catch {
      url = null;
    }
    if (!url) return false;

    const entry = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
    const name = meta.name || entry?.name || "файл";
    const size = meta.size || entry?.size || cached.size || 0;
    const mime = meta.mime || entry?.mime || cached.mime || null;
    const caption = meta.caption ? String(meta.caption).trim() : "";
    const autoplay = isVideoLikeFile(name, mime);
    const direction = entry?.direction || "in";
    const peer = entry?.peer || "—";
    const room = typeof entry?.room === "string" ? entry.room : null;

    store.set((prev) => {
      const existing = prev.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
      const nextTransfers = (() => {
        if (existing) {
          return prev.fileTransfers.map<FileTransferEntry>((t) => {
            if (String(t.id || "").trim() !== fileId) return t;
            if (t.url && t.url !== url) {
              try {
                URL.revokeObjectURL(t.url);
              } catch {
                // ignore
              }
            }
            return { ...t, name, size, mime, status: "complete", progress: 100, url };
          });
        }
        const next: FileTransferEntry = {
          localId: `ft-cache-${fileId}`,
          id: fileId,
          name,
          size,
          mime,
          direction,
          peer,
          room,
          status: "complete",
          progress: 100,
          url,
        };
        return [next, ...prev.fileTransfers];
      })();

      return {
        ...applyFileTransferMutation(prev, nextTransfers),
        modal: buildModalState({
          fileId,
          url,
          name,
          size,
          mime,
          caption: caption || null,
          autoplay,
          chatKey: meta.chatKey ? String(meta.chatKey) : null,
          msgIdx: typeof meta.msgIdx === "number" && Number.isFinite(meta.msgIdx) ? meta.msgIdx : null,
        }),
      };
    });

    scheduleSaveFileTransfers();
    return true;
  };

  return { tryOpenFileViewerFromCache };
}
