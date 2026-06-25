import {
  avatarDataUrlToUploadPayload,
  clearStoredAvatar,
  imageFileToAvatarDataUrl,
  storeAvatar,
  type AvatarTargetKind,
} from "../../../helpers/avatar/avatarStore";
import type { Store } from "../../../stores/store";
import type { AppState, ContextMenuTargetKind } from "../../../stores/types";

export function avatarKindForTarget(kind: ContextMenuTargetKind): AvatarTargetKind | null {
  if (kind === "dm" || kind === "auth_in" || kind === "auth_out") return "dm";
  if (kind === "group") return "group";
  if (kind === "board") return "board";
  return null;
}

export interface AvatarFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
}

export interface AvatarFeature {
  bumpAvatars: (status: string) => void;
  pickAvatarFor: (kind: AvatarTargetKind, id: string) => void;
  removeAvatar: (kind: AvatarTargetKind, id: string) => void;
  setProfileAvatar: (file: File | null) => void;
  clearProfileAvatar: () => void;
}

export function createAvatarFeature(deps: AvatarFeatureDeps): AvatarFeature {
  const { store, send } = deps;

  function avatarErrorMessage(error: unknown): string {
    const message = String((error as { message?: unknown } | null)?.message || error || "").trim();
    if (message === "avatar_transport_too_large") return "Изображение слишком тяжёлое для аватарки";
    if (message === "file_too_large") return "Файл слишком большой для аватарки";
    if (message === "not_image") return "Нужен файл изображения";
    if (message === "image_load_failed") return "Не удалось прочитать изображение";
    return message || "ошибка";
  }

  function bumpAvatars(status: string) {
    store.set((prev) => ({ ...prev, avatarsRev: (prev.avatarsRev || 0) + 1, status }));
  }

  function pickAvatarFor(kind: AvatarTargetKind, id: string) {
    const targetId = String(id ?? "").trim();
    if (!targetId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const file = input.files && input.files.length ? input.files[0] : null;
        input.remove();
        if (!file) return;
        void (async () => {
          try {
            const dataUrl = await imageFileToAvatarDataUrl(file, 128);
            storeAvatar(kind, targetId, dataUrl);
            if (kind === "group" || kind === "board") {
              const payload = avatarDataUrlToUploadPayload(dataUrl);
              bumpAvatars("Аватар загружается…");
              send({ type: "avatar_set", kind, id: targetId, mime: payload.mime, data: payload.base64 });
            } else {
              bumpAvatars(`Аватар обновлён: ${targetId}`);
            }
          } catch (e) {
            bumpAvatars(`Не удалось загрузить аватар: ${String((e as any)?.message || "ошибка")}`);
          }
        })();
      },
      { once: true }
    );
    input.click();
  }

  function removeAvatar(kind: AvatarTargetKind, id: string) {
    const targetId = String(id ?? "").trim();
    if (!targetId) return;
    clearStoredAvatar(kind, targetId);
    if (kind === "group" || kind === "board") {
      bumpAvatars("Удаляем аватар…");
      send({ type: "avatar_clear", kind, id: targetId });
    } else {
      bumpAvatars(`Аватар удалён: ${targetId}`);
    }
  }

  function setProfileAvatar(file: File | null) {
    const id = store.get().selfId;
    if (!id) return;
    if (!file) return;
    void (async () => {
      try {
        const dataUrl = await imageFileToAvatarDataUrl(file, 128);
        const payload = avatarDataUrlToUploadPayload(dataUrl);
        storeAvatar("dm", id, dataUrl);
        bumpAvatars("Аватар загружается…");
        send({ type: "avatar_set", mime: payload.mime, data: payload.base64 });
      } catch (e) {
        bumpAvatars(`Не удалось загрузить аватар: ${avatarErrorMessage(e)}`);
      }
    })();
  }

  function clearProfileAvatar() {
    const id = store.get().selfId;
    if (!id) return;
    store.set({ status: "Удаляем аватар…" });
    send({ type: "avatar_clear" });
  }

  return { bumpAvatars, pickAvatarFor, removeAvatar, setProfileAvatar, clearProfileAvatar };
}
