import { conversationKey } from "../../../helpers/chat/conversationKey";
import { upsertConversation } from "../../../helpers/chat/upsertConversation";
import { arrayBufferToBase64 } from "../../../helpers/files/base64";
import { liftFileHttpTokenToBearer, rememberFileHttpBearer } from "../../../helpers/files/fileHttpAuth";
import { guessMimeTypeByName } from "../../../helpers/files/mimeGuess";
import { registerPwaReloadBlocker } from "../../../helpers/pwa/reloadSafety";
import {
  computeDeliveryRetryDelayMs,
  getDeliveryRetryPolicy,
  parseDeliveryRetryAfterMs,
  shouldFallbackUploadHttpToLegacy,
} from "../../../helpers/runtime/deliveryCoordinator";
import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import { nowTs } from "../../../helpers/time";
import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry, TargetRef } from "../../../stores/types";

interface UploadState {
  localId: string;
  file: File;
  target: TargetRef;
  caption?: string;
  fileId?: string | null;
  bytesSent: number;
  seq: number;
  lastProgress: number;
  aborted: boolean;
}

export interface FileUploadFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  fileUploadMaxConcurrency: number;
  isFileHttpDisabled: () => boolean;
  disableFileHttp: (reason: string) => void;
  nextTransferId: () => string;
  markChatAutoScroll: (key: string, waitForHistory?: boolean) => void;
  updateTransferByLocalId: (localId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => void;
  updateTransferByFileId: (fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => void;
  updateConversationFileMessage: (key: string, localId: string, apply: (msg: any) => any) => void;
  removeConversationFileMessage: (key: string, localId: string) => void;
  onFileIdResolved?: (fileId: string, file: File) => void;
  reportIncident?: (kind: string, detail?: Record<string, unknown> | null, opts?: { key?: string; dedupeMs?: number }) => boolean;
}

export interface FileUploadFeature {
  sendFile: (file: File | null, target: TargetRef | null, caption?: string) => void;
  handleMessage: (msg: any) => boolean;
  hasPendingActivityForUpdate: () => boolean;
  isUploadActive: (fileId: string) => boolean;
  abortUploadByFileId: (fileId: string) => void;
}

function formatFileOfferError(reason: string): string {
  const r = String(reason || "").trim();
  if (!r) return "ошибка";
  if (r === "file_too_large") return "слишком большой файл";
  if (r === "file_quota_exceeded") return "превышен лимит хранилища";
  if (r === "too_many_offers") return "слишком много активных отправок";
  if (r === "not_authorized") return "нет доступа к контакту";
  if (r === "blocked_by_recipient") return "получатель заблокировал вас";
  if (r === "blocked_by_sender") return "вы заблокировали получателя";
  if (r === "not_in_group") return "вы не участник чата";
  if (r === "group_post_forbidden") return "вам запрещено писать в чате";
  if (r === "board_post_forbidden") return "на доске писать может только владелец";
  if (r === "invalid_room_id") return "неверный адресат";
  if (r === "server_storage_error") return "ошибка хранения на сервере";
  return r;
}

export function createFileUploadFeature(deps: FileUploadFeatureDeps): FileUploadFeature {
  const {
    store,
    send,
    fileUploadMaxConcurrency,
    isFileHttpDisabled,
    disableFileHttp,
    nextTransferId,
    markChatAutoScroll,
    updateTransferByLocalId,
    updateTransferByFileId,
    updateConversationFileMessage,
    removeConversationFileMessage,
    onFileIdResolved,
    reportIncident,
  } = deps;

  const uploadQueue: UploadState[] = [];
  const uploadInFlightByLocalId = new Map<string, UploadState>();
  const uploadByFileId = new Map<string, UploadState>();

  function hasPendingActivityForUpdate(): boolean {
    return Boolean(
      uploadQueue.some((upload) => !upload.aborted) ||
        Array.from(uploadInFlightByLocalId.values()).some((upload) => !upload.aborted) ||
        Array.from(uploadByFileId.values()).some((upload) => !upload.aborted)
    );
  }
  registerPwaReloadBlocker("file_upload", hasPendingActivityForUpdate);

  function queueUpload(localId: string, file: File, target: TargetRef, caption?: string) {
    uploadQueue.push({
      localId,
      file,
      target,
      caption,
      bytesSent: 0,
      seq: 0,
      lastProgress: 0,
      aborted: false,
    });
    pumpUploadQueue();
  }

  function finishUpload(upload: UploadState) {
    if (upload.fileId) uploadByFileId.delete(upload.fileId);
    uploadInFlightByLocalId.delete(upload.localId);
    pumpUploadQueue();
  }

  function pumpUploadQueue() {
    while (uploadInFlightByLocalId.size < fileUploadMaxConcurrency && uploadQueue.length > 0) {
      const next = uploadQueue.shift();
      if (!next) return;
      uploadInFlightByLocalId.set(next.localId, next);
      const payload: Record<string, unknown> = {
        type: "file_offer",
        ...(isFileHttpDisabled() ? {} : { transport: "http" }),
        local_id: next.localId,
        name: next.file.name || "файл",
        size: next.file.size || 0,
      };
      let mime = typeof next.file.type === "string" ? next.file.type.trim() : "";
      if (!mime) {
        const guessed = guessMimeTypeByName(next.file.name || "");
        if (guessed && guessed !== "application/octet-stream") {
          mime = guessed;
        }
      }
      if (mime) payload.mime = mime;
      if (next.caption) payload.text = next.caption;
      if (next.target.kind === "dm") {
        payload.to = next.target.id;
      } else {
        payload.room = next.target.id;
      }
      send(payload);
      store.set({ status: `Предложение файла: ${next.file.name || "файл"}` });
    }
  }

  async function uploadFileChunks(upload: UploadState) {
    const fileId = upload.fileId;
    if (!fileId) {
      updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "error", error: "missing_file_id" }));
      finishUpload(upload);
      return;
    }
    try {
      const size = upload.file.size || 0;
      const chunkSize = 64 * 1024;
      while (!upload.aborted && upload.bytesSent < size) {
        const slice = upload.file.slice(upload.bytesSent, upload.bytesSent + chunkSize);
        const buffer = await slice.arrayBuffer();
        if (upload.aborted) break;
        const data = arrayBufferToBase64(buffer);
        send({ type: "file_chunk", file_id: fileId, seq: upload.seq, data });
        upload.seq += 1;
        upload.bytesSent += buffer.byteLength;
        const pct = size > 0 ? Math.min(100, Math.round((upload.bytesSent / size) * 100)) : 0;
        if (pct !== upload.lastProgress) {
          upload.lastProgress = pct;
          updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, progress: pct, status: "uploading" }));
        }
      }
      if (!upload.aborted) {
        send({ type: "file_upload_complete", file_id: fileId });
        updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "uploaded", progress: 100 }));
        store.set({ status: `Файл загружен: ${upload.file.name || "файл"}` });
      }
    } catch {
      updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "error", error: "upload_failed" }));
      store.set({ status: `Ошибка загрузки: ${upload.file.name || "файл"}` });
    } finally {
      finishUpload(upload);
    }
  }

  async function uploadFileHttp(upload: UploadState, uploadUrl: string) {
    const fileId = upload.fileId;
    if (!fileId) {
      updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "error", error: "missing_file_id" }));
      finishUpload(upload);
      return;
    }
    const url = String(uploadUrl || "").trim();
    if (!url) {
      updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "error", error: "missing_upload_url" }));
      finishUpload(upload);
      return;
    }
    const waitMs = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, Math.trunc(ms))));
    const retryPolicy = getDeliveryRetryPolicy("file_upload_http");

    let handedOffToLegacy = false;
    let lastHttpStatus: number | null = null;
    try {
      const size = upload.file.size || 0;
      const chunkSize = 256 * 1024;
      const httpAuth = liftFileHttpTokenToBearer(url);
      const httpUrl = httpAuth.url || url;
      const httpHeaders = httpAuth.headers;

      let offset = 0;
      const resyncOffset = async () => {
        try {
          const res = await fetch(httpUrl, { method: "HEAD", headers: httpHeaders });
          lastHttpStatus = res.status;
          const off = Number(res.headers.get("Upload-Offset") || "");
          if (Number.isFinite(off) && off >= 0) {
            offset = Math.max(0, Math.min(Math.trunc(off), size));
            upload.bytesSent = offset;
          }
        } catch {
          // ignore
        }
      };
      await resyncOffset();
      upload.bytesSent = offset;
      upload.lastProgress = 0;

      while (!upload.aborted && offset < size) {
        const slice = upload.file.slice(offset, Math.min(size, offset + chunkSize));
        let attempt = 0;
        let progressed = false;
        while (!upload.aborted && !progressed) {
          try {
            if (upload.aborted) break;
            const res = await fetch(httpUrl, {
              method: "PATCH",
              headers: {
                ...httpHeaders,
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": String(offset),
                "Content-Type": "application/offset+octet-stream",
              },
              body: slice,
            });
            lastHttpStatus = res.status;
            if (upload.aborted) break;
            if (res.status === 409) {
              const cur = Number(res.headers.get("Upload-Offset") || "");
              if (Number.isFinite(cur) && cur >= 0) {
                offset = Math.max(0, Math.min(Math.trunc(cur), size));
                upload.bytesSent = offset;
                progressed = true;
                break;
              }
              throw new Error("upload_offset_conflict");
            }
            if (res.status === 429 || res.status === 503) {
              if (attempt >= retryPolicy.maxRetries) throw new Error(`upload_http_${res.status}`);
              const retryAfterMs = parseDeliveryRetryAfterMs(res.headers.get("Retry-After"));
              const retryDelayMs = computeDeliveryRetryDelayMs(attempt, retryPolicy, {
                retryAfterMs,
                jitterRatio: 0.15 + Math.random() * 0.15,
              });
              attempt += 1;
              await waitMs(retryDelayMs);
              continue;
            }
            if (!res.ok) {
              if (res.status >= 500 && res.status < 600 && attempt < retryPolicy.maxRetries) {
                const retryDelayMs = computeDeliveryRetryDelayMs(attempt, retryPolicy, {
                  jitterRatio: 0.15 + Math.random() * 0.15,
                });
                attempt += 1;
                await waitMs(retryDelayMs);
                continue;
              }
              throw new Error(`upload_http_${res.status}`);
            }
            const nextOff = Number(res.headers.get("Upload-Offset") || "");
            if (Number.isFinite(nextOff) && nextOff >= 0) {
              offset = Math.max(offset, Math.min(Math.trunc(nextOff), size));
            } else {
              offset = Math.min(size, offset + slice.size);
            }
            upload.bytesSent = offset;
            progressed = true;
          } catch (err) {
            if (upload.aborted) break;
            const msg = err instanceof Error ? String(err.message || "") : String(err || "");
            if (shouldFallbackUploadHttpToLegacy(msg, lastHttpStatus)) throw err;
            if (attempt >= retryPolicy.maxRetries) throw err;
            attempt += 1;
            await resyncOffset();
            await waitMs(
              computeDeliveryRetryDelayMs(attempt, retryPolicy, {
                jitterRatio: 0.15 + Math.random() * 0.15,
              })
            );
          }
        }
        const pct = size > 0 ? Math.min(100, Math.round((upload.bytesSent / size) * 100)) : 0;
        if (pct !== upload.lastProgress) {
          upload.lastProgress = pct;
          updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, progress: pct, status: "uploading" }));
        }
      }
      if (!upload.aborted) {
        send({ type: "file_upload_complete", file_id: fileId });
        updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "uploaded", progress: 100 }));
        store.set({ status: `Файл загружен: ${upload.file.name || "файл"}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? String(err.message || "") : String(err || "");
      const fallback = msg || (lastHttpStatus ? `upload_http_${lastHttpStatus}` : "upload_http_failed");
      const canFallback = !upload.aborted && shouldFallbackUploadHttpToLegacy(fallback, lastHttpStatus) && (upload.file.size || 0) > 0;
      if (canFallback) {
        if (!isFileHttpDisabled()) disableFileHttp(fallback);
        handedOffToLegacy = true;
        store.set({
          status: `HTTP-загрузка недоступна (${fallback}). Резервный канал…`,
        });
        updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "uploading", error: null }));
        await uploadFileChunks(upload);
        return;
      }
      reportIncident?.(
        "file_upload_failed",
        {
          file_id: fileId,
          local_id: upload.localId,
          name: upload.file.name || null,
          mime: upload.file.type || null,
          size: upload.file.size || 0,
          reason: fallback || "upload_failed",
          http_status: lastHttpStatus,
          can_fallback: canFallback,
          transport: "http",
        },
        { key: `file_upload_failed:${fileId || upload.localId}:${fallback || "upload_failed"}`, dedupeMs: 60_000 }
      );
      updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "error", error: fallback || "upload_failed" }));
      store.set({ status: `Ошибка загрузки: ${upload.file.name || "файл"} (${fallback || "upload_failed"})` });
    } finally {
      if (!handedOffToLegacy) finishUpload(upload);
    }
  }

  function sendFile(file: File | null, target: TargetRef | null, caption?: string) {
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (!file) {
      store.set({ status: "Выберите файл" });
      return;
    }
    if (!target) {
      store.set({ status: "Выберите адресата" });
      return;
    }
    if (file.size <= 0) {
      store.set({ status: "Нельзя отправить пустой файл" });
      return;
    }
    if (target.kind === "dm" && !st.friends.some((f) => f.id === target.id)) {
      store.set({ status: `Нет доступа к контакту: ${target.id}` });
      return;
    }
    if (target.kind === "group" && !st.groups.some((g) => g.id === target.id)) {
      store.set({ status: `Вы не участник чата: ${target.id}` });
      return;
    }
    if (target.kind === "board" && !st.boards.some((b) => b.id === target.id)) {
      store.set({ status: `Вы не участник доски: ${target.id}` });
      return;
    }
    if (target.kind === "group") {
      const g = st.groups.find((g) => g.id === target.id);
      const me = String(st.selfId || "").trim();
      const owner = String(g?.owner_id || "").trim();
      const banned = (g?.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean);
      if (me && owner && me !== owner && banned.includes(me)) {
        store.set({ status: "Вам запрещено писать в чате" });
        return;
      }
    }
    if (target.kind === "board") {
      const b = st.boards.find((b) => b.id === target.id);
      const owner = String(b?.owner_id || "").trim();
      const me = String(st.selfId || "").trim();
      if (owner && me && owner !== me) {
        store.set({ status: "На доске писать может только владелец" });
        return;
      }
    }
    const captionText = String(caption ?? "").trimEnd();
    const localId = nextTransferId();
    const entry: FileTransferEntry = {
      localId,
      id: null,
      name: file.name || "файл",
      size: file.size || 0,
      mime: file.type || null,
      direction: "out",
      peer: target.id,
      room: target.kind === "dm" ? null : target.id,
      status: "offering",
      progress: 0,
      acceptedBy: [],
      receivedBy: [],
    };
    const key = conversationKey(target);
    const outMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      to: target.kind === "dm" ? target.id : undefined,
      room: target.kind === "dm" ? undefined : target.id,
      text: captionText,
      ts: nowTs(),
      id: null,
      attachment: {
        kind: "file" as const,
        localId,
        fileId: null,
        name: entry.name,
        size: entry.size,
        mime: file.type || null,
      },
    };

    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
    } catch {
      url = null;
    }
    if (url) entry.url = url;

    if (key) markChatAutoScroll(key, false);

    store.set((prev) => {
      const withMsg = upsertConversation(prev, key, outMsg);
      return {
        ...applyFileTransferMutation(withMsg, [entry, ...withMsg.fileTransfers]),
        status: `Файл предложен: ${entry.name}`,
      };
    });
    queueUpload(localId, file, target, captionText);
  }

  function handleMessage(msg: any): boolean {
    const t = String(msg?.type ?? "");

    if (t === "file_offer_result") {
      const rawLocalId = msg?.local_id ?? msg?.localId ?? "";
      const msgLocalId = typeof rawLocalId === "string" ? String(rawLocalId).trim() : "";
      let upload = msgLocalId ? uploadInFlightByLocalId.get(msgLocalId) : undefined;
      if (!upload && uploadInFlightByLocalId.size === 1) {
        upload = Array.from(uploadInFlightByLocalId.values())[0];
      }
      if (!upload) return true;
      const ok = Boolean(msg?.ok);
      if (!ok) {
        const reason = String(msg?.reason ?? "ошибка");
        const localId = upload.localId;
        const targetKey = conversationKey(upload.target);
        removeConversationFileMessage(targetKey, localId);
        const readable = formatFileOfferError(reason);
        if (targetKey) {
          store.set((prev) => ({
            ...prev,
            status: `Отправка отклонена: ${readable}`,
            conversations: upsertConversation(prev, targetKey, {
              kind: "sys",
              from: "",
              to: "",
              room: upload.target.kind === "dm" ? undefined : upload.target.id,
              text: `Файл не отправлен: ${readable}`,
              ts: nowTs(),
              id: null,
            }).conversations,
          }));
        } else {
          store.set({ status: `Отправка отклонена: ${readable}` });
        }
        updateTransferByLocalId(localId, (entry) => ({ ...entry, status: "error", error: readable }));
        finishUpload(upload);
        return true;
      }
      const fileId = String(msg?.file_id ?? "").trim();
      if (!fileId) {
        const localId = upload.localId;
        updateTransferByLocalId(localId, (entry) => ({ ...entry, status: "error", error: "missing_file_id" }));
        finishUpload(upload);
        return true;
      }
      const rawMsgId = msg?.msg_id;
      const msgId = typeof rawMsgId === "number" && Number.isFinite(rawMsgId) ? rawMsgId : null;
      try {
        const key = conversationKey(upload.target);
        updateConversationFileMessage(key, upload.localId, (m) => {
          const att = m?.attachment?.kind === "file" ? m.attachment : null;
          if (!att) return m;
          return { ...m, ...(msgId !== null ? { id: msgId } : {}), attachment: { ...att, fileId } };
        });
      } catch {
        // ignore
      }
      upload.fileId = fileId;
      uploadByFileId.set(fileId, upload);
      updateTransferByLocalId(upload.localId, (entry) => ({
        ...entry,
        id: fileId,
        status: "uploading",
        progress: 0,
        error: null,
      }));
      try {
        onFileIdResolved?.(fileId, upload.file);
      } catch {
        // ignore
      }
      store.set({ status: `Загрузка на сервер: ${upload.file.name || "файл"}` });
      const uploadUrl = typeof msg?.upload_url === "string" ? String(msg.upload_url).trim() : "";
      const uploadAuthToken =
        typeof msg?.upload_auth_token === "string" ? String(msg.upload_auth_token).trim() : "";
      if (uploadUrl && uploadAuthToken) {
        rememberFileHttpBearer(uploadUrl, uploadAuthToken, {
          base: typeof window !== "undefined" && typeof window.location?.href === "string" ? window.location.href : null,
        });
      }
      if (uploadUrl) void uploadFileHttp(upload, uploadUrl);
      else void uploadFileChunks(upload);
      return true;
    }

    if (t === "file_accept_notice") {
      const fileId = String(msg?.file_id ?? "").trim();
      const peer = String(msg?.peer ?? "").trim();
      if (fileId && peer) {
        updateTransferByFileId(fileId, (entry) => {
          if (entry.direction !== "out") return entry;
          const accepted = new Set(entry.acceptedBy ?? []);
          accepted.add(peer);
          return { ...entry, acceptedBy: Array.from(accepted) };
        });
        store.set({ status: `Получатель принял файл: ${peer}` });
      }
      return true;
    }

    if (t === "file_received") {
      const fileId = String(msg?.file_id ?? "").trim();
      const peer = String(msg?.peer ?? "").trim();
      if (fileId && peer) {
        updateTransferByFileId(fileId, (entry) => {
          if (entry.direction !== "out") return entry;
          const accepted = new Set(entry.acceptedBy ?? []);
          const received = new Set(entry.receivedBy ?? []);
          accepted.add(peer);
          received.add(peer);
          const nextStatus = entry.room ? entry.status : entry.status === "uploaded" ? "complete" : entry.status;
          return { ...entry, acceptedBy: Array.from(accepted), receivedBy: Array.from(received), status: nextStatus };
        });
        store.set({ status: `Файл получен: ${peer}` });
      }
      return true;
    }

    return false;
  }

  function isUploadActive(fileId: string): boolean {
    const fid = String(fileId || "").trim();
    if (!fid) return false;
    const upload = uploadByFileId.get(fid);
    return Boolean(upload && !upload.aborted);
  }

  function abortUploadByFileId(fileId: string) {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const upload = uploadByFileId.get(fid);
    if (upload) upload.aborted = true;
  }

  return {
    sendFile,
    handleMessage,
    hasPendingActivityForUpdate,
    isUploadActive,
    abortUploadByFileId,
  };
}
