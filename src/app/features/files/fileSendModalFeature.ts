import { conversationKey } from "../../../helpers/chat/conversationKey";
import { updateDraftMap } from "../../../helpers/chat/drafts";
import { isAudioLikeFile, isImageLikeFile, isVideoLikeFile } from "../../../helpers/files/mediaKind";
import { applyDraftMapMutation } from "../../../helpers/runtime/deliverySync";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";
import { scheduleSaveDrafts } from "../persistence/localPersistenceTimers";

export interface FileSendModalFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  autosizeInput: (el: HTMLTextAreaElement) => void;
  sendFile: (file: File, target: TargetRef, caption: string) => void;
}

export interface FileSendModalFeature {
  openFileSendModal: (files: File[], target: TargetRef) => void;
  confirmFileSend: (captionText: string) => void;
  closeModalIfFileSend: () => boolean;
}

export function createFileSendModalFeature(deps: FileSendModalFeatureDeps): FileSendModalFeature {
  const { store, input, autosizeInput, sendFile } = deps;

  function revokeFileSendPreviews(previewUrls?: Array<string | null>) {
    if (!previewUrls || !previewUrls.length) return;
    for (const url of previewUrls) {
      if (!url) continue;
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }

  function restoreComposerInput(target: TargetRef, text: string) {
    if (!text) return;
    const key = conversationKey(target);
    store.set((prev) => {
      const drafts = updateDraftMap(prev.drafts, key, text);
      const isCurrent = prev.selected ? conversationKey(prev.selected) === key : false;
      return { ...applyDraftMapMutation(prev, drafts), input: isCurrent ? text : prev.input };
    });
    const isCurrent = store.get().selected ? conversationKey(store.get().selected as TargetRef) === key : false;
    if (isCurrent) {
      try {
        input.value = text;
        autosizeInput(input);
      } catch {
        // ignore
      }
    }
    scheduleSaveDrafts(store);
  }

  function detachComposerCaption(st: AppState): { caption: string; restoreInput: string | null } {
    const caption = String(input.value || "").trimEnd();
    if (!caption) return { caption: "", restoreInput: null };
    if (st.editing) {
      store.set({ status: "Подпись не добавлена: вы редактируете сообщение" });
      return { caption: "", restoreInput: null };
    }
    const key = st.selected ? conversationKey(st.selected) : "";
    store.set((prev) => ({
      ...applyDraftMapMutation(prev, key ? updateDraftMap(prev.drafts, key, "") : prev.drafts),
      input: "",
    }));
    try {
      input.value = "";
      autosizeInput(input);
    } catch {
      // ignore
    }
    scheduleSaveDrafts(store);
    return { caption, restoreInput: caption };
  }

  function openFileSendModal(files: File[], target: TargetRef) {
    if (!files.length) return;
    if (files.length === 1) {
      const file = files[0];
      const autoSendKind = file && typeof file === "object" ? String((file as any).__yagodka_auto_send || "") : "";
      if (autoSendKind === "voice_record" || autoSendKind === "video_note_record") {
        const st = store.get();
        if (st.conn !== "connected") {
          store.set({ status: "Нет соединения" });
          return;
        }
        if (!st.authed) {
          store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
          return;
        }
        sendFile(file, target, "");
        return;
      }
    }
    const st = store.get();
    const captionDisabled = Boolean(st.editing);
    let captionHint = "";
    if (st.editing) captionHint = "Подпись недоступна во время редактирования";
    else if (files.length > 1) captionHint = "Подпись будет добавлена один раз (как подпись альбома)";
    let caption = "";
    let restoreInput: string | null = null;
    if (!captionDisabled && st.page === "main") {
      const res = detachComposerCaption(st);
      caption = res.caption;
      restoreInput = res.restoreInput;
    }
    const allowAudioPreview = files.length <= 1;
    const previewUrls = files.map((file) => {
      const name = file?.name || "";
      const mime = file?.type || null;
      const canPreview = isImageLikeFile(name, mime) || isVideoLikeFile(name, mime) || (allowAudioPreview && isAudioLikeFile(name, mime));
      if (!canPreview) return null;
      try {
        return URL.createObjectURL(file);
      } catch {
        return null;
      }
    });
    store.set({
      modal: {
        kind: "file_send",
        files,
        target,
        caption,
        captionDisabled,
        captionHint,
        restoreInput,
        previewUrls,
      },
    });
  }

  function confirmFileSend(captionText: string) {
    const st = store.get();
    const modal = st.modal as any;
    if (!modal || modal.kind !== "file_send") return;
    const files: File[] = modal.files || [];
    const target: TargetRef = modal.target;
    revokeFileSendPreviews(modal.previewUrls);
    store.set({ modal: null });
    if (!files.length) return;
    const caption = String(captionText || "").trimEnd();
    const canCaption = Boolean(caption) && !st.editing;
    for (let i = 0; i < files.length; i += 1) {
      sendFile(files[i], target, i === 0 && canCaption ? caption : "");
    }
  }

  function closeModalIfFileSend(): boolean {
    const st = store.get();
    const modal = st.modal as any;
    if (!modal || modal.kind !== "file_send") return false;
    revokeFileSendPreviews(modal.previewUrls);
    if (modal.restoreInput) restoreComposerInput(modal.target, modal.restoreInput);
    store.set({ modal: null });
    return true;
  }

  return { openFileSendModal, confirmFileSend, closeModalIfFileSend };
}
