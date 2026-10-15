import { conversationKey } from "../../../helpers/chat/conversationKey";
import { getCachedFileBlob } from "../../../helpers/files/fileBlobCache";
import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import { markPwaStabilityHold } from "../../../helpers/pwa/stabilityHold";
import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";
import type { DownloadState } from "./fileDownloadFeature";

type StreamRequestTarget = "download" | "viewer";

type StreamRequestMeta = {
  fileId: string;
  name: string;
  size: number;
  mime: string | null;
  streamId: string;
  url: string;
  target: StreamRequestTarget;
};

export interface FileDownloadActionsFeatureDeps {
  store: Store<AppState>;
  downloadByFileId: Map<string, DownloadState>;
  enqueueFileGet: (fileId: string, opts?: { priority?: "high" | "prefetch"; silent?: boolean }) => void;
  scheduleSaveFileTransfers: () => void;
}

export interface FileDownloadActionsFeature {
  pendingFileDownloads: Map<string, { name: string }>;
  resolveFileMeta: (fileId: string) => { name: string; size: number; mime: string | null };
  beginDownload: (fileId: string) => Promise<void>;
  beginViewerStream: (fileId: string, meta?: { name?: string; size?: number; mime?: string | null }) => string | null;
  handlePwaStreamReady: (detail: any) => void;
  triggerBrowserDownload: (url: string, name: string) => void;
  postStreamChunk: (streamId: string, chunk: Uint8Array) => boolean;
  postStreamEnd: (streamId: string) => boolean;
  postStreamError: (streamId: string, error: string) => boolean;
  reset: () => void;
}

