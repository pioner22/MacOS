import { conversationKey } from "../../../helpers/chat/conversationKey";
import { resolveViewerSourceScope } from "../../../helpers/chat/fileViewerScope";
import { MISSING_FILE_STATUS, isTerminalMissingVisualTransfer } from "../../../helpers/files/fileMissingState";
import { isImageLikeFile, isVideoLikeFile } from "../../../helpers/files/mediaKind";
import { isIOS, isStandaloneDisplayMode } from "../../../helpers/ui/iosInputAssistant";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export type FileViewerModalState = Extract<AppState["modal"], { kind: "file_viewer" }>;

export interface FileViewerModalParams {
  fileId?: string | null;
  url: string;
  name: string;
  size: number;
  mime: string | null;
  caption: string | null;
  fallbackUrl?: string | null;
  autoplay?: boolean;
  chatKey: string | null;
  msgIdx: number | null;
}

export interface FileViewerOpenFallback {
  kindHint?: "image" | "video";
  url?: string | null;
  name?: string;
  size?: number;
  mime?: string | null;
  caption?: string | null;
  fileId?: string | null;
}

export interface HttpFileUrlInfo {
  url: string;
  name?: string;
  size?: number;
  mime?: string | null;
}

export interface PendingFileViewer {
  fileId: string;
  name: string;
  size: number;
  mime: string | null;
  caption: string | null;
  chatKey: string | null;
  msgIdx: number | null;
}

export interface FileViewerFeatureDeps {
  store: Store<AppState>;
  closeModal: () => void;
  jumpToChatMsgIdx: (idx: number) => void;
  tryOpenFileViewerFromCache: (
    fileId: string,
    meta: {
      name: string;
      size: number;
      mime: string | null;
      caption?: string | null;
      chatKey?: string | null;
      msgIdx?: number | null;
    }
  ) => Promise<boolean>;
  enqueueFileGet: (fileId: string, opts?: { priority?: "high" | "prefetch"; silent?: boolean }) => void;
  acceptFileOffer?: (fileId: string) => void;
  beginViewerStream?: (fileId: string, meta?: { name?: string; size?: number; mime?: string | null }) => string | null;
  setPendingFileViewer: (state: PendingFileViewer) => void;
}

export interface FileViewerFeature {
  buildModalState: (params: FileViewerModalParams) => FileViewerModalState;
  openFromMessageIndex: (chatKey: string, msgIdx: number, fallback?: FileViewerOpenFallback) => Promise<boolean>;
  recoverCurrent: () => Promise<void>;
  navigate: (dir: "prev" | "next") => void;
  openAtIndex: (msgIdx: number) => void;
  jumpFromViewer: () => void;
}

function isInlineViewerStreamUrl(rawUrl: unknown): boolean {
  const value = String(rawUrl || "").trim();
  if (!value) return false;
  try {
    const url = new URL(value, typeof window !== "undefined" ? window.location.href : "https://yagodka.local/");
    return url.pathname.startsWith("/__yagodka_stream__/files/") && url.searchParams.get("inline") === "1";
  } catch {
    return value.includes("/__yagodka_stream__/files/") && value.includes("inline=1");
  }
}

