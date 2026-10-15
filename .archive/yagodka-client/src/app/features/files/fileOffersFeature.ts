import { dmKey, roomKey } from "../../../helpers/chat/conversationKey";
import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import { isTerminalFileTransferStatus } from "../../../helpers/runtime/deliveryCoordinator";
import { isViewingDmPeer, isViewingRoomId } from "../../../helpers/navigation/mainConversationState";
import { upsertConversation } from "../../../helpers/chat/upsertConversation";
import { resolveMediaKind } from "../../../helpers/files/mediaKind";
import { nowTs } from "../../../helpers/time";
import type { Store } from "../../../stores/store";
import type { AppState, FileOfferIn } from "../../../stores/types";

type ToastKind = "info" | "success" | "warn" | "error";

type ShowToastFn = (message: string, opts?: { kind?: ToastKind; timeoutMs?: number }) => void;

type TabNotifierSnapshot = {
  leader: boolean;
  anyFocused: boolean;
};

type TabNotifierLike = {
  shouldShowSystemNotification: (key: string) => boolean;
  shouldShowToast: (key: string) => boolean;
  getSnapshot: () => TabNotifierSnapshot;
};

export interface FileOffersFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  isFileHttpDisabled: () => boolean;
  nextTransferId: () => string;
  markSilentFileGet: (fileId: string) => void;
  scheduleSaveFileTransfers: () => void;
  showToast: ShowToastFn;
  tabNotifier: TabNotifierLike;
  recordRoomLastReadEntry: (key: string, msg: any) => void;
  maybeSendMessageRead: (peerId: string, upToId?: number | null) => void;
}

export interface FileOffersFeature {
  handleMessage: (msg: any) => boolean;
  accept: (fileId: string, offerOverride?: FileOfferIn | null, opts?: { silent?: boolean; closeModal?: boolean }) => void;
  reject: (fileId: string) => void;
  clearCompleted: () => void;
}

export function shouldAutoAcceptFileOffer(name: string, mime: string | null | undefined): boolean {
  const kind = resolveMediaKind(name, mime, null);
  return kind !== "image" && kind !== "video";
}

