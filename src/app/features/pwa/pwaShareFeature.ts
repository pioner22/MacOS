import { APP_MSG_MAX_LEN } from "../../../config/app";
import { conversationKey } from "../../../helpers/chat/conversationKey";
import { updateDraftMap } from "../../../helpers/chat/drafts";
import { applyDraftMapMutation } from "../../../helpers/runtime/deliverySync";
import type { Store } from "../../../stores/store";
import type { AppState, ConnStatus, TargetRef } from "../../../stores/types";

export type ToastFn = (
  message: string,
  opts?: {
    kind?: "info" | "success" | "warn" | "error";
    undo?: () => void;
    actions?: Array<{ id: string; label: string; primary?: boolean; onClick: () => void }>;
    timeoutMs?: number;
    placement?: "bottom" | "center";
  }
) => void;

export interface PwaShareFeatureDeps {
  store: Store<AppState>;
  input: HTMLTextAreaElement;
  autosizeInput: (el: HTMLTextAreaElement) => void;
  scheduleSaveDrafts: () => void;
  showToast: ToastFn;
  canSendFiles: () => boolean;
  sendFile: (file: File, target: TargetRef, caption: string) => void;
}

export interface PwaShareFeature {
  installEventListeners: () => void;
  dispose: () => void;
  tryAppendShareTextToSelected: (text: string) => boolean;
}

type PwaSharePayload = {
  files: File[];
  title: string;
  text: string;
  url: string;
};

function normalizeSharePayload(raw: any): PwaSharePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const filesRaw = Array.isArray(raw.files) ? raw.files : [];
  const files = filesRaw.filter((f: unknown) => f && typeof f === "object" && typeof (f as any).arrayBuffer === "function") as File[];
  const title = String(raw.title ?? "").trim();
  const text = String(raw.text ?? "").trim();
  const url = String(raw.url ?? "").trim();
  if (!files.length && !title && !text && !url) return null;
  return { files, title, text, url };
}

function formatShareCaption(payload: PwaSharePayload): string {
  const parts = [payload.title, payload.text, payload.url].map((v) => String(v || "").trim()).filter(Boolean);
  if (!parts.length) return "";
  let caption = parts.join("\n").trim();
  if (caption.length > APP_MSG_MAX_LEN) caption = caption.slice(0, APP_MSG_MAX_LEN);
  return caption;
}

