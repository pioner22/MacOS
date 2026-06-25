import {
  isProgressiveMediaControllerPending,
  resolveProgressiveMediaUrl,
  waitForProgressiveMediaController,
} from "../../../helpers/files/progressiveMedia";
import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";

export function markProgressiveAudioTransferReady(params: {
  store: Store<AppState>;
  fileId: string;
  url: string;
  name: string;
  size: number;
  mime: string | null | undefined;
  silent: boolean;
  nextTransferId: () => string;
  scheduleSaveFileTransfers: () => void;
  clearSilentFileGet: (fileId: string) => void;
  finishFileGet: (fileId: string) => void;
  debugHook?: (kind: string, data?: any) => void;
}): boolean {
  const { store, fileId, url, name, size, mime, silent } = params;
  const progressiveUrl = resolveProgressiveMediaUrl({ fileId, url, name, size, mime });
  if (!progressiveUrl) return false;

  store.set((prev) => {
    const current = Array.isArray(prev.fileTransfers) ? prev.fileTransfers : [];
    const idx = current.findIndex((entry) => entry.id === fileId || entry.localId === fileId);
    const base = idx >= 0 ? current[idx] : null;
    const nextEntry: FileTransferEntry = {
      localId: base?.localId || params.nextTransferId(),
      id: base?.id || fileId,
      name: name || base?.name || fileId,
      size: size || base?.size || 0,
      direction: base?.direction || "in",
      peer: base?.peer || "—",
      room: base?.room ?? null,
      status: "complete",
      progress: 100,
      url: progressiveUrl,
      error: null,
      ...(mime || base?.mime ? { mime: mime || base?.mime || null } : {}),
      ...(base?.acceptedBy ? { acceptedBy: base.acceptedBy } : {}),
      ...(base?.receivedBy ? { receivedBy: base.receivedBy } : {}),
    };
    const transfers = idx >= 0 ? current.map((entry, index) => (index === idx ? nextEntry : entry)) : [nextEntry, ...current];
    return applyFileTransferMutation(prev, transfers);
  });
  params.scheduleSaveFileTransfers();
  params.clearSilentFileGet(fileId);
  params.finishFileGet(fileId);
  if (!silent) store.set({ status: `Аудио готово к воспроизведению: ${name || fileId}` });
  params.debugHook?.("file.audio.progressive_ready", { fileId, name, size, mime: mime || null });
  return true;
}

export function handleProgressiveAudioFileUrl(params: {
  store: Store<AppState>;
  fileId: string;
  url: string;
  name: string;
  size: number;
  mime: string | null | undefined;
  silent: boolean;
  nextTransferId: () => string;
  scheduleSaveFileTransfers: () => void;
  clearSilentFileGet: (fileId: string) => void;
  finishFileGet: (fileId: string) => void;
  updateTransferByFileId: (fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => void;
  send: (payload: any) => void;
  touchFileGetTimeout: (fileId: string) => void;
  debugHook?: (kind: string, data?: any) => void;
}): boolean {
  const ready = markProgressiveAudioTransferReady(params);
  if (ready) return true;
  const { store, fileId, url, name, size, mime, silent } = params;
  if (!isProgressiveMediaControllerPending({ fileId, url, name, size, mime })) return false;

  params.debugHook?.("file.audio.wait_controller", { fileId, name, size, mime: mime || null, silent });
  void waitForProgressiveMediaController().then((controllerReady) => {
    if (!controllerReady) {
      params.clearSilentFileGet(fileId);
      params.finishFileGet(fileId);
      params.updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "offering", progress: 0, error: null }));
      if (!silent) store.set({ status: "Аудио будет доступно после повторного запуска воспроизведения" });
      return;
    }
    try {
      params.send({ type: "file_get", file_id: fileId });
      params.touchFileGetTimeout(fileId);
      params.debugHook?.("file.audio.retry_after_controller", { fileId, name, size, mime: mime || null, silent });
    } catch {
      params.clearSilentFileGet(fileId);
      params.finishFileGet(fileId);
    }
  });
  return true;
}