export function createFileOffersFeature(deps: FileOffersFeatureDeps): FileOffersFeature {
  const {
    store,
    send,
    isFileHttpDisabled,
    nextTransferId,
    markSilentFileGet,
    scheduleSaveFileTransfers,
    showToast,
    tabNotifier,
    recordRoomLastReadEntry,
    maybeSendMessageRead,
  } = deps;

  function accept(fileId: string, offerOverride?: FileOfferIn | null, opts?: { silent?: boolean; closeModal?: boolean }) {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const offer = offerOverride ?? store.get().fileOffersIn.find((entry) => entry.id === fid) ?? null;
    const silent = Boolean(opts?.silent);
    const closeModal = opts?.closeModal !== false;
    if (silent) markSilentFileGet(fid);
    send({ type: "file_accept", file_id: fid, ...(isFileHttpDisabled() ? {} : { transport: "http" }) });
    store.set((prev) => {
      const transfers = [...prev.fileTransfers];
      if (offer) {
        const idx = transfers.findIndex((entry) => entry.id === fid && entry.direction === "in");
        const base = {
          localId: idx >= 0 ? transfers[idx].localId : nextTransferId(),
          id: fid,
          name: offer.name || "файл",
          size: offer.size || 0,
          mime: offer.mime || null,
          direction: "in" as const,
          peer: offer.from || "—",
          room: offer.room ?? null,
          status: "offering" as const,
          progress: 0,
        };
        if (idx >= 0) transfers[idx] = { ...transfers[idx], ...base };
        else transfers.unshift(base);
      }
      const next = applyFileTransferMutation(prev, transfers);
      return {
        ...next,
        fileOffersIn: prev.fileOffersIn.filter((entry) => entry.id !== fid),
        ...(closeModal ? { modal: null } : {}),
        ...(silent ? {} : { status: offer ? `Принят файл: ${offer.name || "файл"}` : "Файл принят" }),
      };
    });
    scheduleSaveFileTransfers();
  }

  function reject(fileId: string) {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    const offer = store.get().fileOffersIn.find((entry) => entry.id === fid);
    send({ type: "file_reject", file_id: fid });
    store.set((prev) => {
      const nextTransfers = offer
        ? [
            {
              localId: nextTransferId(),
              id: offer.id,
              name: offer.name || "файл",
              size: offer.size || 0,
              direction: "in" as const,
              peer: offer.from || "—",
              room: offer.room ?? null,
              status: "rejected" as const,
              progress: 0,
            },
            ...prev.fileTransfers,
          ]
        : prev.fileTransfers;
      const next = applyFileTransferMutation(prev, nextTransfers);
      return {
        ...next,
        fileOffersIn: prev.fileOffersIn.filter((entry) => entry.id !== fid),
        modal: null,
        status: offer ? `Отклонен файл: ${offer.name || "файл"}` : "Файл отклонен",
      };
    });
    scheduleSaveFileTransfers();
  }

  function clearCompleted() {
    const toRevoke = store
      .get()
      .fileTransfers.filter((entry) => isTerminalFileTransferStatus(entry.status))
      .map((entry) => entry.url)
      .filter((url): url is string => Boolean(url));
    for (const url of toRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    store.set((prev) => ({
      ...applyFileTransferMutation(
        prev,
        prev.fileTransfers.filter((entry) => !isTerminalFileTransferStatus(entry.status))
      ),
      status: "Список передач очищен",
    }));
    scheduleSaveFileTransfers();
  }

  function handleFileOffer(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    if (!fileId) return true;
    const rawMsgId = msg?.msg_id;
    const msgId = typeof rawMsgId === "number" && Number.isFinite(rawMsgId) ? rawMsgId : null;
    const text = typeof msg?.text === "string" ? String(msg.text) : "";
    const mimeRaw = msg?.mime;
    const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : null;
    const offer: FileOfferIn = {
      id: fileId,
      from: String(msg?.from ?? "").trim() || "—",
      name: String(msg?.name ?? "файл"),
      size: Number(msg?.size ?? 0) || 0,
      room: typeof msg?.room === "string" ? msg.room : null,
      ...(mime ? { mime } : {}),
    };
    const key = offer.room ? roomKey(offer.room) : dmKey(offer.from);
    const inMsg = {
      kind: "in" as const,
      from: offer.from,
      to: store.get().selfId || "",
      room: offer.room ?? undefined,
      text,
      ts: nowTs(),
      id: msgId ?? null,
      attachment: {
        kind: "file" as const,
        fileId,
        name: offer.name,
        size: offer.size,
        ...(mime ? { mime } : {}),
      },
    };
    store.set((prev) => upsertConversation(prev, key, inMsg));
    const stNow = store.get();
    const roomId = offer.room ? String(offer.room) : "";
    const notifKey = roomId ? `file_offer:room:${roomId}:${fileId}` : `file_offer:dm:${offer.from}:${fileId}`;
    const viewingSame = Boolean((roomId && isViewingRoomId(stNow, roomId)) || (!roomId && isViewingDmPeer(stNow, offer.from)));
    try {
      if (stNow.notifyInAppEnabled && Notification?.permission === "granted" && tabNotifier.shouldShowSystemNotification(notifKey)) {
        const profile = stNow.profiles?.[offer.from];
        let fromLabel = String(profile?.display_name || "").trim();
        if (!fromLabel) {
          const handle = String(profile?.handle || "").trim();
          fromLabel = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : offer.from;
        }
        const label = String(offer.name || "файл").replace(/\\s+/g, " ").trim();
        let title = `Файл от ${fromLabel || offer.from}`;
        if (roomId) {
          const group = (stNow.groups || []).find((g) => g.id === roomId);
          const board = !group ? (stNow.boards || []).find((b) => b.id === roomId) : null;
          const roomLabel = group ? String(group.name || group.id) : board ? String(board.name || board.id) : roomId;
          title = group ? `Чат: ${roomLabel}` : board ? `Доска: ${roomLabel}` : `Чат: ${roomLabel}`;
        }
        const body = roomId
          ? `${fromLabel || offer.from}: ${label ? `Файл: ${label}` : "Файл"}`
          : label
            ? `Файл: ${label}`
            : "Файл";
        const tag = roomId ? `yagodka:room:${roomId}` : `yagodka:dm:${offer.from}`;
        new Notification(title, { body, tag, silent: true });
      }
    } catch {
      // ignore
    }
    if (!viewingSame && tabNotifier.shouldShowToast(notifKey)) {
      const raw = String(offer.name || "файл")
        .replace(/\\s+/g, " ")
        .trim();
      const label = raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
      showToast(`Входящий файл: ${label || "файл"}`, { kind: "info", timeoutMs: 7000 });
    }
    if (viewingSame) {
      if (roomId) {
        recordRoomLastReadEntry(key, inMsg);
      } else {
        const upToId = msgId ?? undefined;
        maybeSendMessageRead(offer.from, upToId);
      }
    }
    // Auto-accept non-visual files only. Photo/video chat cards are click-to-load so
    // stale media does not start background downloads in PWA chat/history.
    try {
      const hasTransfer = stNow.fileTransfers.some((t) => t.direction === "in" && String(t.id || "").trim() === fileId);
      const snap = tabNotifier.getSnapshot();
      const focused = typeof document.hasFocus === "function" ? document.hasFocus() : false;
      const canAutoAccept = shouldAutoAcceptFileOffer(offer.name, offer.mime ?? null) && (focused || (snap.leader && !snap.anyFocused));
      if (!hasTransfer && canAutoAccept && stNow.conn === "connected" && stNow.authed) {
        accept(fileId, offer, { silent: true, closeModal: false });
      }
    } catch {
      // ignore
    }
    return true;
  }

  function handleMessage(msg: any): boolean {
    const t = String(msg?.type ?? "");
    if (t === "file_offer") return handleFileOffer(msg);
    return false;
  }

  return { handleMessage, accept, reject, clearCompleted };
}