export function createPwaShareFeature(deps: PwaShareFeatureDeps): PwaShareFeature {
  const { store, input, autosizeInput, scheduleSaveDrafts, showToast, canSendFiles, sendFile } = deps;
  const pendingShareQueue: PwaSharePayload[] = [];
  let listenersInstalled = false;

  function appendShareTextToComposer(text: string, target: TargetRef) {
    if (!text) return;
    const prevText = String(input.value || "");
    const next = prevText ? `${prevText}\n${text}` : text;
    const nextTrimmed = next.length > APP_MSG_MAX_LEN ? next.slice(0, APP_MSG_MAX_LEN) : next;
    input.value = nextTrimmed;
    autosizeInput(input);
    store.set((prev) => {
      const key = conversationKey(target);
      const drafts = updateDraftMap(prev.drafts, key, nextTrimmed);
      return { ...applyDraftMapMutation(prev, drafts), input: nextTrimmed };
    });
    scheduleSaveDrafts();
  }

  function canSendShareNow(st: AppState, target: TargetRef | null): { ok: boolean; reason: string } {
    if (st.conn !== "connected") return { ok: false, reason: "Нет соединения" };
    if (!st.authed) return { ok: false, reason: "Сначала войдите или зарегистрируйтесь" };
    if (!target) return { ok: false, reason: "Выберите контакт или чат слева" };
    if (target.kind === "group") {
      const g = st.groups.find((x) => x.id === target.id);
      const me = String(st.selfId || "").trim();
      const owner = String(g?.owner_id || "").trim();
      const banned = (g?.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean);
      if (me && owner && me !== owner && banned.includes(me)) {
        return { ok: false, reason: "Вам запрещено писать в чате" };
      }
    }
    if (target.kind === "board") {
      const b = st.boards.find((x) => x.id === target.id);
      const owner = String(b?.owner_id || "").trim();
      const me = String(st.selfId || "").trim();
      if (owner && me && owner !== me) {
        return { ok: false, reason: "На доске писать может только владелец" };
      }
    }
    return { ok: true, reason: "" };
  }

  function flushPendingShareQueue() {
    if (!pendingShareQueue.length) return;
    const st = store.get();
    const target = st.selected;
    const canSend = canSendShareNow(st, target);
    if (!canSend.ok) {
      store.set({ status: canSend.reason });
      return;
    }
    if (!target) return;
    if (!canSendFiles()) return;
    const payloads = pendingShareQueue.splice(0, pendingShareQueue.length);
    let sentFiles = 0;
    let textOnly = 0;
    for (const payload of payloads) {
      const caption = formatShareCaption(payload);
      const files = payload.files || [];
      if (files.length) {
        const canCaption = Boolean(caption) && !st.editing;
        for (let i = 0; i < files.length; i += 1) {
          sendFile(files[i], target, i === 0 && canCaption ? caption : "");
          sentFiles += 1;
        }
        if (caption && !canCaption) {
          if (!st.editing) appendShareTextToComposer(caption, target);
          else store.set({ status: "Подпись из share не добавлена: вы редактируете сообщение" });
        }
      } else if (caption) {
        textOnly += 1;
        if (!st.editing) appendShareTextToComposer(caption, target);
      }
    }
    if (sentFiles > 0) {
      showToast(`Поделиться: отправлено файлов — ${sentFiles}`, { kind: "success" });
    } else if (textOnly > 0) {
      showToast("Поделиться: текст добавлен в поле ввода", { kind: "info" });
    }
  }

  function enqueueSharePayload(payload: PwaSharePayload) {
    pendingShareQueue.push(payload);
    if (pendingShareQueue.length > 8) pendingShareQueue.splice(0, pendingShareQueue.length - 8);
    const fileCount = payload.files?.length || 0;
    const label = fileCount ? `Файлов: ${fileCount}` : "Текст";
    showToast(`Поделиться: получено (${label})`, { kind: "info", timeoutMs: 4000 });
    flushPendingShareQueue();
  }

  let sharePrevConn: ConnStatus = store.get().conn;
  let sharePrevAuthed = store.get().authed;
  const initialShareSelected = store.get().selected;
  let sharePrevSelKey = initialShareSelected ? conversationKey(initialShareSelected) : "";
  store.subscribe(() => {
    if (!pendingShareQueue.length) {
      const st = store.get();
      sharePrevConn = st.conn;
      sharePrevAuthed = st.authed;
      sharePrevSelKey = st.selected ? conversationKey(st.selected) : "";
      return;
    }
    const st = store.get();
    const nextSelKey = st.selected ? conversationKey(st.selected) : "";
    const changed = st.conn !== sharePrevConn || st.authed !== sharePrevAuthed || nextSelKey !== sharePrevSelKey;
    sharePrevConn = st.conn;
    sharePrevAuthed = st.authed;
    sharePrevSelKey = nextSelKey;
    if (changed) flushPendingShareQueue();
  });

  const onPwaShare = (e: Event) => {
    const ev = e as CustomEvent;
    const payload = normalizeSharePayload(ev?.detail);
    if (!payload) return;
    enqueueSharePayload(payload);
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    window.addEventListener("yagodka:pwa-share", onPwaShare);
  }

  function dispose() {
    if (!listenersInstalled) return;
    listenersInstalled = false;
    try {
      window.removeEventListener("yagodka:pwa-share", onPwaShare);
    } catch {
      // ignore
    }
  }

  function tryAppendShareTextToSelected(text: string): boolean {
    const st = store.get();
    const target = st.selected;
    const canSend = canSendShareNow(st, target);
    if (canSend.ok && target) {
      appendShareTextToComposer(text, target);
      return true;
    }
    return false;
  }

  return { installEventListeners, dispose, tryAppendShareTextToSelected };
}
