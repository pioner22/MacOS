import type { AutoDownloadPrefs } from "../../../helpers/files/autoDownloadPrefs";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";

interface FileOffersLike {
  accept: (fileId: string) => void;
  reject: (fileId: string) => void;
  clearCompleted: () => void;
}

interface FileSendModalLike {
  confirmFileSend: (captionText: string) => void;
  openFileSendModal: (files: File[], target: TargetRef) => void;
}

export interface FileActionsFeatureDeps {
  store: Store<AppState>;
  getFileOffers: () => FileOffersLike | null;
  getFileSendModal: () => FileSendModalLike | null;
  saveAutoDownloadPrefs: (selfId: string, prefs: AutoDownloadPrefs) => void;
  loadAutoDownloadPrefs: (selfId: string) => AutoDownloadPrefs;
  onAutoDownloadPrefsReloaded: (selfId: string, prefs: AutoDownloadPrefs) => void;
}

export interface FileActionsFeature {
  onFileSendConfirm: (captionText: string) => void;
  onFileSend: (file: File | null, target: TargetRef | null) => void;
  onFileOfferAccept: (fileId: string) => void;
  onFileOfferReject: (fileId: string) => void;
  onClearCompletedFiles: () => void;
  onAutoDownloadPrefsSave: (prefs: AutoDownloadPrefs) => void;
}

export function createFileActionsFeature(deps: FileActionsFeatureDeps): FileActionsFeature {
  const { store, getFileOffers, getFileSendModal, saveAutoDownloadPrefs, loadAutoDownloadPrefs, onAutoDownloadPrefsReloaded } = deps;

  const onFileSendConfirm = (captionText: string) => {
    getFileSendModal()?.confirmFileSend(captionText);
  };

  const onFileSend = (file: File | null, target: TargetRef | null) => {
    const st = store.get();
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (!file) {
      store.set({ status: "Выберите файл" });
      return;
    }
    const tgt = target ?? st.selected;
    if (!tgt) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }
    getFileSendModal()?.openFileSendModal([file], tgt);
  };

  const onFileOfferAccept = (fileId: string) => {
    getFileOffers()?.accept(fileId);
  };

  const onFileOfferReject = (fileId: string) => {
    getFileOffers()?.reject(fileId);
  };

  const onClearCompletedFiles = () => {
    getFileOffers()?.clearCompleted();
  };

  const onAutoDownloadPrefsSave = (prefs: AutoDownloadPrefs) => {
    const st = store.get();
    const uid = st.selfId;
    if (!st.authed || !uid) return;
    saveAutoDownloadPrefs(uid, prefs);
    const reloaded = loadAutoDownloadPrefs(uid);
    onAutoDownloadPrefsReloaded(uid, reloaded);
  };

  return {
    onFileSendConfirm,
    onFileSend,
    onFileOfferAccept,
    onFileOfferReject,
    onClearCompletedFiles,
    onAutoDownloadPrefsSave,
  };
}
