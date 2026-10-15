import { getStoredSessionToken, isSessionAutoAuthBlocked } from "../../../helpers/auth/session";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";

interface ComposerAttachButtonFeatureDeps {
  store: Store<AppState>;
  attachBtn: HTMLButtonElement;
  openFileSendModal: (files: File[], target: TargetRef) => void;
}

export interface ComposerAttachButtonFeature {
  bind: () => void;
}

function openFilePicker(onSelected: (files: File[]) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "-9999px";
  document.body.appendChild(input);
  input.addEventListener(
    "change",
    () => {
      const files = Array.from(input.files || []);
      input.remove();
      onSelected(files);
    },
    { once: true }
  );
  input.click();
}

export function createComposerAttachButtonFeature(deps: ComposerAttachButtonFeatureDeps): ComposerAttachButtonFeature {
  const { store, attachBtn, openFileSendModal } = deps;

  const bind = () => {
    attachBtn.addEventListener("click", () => {
      const st = store.get();
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения" });
        return;
      }
      if (!st.authed) {
        const token = getStoredSessionToken();
        if (token) {
          if (isSessionAutoAuthBlocked()) {
            store.set({
              authMode: st.authRememberedId ? "login" : "register",
              modal: { kind: "auth", message: "Сессия активна в другом окне. Чтобы продолжить здесь — войдите снова." },
            });
            return;
          }
          store.set({ status: "Авторизация… подождите" });
          return;
        }
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      const target = st.selected;
      if (!target) {
        store.set({ status: "Выберите контакт или чат слева" });
        return;
      }
      openFilePicker((files) => {
        if (!files.length) return;
        openFileSendModal(files, target);
      });
    });
  };

  return {
    bind,
  };
}
