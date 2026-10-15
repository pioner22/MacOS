import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

type Selection = { key: string; messages: ChatMessage[]; ids: string[] } | null;

export interface ChatSelectionCopyDownloadFeatureDeps {
  store: Store<AppState>;
  resolveChatSelection: (st: AppState) => Selection;
  copyText: (text: string) => Promise<boolean>;
  showToast: (message: string, opts?: { kind?: "info" | "success" | "warn" | "error" }) => void;
  beginDownload: (fileId: string) => void;
}

export interface ChatSelectionCopyDownloadFeature {
  handleChatSelectionCopy: () => Promise<void>;
  handleChatSelectionDownload: () => Promise<void>;
}

export function createChatSelectionCopyDownloadFeature(deps: ChatSelectionCopyDownloadFeatureDeps): ChatSelectionCopyDownloadFeature {
  const { store, resolveChatSelection, copyText, showToast, beginDownload } = deps;

  const handleChatSelectionCopy = async () => {
    const st = store.get();
    const selection = resolveChatSelection(st);
    if (!selection) return;
    const parts: string[] = [];
    for (const msg of selection.messages) {
      if (!msg) continue;
      const raw = String(msg.text || "").trim();
      const text = raw && !raw.startsWith("[file]") ? raw : "";
      if (text) {
        parts.push(text);
        continue;
      }
      const att = msg.attachment;
      if (att?.kind === "file") {
        const caption = String(msg.text || "").trim();
        if (caption && !caption.startsWith("[file]")) {
          parts.push(caption);
          continue;
        }
        const name = String(att.name || "").trim();
        if (name) parts.push(name);
      }
    }
    const text = parts.join("\n\n").trim();
    if (!text) {
      showToast("Нечего копировать", { kind: "warn" });
      return;
    }
    const ok = await copyText(text);
    showToast(ok ? "Скопировано" : "Не удалось скопировать", { kind: ok ? "success" : "error" });
  };

  const handleChatSelectionDownload = async () => {
    const st = store.get();
    const selection = resolveChatSelection(st);
    if (!selection) return;
    const ids = new Set<string>();
    for (const msg of selection.messages) {
      const fid = msg?.attachment?.kind === "file" ? String(msg.attachment.fileId || "").trim() : "";
      if (fid) ids.add(fid);
    }
    const list = Array.from(ids);
    if (!list.length) {
      showToast("В выбранных сообщениях нет файлов", { kind: "info" });
      return;
    }
    showToast(`Скачиваем файлов: ${list.length}`, { kind: "info" });
    for (const fid of list) {
      // Fire-and-forget: download pipeline has its own concurrency/queueing.
      beginDownload(fid);
    }
  };

  return {
    handleChatSelectionCopy,
    handleChatSelectionDownload,
  };
}
