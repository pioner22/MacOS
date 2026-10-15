import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

interface ComposerFileInputFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  inputWrap: HTMLElement;
  openFileSendModal: (files: File[]) => void;
}

export interface ComposerFileInputFeature {
  bind: () => void;
}

function normalizeClipboardFile(file: File): File {
  const name = String(file?.name || "").trim();
  if (name) return file;
  let ext = "";
  const type = String(file?.type || "").trim().toLowerCase();
  if (type.includes("/")) {
    const [, sub] = type.split("/", 2);
    if (sub) {
      const base = sub.split(/[+;]/, 1)[0].trim();
      if (base === "jpeg") ext = "jpg";
      else if (base === "svg") ext = "svg";
      else if (base === "x-icon") ext = "ico";
      else ext = base;
    }
  }
  const suffix = ext ? `.${ext}` : "";
  const filename = `clipboard-${Date.now()}${suffix}`;
  try {
    return new File([file], filename, { type: file.type || undefined, lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  }
}

function isFileDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  try {
    if (dt.files && dt.files.length) return true;
  } catch {
    // ignore
  }
  try {
    return Array.from(dt.types || []).includes("Files");
  } catch {
    return false;
  }
}

export function createComposerFileInputFeature(deps: ComposerFileInputFeatureDeps): ComposerFileInputFeature {
  const { store, input, inputWrap, openFileSendModal } = deps;
  let dragDepth = 0;

  const setDragActive = (active: boolean) => {
    inputWrap.classList.toggle("composer-drag", active);
  };

  const bind = () => {
    input.addEventListener("paste", (e) => {
      const ev = e as ClipboardEvent;
      const dt = ev.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.files || []).map(normalizeClipboardFile);
      if (!files.length) {
        try {
          for (const item of Array.from(dt.items || [])) {
            if (item.kind !== "file") continue;
            const file = item.getAsFile();
            if (file) files.push(normalizeClipboardFile(file));
          }
        } catch {
          // ignore
        }
      }
      if (!files.length) return;
      const st = store.get();
      if (st.conn !== "connected") {
        ev.preventDefault();
        store.set({ status: "Нет соединения" });
        return;
      }
      if (!st.authed) {
        ev.preventDefault();
        store.set({ status: "Нажмите «Войти», чтобы отправлять файлы" });
        return;
      }
      if (!st.selected) {
        ev.preventDefault();
        store.set({ status: "Выберите контакт или чат слева" });
        return;
      }
      ev.preventDefault();
      openFileSendModal(files);
    });

    inputWrap.addEventListener("dragenter", (e) => {
      const ev = e as DragEvent;
      if (!isFileDrag(ev.dataTransfer)) return;
      ev.preventDefault();
      dragDepth += 1;
      setDragActive(true);
    });

    inputWrap.addEventListener("dragover", (e) => {
      const ev = e as DragEvent;
      if (!isFileDrag(ev.dataTransfer)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      setDragActive(true);
    });

    inputWrap.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragActive(false);
    });

    inputWrap.addEventListener("drop", (e) => {
      const ev = e as DragEvent;
      const dt = ev.dataTransfer;
      if (!isFileDrag(dt)) return;
      ev.preventDefault();
      dragDepth = 0;
      setDragActive(false);
      const files = Array.from(dt?.files || []);
      if (!files.length) return;
      const st = store.get();
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения" });
        return;
      }
      if (!st.authed) {
        store.set({ status: "Нажмите «Войти», чтобы отправлять файлы" });
        return;
      }
      if (!st.selected) {
        store.set({ status: "Выберите контакт или чат слева" });
        return;
      }
      openFileSendModal(files);
    });
  };

  return {
    bind,
  };
}