export function createFileViewerFeature(deps: FileViewerFeatureDeps): FileViewerFeature {
  const {
    store,
    closeModal,
    jumpToChatMsgIdx,
    tryOpenFileViewerFromCache,
    enqueueFileGet,
    acceptFileOffer,
    beginViewerStream,
    setPendingFileViewer,
  } = deps;

  const debugHook = (kind: string, data?: any) => {
    try {
      const dbg = (globalThis as any).__yagodka_debug_monitor;
      if (!dbg || typeof dbg.push !== "function") return;
      dbg.push(String(kind || "file.viewer").trim() || "file.viewer", data);
    } catch {
      // ignore
    }
  };

  const shouldUseInlineViewerStream = (fileId: string, name: string, mime: string | null, kindHint: "image" | "video" | null): boolean => {
    if (!beginViewerStream) return false;
    if (!fileId) return false;
    if (!isIOS() || !isStandaloneDisplayMode()) return false;
    if (kindHint === "video") return false;
    if (kindHint === "image") return true;
    return isImageLikeFile(name, mime);
  };

  const openInlineViewerStream = (params: {
    fileId: string;
    name: string;
    size: number;
    mime: string | null;
    caption: string | null;
    fallbackUrl?: string | null;
    autoplay: boolean;
    chatKey: string | null;
    msgIdx: number | null;
    reason: string;
  }): boolean => {
    const fileId = String(params.fileId || "").trim();
    if (!fileId || !beginViewerStream) return false;
    const streamUrl = beginViewerStream(fileId, {
      name: params.name,
      size: params.size,
      mime: params.mime,
    });
    if (!streamUrl) return false;
    debugHook("file.viewer.stream", {
      fileId,
      reason: params.reason,
      chatKey: params.chatKey,
      msgIdx: params.msgIdx,
      size: params.size,
      mime: params.mime ? String(params.mime).slice(0, 80) : null,
    });
    store.set({
      modal: buildModalState({
        fileId,
        url: streamUrl,
        name: params.name,
        size: params.size,
        mime: params.mime,
        caption: params.caption,
        fallbackUrl: params.fallbackUrl || null,
        autoplay: params.autoplay,
        chatKey: params.chatKey,
        msgIdx: params.msgIdx,
      }),
      status: `Загрузка: ${params.name || fileId}`,
    });
    if (params.chatKey && params.msgIdx !== null) maybePrefetchNeighbors(params.chatKey, params.msgIdx);
    return true;
  };

  const queueViewerDownload = (params: {
    fileId: string;
    name: string;
    size: number;
    mime: string | null;
    caption: string | null;
    chatKey: string | null;
    msgIdx: number | null;
    reason: string;
  }) => {
    const fileId = String(params.fileId || "").trim();
    if (!fileId) return;
    const existing = store.get().fileTransfers.find((t) => String(t.id || "").trim() === fileId) ?? null;
    if (isTerminalMissingVisualTransfer(existing, { name: params.name, mime: params.mime })) {
      debugHook("file.viewer.file_get_skip", { fileId, reason: "not_found_terminal", chatKey: params.chatKey, msgIdx: params.msgIdx });
      store.set({ status: MISSING_FILE_STATUS });
      return;
    }
    if (store.get().fileOffersIn.some((offer) => String(offer.id || "").trim() === fileId)) {
      acceptFileOffer?.(fileId);
    }
    setPendingFileViewer({
      fileId,
      name: params.name,
      size: params.size,
      mime: params.mime,
      caption: params.caption,
      chatKey: params.chatKey,
      msgIdx: params.msgIdx,
    });
    enqueueFileGet(fileId, { priority: "high" });
    debugHook("file.viewer.file_get", {
      fileId,
      reason: params.reason,
      chatKey: params.chatKey,
      msgIdx: params.msgIdx,
      size: params.size,
      mime: params.mime ? String(params.mime).slice(0, 80) : null,
    });
    store.set({ status: `Скачивание: ${params.name || fileId}` });
  };

  const maybePrefetchNeighbors = (chatKeyRaw: string, centerIdxRaw: number) => {
    void chatKeyRaw;
    void centerIdxRaw;
    // Viewer navigation is also click-to-load: opening one photo must not silently
    // prefetch neighboring visual media from stale chat history.
  };

  function buildModalState(params: FileViewerModalParams): FileViewerModalState {
    const st = store.get();
    const chatKey = params.chatKey ? String(params.chatKey) : null;
    const msgIdx = Number.isFinite(params.msgIdx) ? Math.trunc(Number(params.msgIdx)) : null;
    const msgs = chatKey ? st.conversations[chatKey] || [] : [];
    const scope = chatKey && msgIdx !== null ? resolveViewerSourceScope(msgs, msgIdx) : null;
    const prevIdx = scope?.prevIdx ?? null;
    const nextIdx = scope?.nextIdx ?? null;
    const fileId = params.fileId ? String(params.fileId).trim() : "";
    const openedAtMs = (() => {
      const cur = st.modal;
      if (!cur || cur.kind !== "file_viewer") return Date.now();
      const curFileId = typeof cur.fileId === "string" ? cur.fileId.trim() : "";
      const nextFileId = fileId;
      const same = curFileId && nextFileId ? curFileId === nextFileId : String(cur.url || "").trim() === String(params.url || "").trim();
      if (!same) return Date.now();
      const prevOpenedAt = cur.openedAtMs;
      return typeof prevOpenedAt === "number" && Number.isFinite(prevOpenedAt) ? prevOpenedAt : Date.now();
    })();
    return {
      kind: "file_viewer",
      ...(fileId ? { fileId } : {}),
      url: params.url,
      name: params.name,
      size: params.size,
      mime: params.mime,
      caption: params.caption,
      ...(params.autoplay ? { autoplay: true } : {}),
      chatKey,
      msgIdx,
      prevIdx,
      nextIdx,
      openedAtMs,
      ...(params.fallbackUrl ? { fallbackUrl: params.fallbackUrl } : {}),
    };
  }

  async function openFromMessageIndex(chatKey: string, msgIdx: number, fallback?: FileViewerOpenFallback): Promise<boolean> {
    const st = store.get();
    const msgs = st.conversations[chatKey] || [];
    if (!Number.isFinite(msgIdx) || msgIdx < 0 || msgIdx >= msgs.length) {
      debugHook("file.viewer.open.skip", { chatKey, msgIdx, reason: "bad_idx" });
      return false;
    }
    const msg = msgs[msgIdx];
    const att = msg?.attachment;
    if (!att || att.kind !== "file") {
      debugHook("file.viewer.open.skip", { chatKey, msgIdx, reason: "no_file_attachment" });
      return false;
    }
    const fileIdRaw =
      typeof att.fileId === "string" && att.fileId.trim() ? att.fileId.trim() : String(fallback?.fileId || "").trim();
    const fileId = fileIdRaw || null;
    const localId = typeof att.localId === "string" && att.localId.trim() ? att.localId.trim() : null;
    const entry = fileId
      ? st.fileTransfers.find((t) => String(t.id || "").trim() === fileId)
      : localId
        ? st.fileTransfers.find((t) => String(t.localId || "").trim() === localId)
        : null;

    const name = String(att.name || entry?.name || fallback?.name || "файл");
    const size = Number(att.size || entry?.size || fallback?.size || 0) || 0;
    const mime = (att.mime ?? entry?.mime ?? fallback?.mime) || null;
    const hasThumb = Boolean(fileId && st.fileThumbs?.[fileId]?.url);
    const thumbEntry = fileId && st.fileThumbs?.[fileId] ? st.fileThumbs[fileId] : null;
    const thumbUrl = thumbEntry?.url ? String(thumbEntry.url || "").trim() : null;
    const thumbMime = thumbEntry?.mime ? String(thumbEntry.mime || "").trim() : null;
    const kindHint = fallback?.kindHint === "image" || fallback?.kindHint === "video" ? fallback.kindHint : null;
    const looksVideo = isVideoLikeFile(name, mime);
    const looksImage = isImageLikeFile(name, mime);
    const mediaKind: "image" | "video" | null = kindHint ?? (looksVideo ? "video" : looksImage || hasThumb ? "image" : null);
    if (!mediaKind) {
      debugHook("file.viewer.open.skip", { chatKey, msgIdx, fileId, reason: "not_media_like", kindHint });
      return false;
    }
    const viewerMime = mediaKind === "image" && !mime ? "image/jpeg" : mime;
    debugHook("file.viewer.open.start", {
      chatKey,
      msgIdx,
      fileId,
      hasThumb,
      hasTransferUrl: Boolean(entry?.url),
      hasFallbackUrl: Boolean(fallback?.url),
      name: name ? String(name).slice(0, 80) : null,
      size: Number.isFinite(size) ? size : 0,
      mime: mime ? String(mime).slice(0, 80) : null,
    });
    const autoplay = mediaKind === "video";
    const rawCaption = String(msg.text || "").trim();
    const captionText = rawCaption && !rawCaption.startsWith("[file]") ? rawCaption : String(fallback?.caption || "").trim();
    const caption = captionText ? captionText : null;
    const url = entry?.url || fallback?.url || null;
    const terminalMissingVisual = isTerminalMissingVisualTransfer(entry, { name, mime: viewerMime, kindHint: mediaKind });
    if (url) {
      const fallbackUrl = mediaKind === "image" && thumbUrl && thumbUrl !== url ? thumbUrl : null;
      debugHook("file.viewer.open.direct_url", {
        chatKey,
        msgIdx,
        fileId,
        source: entry?.url ? "transfer" : "fallback",
        fallback: Boolean(fallbackUrl),
      });
      store.set({ modal: buildModalState({ fileId, url, name, size, mime: viewerMime, caption, fallbackUrl, autoplay, chatKey, msgIdx }) });
      maybePrefetchNeighbors(chatKey, msgIdx);
      return true;
    }
    if (terminalMissingVisual && !thumbUrl) {
      debugHook("file.viewer.open.blocked", { chatKey, msgIdx, fileId, reason: "not_found_terminal" });
      store.set({ status: MISSING_FILE_STATUS });
      return true;
    }
    const canOpenThumbNow = Boolean(fileId && thumbUrl && (mediaKind === "image" || mediaKind === "video"));
    if (canOpenThumbNow) {
      const previewMime = mediaKind === "video" ? thumbMime || "image/jpeg" : viewerMime;
      debugHook("file.viewer.open.thumb", { chatKey, msgIdx, fileId, hasThumb: true, targetKind: mediaKind });
      store.set({
        modal: buildModalState({
          fileId,
          url: thumbUrl as string,
          name,
          size,
          mime: previewMime,
          caption,
          autoplay: false,
          chatKey,
          msgIdx,
        }),
      });
      maybePrefetchNeighbors(chatKey, msgIdx);
      queueViewerDownload({
        fileId: fileId as string,
        name,
        size,
        mime: viewerMime,
        caption,
        chatKey,
        msgIdx,
        reason: mediaKind === "video" ? "video_thumb_prefetch_upgrade" : "thumb_prefetch_upgrade",
      });
      return true;
    }
    if (
      fileId &&
      !terminalMissingVisual &&
      shouldUseInlineViewerStream(fileId, name, viewerMime, mediaKind) &&
      openInlineViewerStream({
        fileId,
        name,
        size,
        mime: viewerMime,
        caption,
        fallbackUrl: mediaKind === "image" ? thumbUrl : null,
        autoplay,
        chatKey,
        msgIdx,
        reason: "ios_inline_stream_open",
      })
    ) {
      return true;
    }
    if (!fileId) {
      debugHook("file.viewer.open.blocked", { chatKey, msgIdx, reason: "no_file_id" });
      store.set({ status: "Файл пока недоступен" });
      return true;
    }
    const opened = await tryOpenFileViewerFromCache(fileId, { name, size, mime: viewerMime, caption, chatKey, msgIdx });
    debugHook("file.viewer.open.cache", { chatKey, msgIdx, fileId, ok: Boolean(opened) });
    if (opened) {
      maybePrefetchNeighbors(chatKey, msgIdx);
      return true;
    }
    const latest = store.get();
    if (latest.conn !== "connected") {
      debugHook("file.viewer.open.blocked", { chatKey, msgIdx, fileId, reason: "no_conn" });
      store.set({ status: "Нет соединения" });
      return true;
    }
    if (!latest.authed) {
      debugHook("file.viewer.open.blocked", { chatKey, msgIdx, fileId, reason: "not_authed" });
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return true;
    }
    queueViewerDownload({
      fileId,
      name,
      size,
      mime: viewerMime,
      caption,
      chatKey,
      msgIdx,
      reason: autoplay ? "direct_open_video_download" : "direct_open_download",
    });
    return true;
  }

  const viewerRecover = new Map<string, { lastDownloadAt: number }>();
  const RECOVER_DOWNLOAD_GAP_MS = 6500;

  async function recoverCurrent(): Promise<void> {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    if (st.conn !== "connected") {
      debugHook("file.viewer.recover.blocked", { reason: "no_conn" });
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.authed) {
      debugHook("file.viewer.recover.blocked", { reason: "not_authed" });
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }

    const modalFileId = typeof modal.fileId === "string" ? modal.fileId.trim() : "";
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;

    const derivedFileId = (() => {
      if (!chatKey || msgIdx === null) return "";
      const msgs = st.conversations[chatKey] || [];
      const msg = msgs[msgIdx];
      const att = msg?.attachment;
      if (!att || att.kind !== "file") return "";
      return typeof att.fileId === "string" ? att.fileId.trim() : "";
    })();
    const fileId = modalFileId || derivedFileId;
    if (!fileId) return;

    const sourceAtt = (() => {
      if (!chatKey || msgIdx === null) return null;
      const msgs = st.conversations[chatKey] || [];
      const msg = msgs[msgIdx];
      const att = msg?.attachment;
      return att && att.kind === "file" ? att : null;
    })();
    const name = String(sourceAtt?.name || modal.name || "файл");
    const size = Number(sourceAtt?.size || modal.size || 0) || 0;
    const mime = (sourceAtt?.mime ?? modal.mime ?? null) || null;
    const recoveringFromInlineStream = isInlineViewerStreamUrl(modal.url);
    const rawCaption = String(modal.caption || "").trim();
    const caption = rawCaption && !rawCaption.startsWith("[file]") ? rawCaption : null;
    const thumbEntry = fileId && st.fileThumbs?.[fileId] ? st.fileThumbs[fileId] : null;
    const thumbUrl = thumbEntry?.url ? String(thumbEntry.url || "").trim() : null;
    const thumbMime = thumbEntry?.mime ? String(thumbEntry.mime || "").trim() : null;
    const kindHint =
      isVideoLikeFile(name, mime)
        ? "video"
        : isImageLikeFile(name, mime)
          ? "image"
          : null;

    debugHook("file.viewer.recover.start", {
      fileId,
      hasModalFileId: Boolean(modalFileId),
      hasDerivedFileId: Boolean(derivedFileId),
      chatKey: chatKey || null,
      msgIdx,
      name: name ? String(name).slice(0, 80) : null,
      size: Number.isFinite(size) ? size : 0,
      mime: mime ? String(mime).slice(0, 80) : null,
    });

    const opened = await tryOpenFileViewerFromCache(fileId, {
      name,
      size,
      mime,
      caption,
      chatKey: chatKey || null,
      msgIdx,
    });
    debugHook("file.viewer.recover.cache", { fileId, ok: Boolean(opened) });
    if (opened) return;
    const existing = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId) ?? null;
    if (isTerminalMissingVisualTransfer(existing, { name, mime, kindHint })) {
      debugHook("file.viewer.recover.blocked", { fileId, reason: "not_found_terminal" });
      store.set({ status: MISSING_FILE_STATUS });
      return;
    }
    if (kindHint === "video" && thumbUrl && String(modal.url || "").trim() !== thumbUrl) {
      store.set({
        modal: buildModalState({
          fileId,
          url: thumbUrl,
          name,
          size,
          mime: thumbMime || "image/jpeg",
          caption,
          autoplay: false,
          chatKey: chatKey || null,
          msgIdx,
        }),
      });
    }
    if (
      !recoveringFromInlineStream &&
      shouldUseInlineViewerStream(fileId, name, mime, kindHint) &&
      openInlineViewerStream({
        fileId,
        name,
        size,
        mime,
        caption,
        autoplay: kindHint === "video",
        chatKey: chatKey || null,
        msgIdx,
        reason: "ios_inline_stream_recover",
      })
    ) {
      return;
    }

    const now = Date.now();
    const prev = viewerRecover.get(fileId) || { lastDownloadAt: 0 };
    const canDownload = !prev.lastDownloadAt || now - prev.lastDownloadAt >= RECOVER_DOWNLOAD_GAP_MS;
    if (!canDownload) {
      debugHook("file.viewer.recover.file_get_skip", { fileId, reason: "gap_guard" });
      return;
    }
    viewerRecover.set(fileId, { lastDownloadAt: now });
    queueViewerDownload({
      fileId,
      name,
      size,
      mime,
      caption,
      chatKey: chatKey || null,
      msgIdx,
      reason: "recover_download",
    });
  }

  function navigate(dir: "prev" | "next") {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const targetIdx = dir === "prev" ? modal.prevIdx : modal.nextIdx;
    if (!chatKey || typeof targetIdx !== "number" || !Number.isFinite(targetIdx)) return;
    void openFromMessageIndex(chatKey, targetIdx);
  }

  function openAtIndex(msgIdx: number) {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    if (!chatKey) return;
    if (!Number.isFinite(msgIdx)) return;
    void openFromMessageIndex(chatKey, Math.trunc(msgIdx));
  }

  function jumpFromViewer() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;
    if (!chatKey || msgIdx === null) return;
    const selectedKey = st.selected ? conversationKey(st.selected) : "";
    if (!selectedKey || selectedKey !== chatKey) return;
    closeModal();
    window.setTimeout(() => jumpToChatMsgIdx(msgIdx), 0);
  }

  return {
    buildModalState,
    openFromMessageIndex,
    recoverCurrent,
    navigate,
    openAtIndex,
    jumpFromViewer,
  };
}
