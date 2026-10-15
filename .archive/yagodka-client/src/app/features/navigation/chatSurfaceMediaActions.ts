import { conversationKey } from "../../../helpers/chat/conversationKey";
import { MISSING_FILE_STATUS, isTerminalMissingVisualTransfer } from "../../../helpers/files/fileMissingState";
import { isVideoLikeFile } from "../../../helpers/files/mediaKind";
import { requestVoiceAutoplay } from "../../../helpers/media/audioSession";
import { getActiveConversationKey } from "../../../helpers/navigation/mainConversationState";
import type { ChatSurfaceDeferredDeps } from "./chatSurfaceEventsFeature";

type ViewerKindHint = "image" | "video";

function resolveKindHint(raw: string): ViewerKindHint | null {
  const kind = String(raw || "").trim().toLowerCase();
  return kind === "image" || kind === "video" ? kind : null;
}

export function createChatSurfaceMediaActions(deps: ChatSurfaceDeferredDeps) {
  const {
    store,
    ensureVideoMutedDefault,
    fileViewer,
    tryOpenFileViewerFromCache,
    setPendingFileViewer,
    enqueueFileGet,
    closeMobileSidebar,
    showToast,
    fileOffersAccept,
    requireConnectedAndAuthed,
  } = deps;

  const handleVoicePlaceholderClick = (voicePlayBtn: HTMLButtonElement, wrap: HTMLElement): void => {
    const fileId = String(wrap.getAttribute("data-file-id") || "").trim();
    if (!fileId) return;
    closeMobileSidebar();
    const st = store.get();
    if (!requireConnectedAndAuthed(st)) return;

    const audioKind = String(wrap.getAttribute("data-audio-kind") || "").trim();
    const audioLabel = audioKind === "music" ? "аудио" : "голосовое";
    requestVoiceAutoplay(fileId);
    const requestToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
      wrap.setAttribute("data-voice-state", "loading");
      wrap.setAttribute("data-voice-request", requestToken);
      voicePlayBtn.setAttribute("disabled", "true");
      voicePlayBtn.setAttribute("aria-label", `Готовим ${audioLabel}`);
      const time = wrap.querySelector(".chat-voice-time") as HTMLElement | null;
      if (time) time.textContent = "…";
    } catch {
      // ignore
    }

    showToast(`Загружаю ${audioLabel}…`, { kind: "info", timeoutMs: 3200 });

    const isOffer = st.fileOffersIn.some((offer) => String(offer.id || "").trim() === fileId);
    if (isOffer) {
      fileOffersAccept(fileId);
      window.setTimeout(() => enqueueFileGet(fileId, { priority: "high", silent: true }), 0);
    } else {
      enqueueFileGet(fileId, { priority: "high", silent: true });
    }
    window.setTimeout(() => {
      try {
        if (!wrap.isConnected) return;
        if (!wrap.classList.contains("chat-voice-placeholder")) return;
        if (wrap.getAttribute("data-voice-request") !== requestToken) return;
        wrap.setAttribute("data-voice-state", "paused");
        wrap.removeAttribute("data-voice-request");
        voicePlayBtn.removeAttribute("disabled");
        voicePlayBtn.setAttribute("aria-label", "Повторить загрузку голосового");
        const time = wrap.querySelector(".chat-voice-time") as HTMLElement | null;
        if (time) time.textContent = "повтор";
      } catch {
        // ignore
      }
    }, 12_000);
  };

  const handleMediaToggleClick = (preview: HTMLButtonElement, video: HTMLVideoElement): void => {
    if (video.paused) {
      ensureVideoMutedDefault(video);
      preview.setAttribute("data-video-state", "playing");
      void video
        .play()
        .then(() => {
          preview.setAttribute("data-video-state", video.paused ? "paused" : "playing");
        })
        .catch(() => {
          preview.setAttribute("data-video-state", "paused");
          try {
            const idxRaw = String(preview.getAttribute("data-msg-idx") || "").trim();
            const msgIdx = idxRaw ? Number(idxRaw) : NaN;
            const st = store.get();
            const chatKey = getActiveConversationKey(st);
            if (!chatKey || !Number.isFinite(msgIdx)) return;
            const url = String(preview.getAttribute("data-url") || "").trim() || null;
            const fileId = String(preview.getAttribute("data-file-id") || "").trim() || null;
            const name = String(preview.getAttribute("data-name") || "файл");
            const size = Number(preview.getAttribute("data-size") || 0) || 0;
            const mimeRaw = preview.getAttribute("data-mime");
            const mime = mimeRaw ? String(mimeRaw) : null;
            const captionRaw = preview.getAttribute("data-caption");
            const captionText = captionRaw ? String(captionRaw).trim() : "";
            const caption = captionText || null;
            const kindHint = resolveKindHint(String(preview.getAttribute("data-file-kind") || ""));
            void fileViewer.openFromMessageIndex(chatKey, Math.trunc(msgIdx), {
              kindHint: kindHint || undefined,
              url,
              name,
              size,
              mime,
              caption,
              fileId,
            });
          } catch {
            // ignore
          }
        });
      return;
    }
    video.pause();
    preview.setAttribute("data-video-state", "paused");
  };

  const handleOpenFileViewerClick = (viewBtn: HTMLButtonElement): void => {
    const url = String(viewBtn.getAttribute("data-url") || "").trim();
    const fileId = String(viewBtn.getAttribute("data-file-id") || "").trim();
    if (!url && !fileId) return;
    const kindHint = resolveKindHint(String(viewBtn.getAttribute("data-file-kind") || ""));
    const name = String(viewBtn.getAttribute("data-name") || "файл");
    const size = Number(viewBtn.getAttribute("data-size") || 0) || 0;
    const mimeRaw = viewBtn.getAttribute("data-mime");
    const mime = mimeRaw ? String(mimeRaw) : null;
    const autoplay = kindHint === "video" || isVideoLikeFile(name, mime);
    const captionRaw = viewBtn.getAttribute("data-caption");
    const caption = captionRaw ? String(captionRaw).trim() : "";
    const captionText = caption || null;
    const msgIdxRaw = viewBtn.getAttribute("data-msg-idx");
    const msgIdx = msgIdxRaw !== null && msgIdxRaw.trim() ? Number(msgIdxRaw) : null;
    const st = store.get();
    const chatKey = getActiveConversationKey(st) || null;
    closeMobileSidebar();

    const openFallback = () => {
      if (url) {
        store.set({
          modal: fileViewer.buildModalState({
            fileId: fileId || null,
            url,
            name,
            size,
            mime,
            caption: captionText,
            autoplay,
            chatKey: null,
            msgIdx: null,
          }),
        });
        return;
      }
      void (async () => {
        const snapshot = store.get();
        const existing = snapshot.fileTransfers.find((transfer) => String(transfer.id || "").trim() === fileId && Boolean(transfer.url));
        if (existing?.url) {
          store.set({
            modal: fileViewer.buildModalState({
              fileId: fileId || null,
              url: existing.url,
              name,
              size: size || existing.size || 0,
              mime: mime || existing.mime || null,
              caption: captionText,
              autoplay,
              chatKey: null,
              msgIdx: null,
            }),
          });
          return;
        }
        const opened = await tryOpenFileViewerFromCache(fileId, {
          name,
          size,
          mime,
          caption: captionText,
          chatKey: null,
          msgIdx: null,
        });
        if (opened) return;

        const latest = store.get();
        const missing = latest.fileTransfers.find((transfer) => String(transfer.id || "").trim() === fileId) ?? null;
        if (isTerminalMissingVisualTransfer(missing, { name, mime, kindHint })) {
          store.set({ status: MISSING_FILE_STATUS });
          return;
        }
        if (latest.conn !== "connected") {
          store.set({ status: "Нет соединения" });
          return;
        }
        if (!latest.authed) {
          store.set({ status: "Сначала войдите или зарегистрируйтесь" });
          return;
        }
        setPendingFileViewer({ fileId, name, size, mime, caption: captionText, chatKey: null, msgIdx: null });
        enqueueFileGet(fileId, { priority: "high" });
        store.set({ status: `Скачивание: ${name}` });
      })();
    };

    if (chatKey && msgIdx !== null && Number.isFinite(msgIdx)) {
      void (async () => {
        const handled = await fileViewer.openFromMessageIndex(chatKey, Math.trunc(msgIdx), {
          kindHint: kindHint || undefined,
          url,
          name,
          size,
          mime,
          caption: captionText,
          fileId: fileId || null,
        });
        if (handled) return;
        openFallback();
      })();
      return;
    }
    openFallback();
  };

  return {
    handleVoicePlaceholderClick,
    handleMediaToggleClick,
    handleOpenFileViewerClick,
  };
}