export function createFileDownloadActionsFeature(deps: FileDownloadActionsFeatureDeps): FileDownloadActionsFeature {
  const { store, downloadByFileId, enqueueFileGet, scheduleSaveFileTransfers } = deps;

  const pendingFileDownloads = new Map<string, { name: string }>();
  const pendingStreamRequests = new Map<string, StreamRequestMeta>();

  const STREAM_MIN_BYTES = 8 * 1024 * 1024;

  function supportsStreamDownload(): boolean {
    try {
      return Boolean("serviceWorker" in navigator && navigator.serviceWorker.controller && "ReadableStream" in window);
    } catch {
      return false;
    }
  }

  function postStreamMessage(message: { type: string; streamId: string; [key: string]: any }, transfer?: Transferable[]): boolean {
    try {
      const controller = navigator.serviceWorker.controller;
      if (!controller) return false;
      if (transfer && transfer.length) {
        try {
          controller.postMessage(message, transfer);
          return true;
        } catch {
          // ignore and retry without transfer list
        }
      }
      controller.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function postStreamChunk(streamId: string, chunk: Uint8Array): boolean {
    return postStreamMessage({ type: "PWA_STREAM_CHUNK", streamId, chunk }, [chunk.buffer]);
  }

  function postStreamEnd(streamId: string): boolean {
    return postStreamMessage({ type: "PWA_STREAM_END", streamId });
  }

  function postStreamError(streamId: string, error: string): boolean {
    return postStreamMessage({ type: "PWA_STREAM_ERROR", streamId, error });
  }

  function makeStreamId(): string {
    try {
      const uuid = (globalThis.crypto as any)?.randomUUID?.();
      if (typeof uuid === "string" && uuid) return uuid;
    } catch {
      // ignore
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildStreamUrl(
    fileId: string,
    meta: { name: string; size: number; mime: string | null },
    streamId: string,
    opts?: { inline?: boolean }
  ): string {
    const params = new URLSearchParams();
    params.set("sid", streamId);
    if (meta.name) params.set("name", meta.name);
    if (meta.size) params.set("size", String(meta.size));
    if (meta.mime) params.set("mime", meta.mime);
    if (opts?.inline) params.set("inline", "1");
    return `/__yagodka_stream__/files/${encodeURIComponent(fileId)}?${params.toString()}`;
  }

  function triggerBrowserDownload(url: string, name: string): void {
    let clicked = false;
    try {
      const a = document.createElement("a");
      a.href = url;
      if (name) a.download = name;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => a.remove(), 0);
      clicked = true;
    } catch {
      clicked = false;
    }
    if (clicked) return;

    try {
      const opened = typeof window.open === "function" ? window.open(url, "_blank", "noopener,noreferrer") : null;
      if (opened) {
        try {
          opened.opener = null;
        } catch {
          // ignore
        }
        return;
      }
    } catch {
      // ignore
    }

    markPwaStabilityHold("file_download_open_failed");
    store.set({ status: `Ошибка файла: не удалось открыть скачивание (${name || "файл"})` });
  }

  function startStreamDownload(fileId: string, meta: { name: string; size: number; mime: string | null }): boolean {
    if (!supportsStreamDownload()) return false;
    if (pendingStreamRequests.size > 16) return false;
    const existing = Array.from(pendingStreamRequests.values()).some((req) => req.fileId === fileId);
    if (existing) return false;
    const streamId = makeStreamId();
    const url = buildStreamUrl(fileId, meta, streamId);
    pendingStreamRequests.set(streamId, {
      fileId,
      name: meta.name,
      size: meta.size,
      mime: meta.mime,
      streamId,
      url,
      target: "download",
    });
    triggerBrowserDownload(url, meta.name || "file");
    window.setTimeout(() => {
      if (pendingStreamRequests.has(streamId)) pendingStreamRequests.delete(streamId);
    }, 5000);
    return true;
  }

  function beginViewerStream(
    fileId: string,
    meta?: { name?: string; size?: number; mime?: string | null }
  ): string | null {
    const fid = String(fileId || "").trim();
    if (!fid) return null;
    if (!supportsStreamDownload()) return null;
    const resolved = resolveFileMeta(fid);
    const name = String(meta?.name || resolved.name || "файл");
    const size = Number(meta?.size || resolved.size || 0) || 0;
    const mime = meta?.mime ?? resolved.mime ?? null;
    const existing = Array.from(pendingStreamRequests.values()).find(
      (req) => req.fileId === fid && req.target === "viewer"
    );
    if (existing?.url) return existing.url;
    if (pendingStreamRequests.size > 16) return null;
    const streamId = makeStreamId();
    const url = buildStreamUrl(fid, { name, size, mime }, streamId, { inline: true });
    pendingStreamRequests.set(streamId, {
      fileId: fid,
      name,
      size,
      mime,
      streamId,
      url,
      target: "viewer",
    });
    window.setTimeout(() => {
      const pending = pendingStreamRequests.get(streamId);
      if (pending?.target === "viewer") pendingStreamRequests.delete(streamId);
    }, 10_000);
    return url;
  }

  function resolveFileMeta(fileId: string): { name: string; size: number; mime: string | null } {
    const fid = String(fileId || "").trim();
    if (!fid) return { name: "файл", size: 0, mime: null };
    const st = store.get();
    const transfer = st.fileTransfers.find((t) => String(t.id || "").trim() === fid);
    if (transfer) {
      return { name: transfer.name || "файл", size: Number(transfer.size || 0) || 0, mime: transfer.mime ?? null };
    }
    const offer = st.fileOffersIn.find((o) => String(o.id || "").trim() === fid);
    if (offer) {
      return { name: offer.name || "файл", size: Number(offer.size || 0) || 0, mime: offer.mime ?? null };
    }
    const key = st.selected ? conversationKey(st.selected) : "";
    const msgs = key ? st.conversations[key] || [] : [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const att = msgs[i]?.attachment;
      if (att?.kind !== "file") continue;
      const msgFid = String(att.fileId || "").trim();
      if (!msgFid || msgFid !== fid) continue;
      return { name: att.name || "файл", size: Number(att.size || 0) || 0, mime: att.mime ?? null };
    }
    return { name: "файл", size: 0, mime: null };
  }

  async function tryServeFromCache(fileId: string, meta: { name: string; size: number; mime: string | null }): Promise<boolean> {
    const fid = String(fileId || "").trim();
    if (!fid) return false;
    const st = store.get();
    if (!st.selfId) return false;
    const cached = await getCachedFileBlob(st.selfId, fid);
    if (!cached) return false;
    let url: string | null = null;
    try {
      url = URL.createObjectURL(cached.blob);
    } catch {
      url = null;
    }
    if (!url) return false;

    const entry = st.fileTransfers.find((t) => String(t.id || "").trim() === fid);
    const name = meta.name || entry?.name || "файл";
    const size = meta.size || entry?.size || cached.size || 0;
    const mime = meta.mime || entry?.mime || cached.mime || null;
    const direction = entry?.direction || "in";
    const peer = entry?.peer || "—";
    const room = typeof entry?.room === "string" ? entry.room : null;

    store.set((prev) => {
      const existing = prev.fileTransfers.find((t) => String(t.id || "").trim() === fid);
      if (existing) {
        const nextTransfers = prev.fileTransfers.map<FileTransferEntry>((t) => {
          if (String(t.id || "").trim() !== fid) return t;
          if (t.url && t.url !== url) {
            try {
              URL.revokeObjectURL(t.url);
            } catch {
              // ignore
            }
          }
          return {
            ...t,
            name,
            size,
            mime,
            url,
            status: t.status === "uploaded" ? "uploaded" : "complete",
            progress: 100,
          };
        });
        return applyFileTransferMutation(prev, nextTransfers);
      }
      const nextEntry: FileTransferEntry = {
        localId: `ft-cache-${fid}`,
        id: fid,
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
      return applyFileTransferMutation(prev, [nextEntry, ...prev.fileTransfers]);
    });
    scheduleSaveFileTransfers();
    triggerBrowserDownload(url, name);
    return true;
  }

  async function beginDownload(fileId: string): Promise<void> {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const meta = resolveFileMeta(fid);
    const fromCache = await tryServeFromCache(fid, meta);
    if (fromCache) return;
    const st = store.get();
    const entry = st.fileTransfers.find((t) => String(t.id || "").trim() === fid);
    if (entry?.url) {
      triggerBrowserDownload(entry.url, meta.name || entry.name || "файл");
      return;
    }
    if (downloadByFileId.has(fid)) {
      pendingFileDownloads.set(fid, { name: meta.name || entry?.name || "файл" });
      store.set({ status: `Скачивание: ${meta.name || entry?.name || fid}` });
      return;
    }
    const canStream = Number(meta.size || 0) >= STREAM_MIN_BYTES && startStreamDownload(fid, meta);
    if (canStream) {
      store.set({ status: `Скачивание: ${meta.name || "файл"}` });
      return;
    }
    pendingFileDownloads.set(fid, { name: meta.name || "файл" });
    enqueueFileGet(fid, { priority: "high" });
    store.set({ status: `Скачивание: ${meta.name || fid}` });
  }

  function handlePwaStreamReady(detail: any) {
    const streamId = String(detail?.streamId || "").trim();
    const fileId = String(detail?.fileId || "").trim();
    if (!streamId) return;
    const req = pendingStreamRequests.get(streamId);
    if (!req) return;
    if (fileId && req.fileId !== fileId) return;
    pendingStreamRequests.delete(streamId);
    const st = store.get();
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    downloadByFileId.set(req.fileId, {
      fileId: req.fileId,
      name: req.name || "файл",
      size: req.size || 0,
      from: "—",
      room: null,
      mime: req.mime,
      chunks: [],
      received: 0,
      lastProgress: 0,
      streamId,
      streaming: true,
    });
    enqueueFileGet(req.fileId, { priority: "high" });
    if (req.target !== "viewer") {
      store.set({ status: `Скачивание: ${req.name || "файл"}` });
    }
  }

  function reset() {
    pendingFileDownloads.clear();
    pendingStreamRequests.clear();
  }

  return {
    pendingFileDownloads,
    resolveFileMeta,
    beginDownload,
    beginViewerStream,
    handlePwaStreamReady,
    triggerBrowserDownload,
    postStreamChunk,
    postStreamEnd,
    postStreamError,
    reset,
  };
}
