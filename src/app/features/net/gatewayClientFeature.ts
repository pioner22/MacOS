import { GatewayClient, type GatewayRole, type GatewayTransport, type MsgHandler, type StatusHandler } from "../../../lib/net/gatewayClient";
import { MultiplexGatewayClient } from "../../../lib/net/multiplexGatewayClient";
import { isCapacitorNativeRuntime } from "../../../helpers/runtime/nativeRuntime";
import { isStandaloneDisplayMode } from "../../../helpers/ui/iosInputAssistant";
import type { Store } from "../../../stores/store";
import type { AppState, ConnStatus } from "../../../stores/types";

export type GatewayClientFeature = {
  gateway: GatewayTransport;
};

type Deps = {
  store: Store<AppState>;
  getGatewayUrl: () => string;

  handleSearchResultMessage?: (msg: any) => boolean;
  handleHistoryResultMessage?: (msg: any) => void;
  clearPendingHistoryRequests: () => void;

  handleCallsMessage?: (msg: any) => boolean;
  handleFileUploadMessage?: (msg: any) => boolean;
  handleFileMessage?: (msg: any) => boolean;

  dispatchServerMessage: (msg: any, gateway: GatewayTransport) => void;
  scheduleSaveOutbox: () => void;

  onAuthed: () => void;
  onDisconnected?: () => void;
  maybeAutoAuthOnConnected?: () => void;
};

function requeueSendingOutboxOnDisconnect(prev: AppState): AppState {
  if (!prev.selfId) return prev.authed ? { ...prev, authed: false } : prev;

  let outboxChanged = false;
  let outbox = prev.outbox;
  for (const [k, list] of Object.entries(prev.outbox || {})) {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) continue;
    const hasSending = arr.some((e) => e && typeof e === "object" && (e as any).status === "sending");
    if (!hasSending) continue;
    outboxChanged = true;
    outbox = {
      ...outbox,
      [k]: arr.map((e) =>
        e && typeof e === "object" && (e as any).status === "sending" ? { ...(e as any), status: "queued" as const } : e
      ),
    };
  }

  let conversations = prev.conversations;
  let convChanged = false;
  for (const [k, list] of Object.entries(outbox)) {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) continue;
    const lids = new Set(arr.map((e) => String(e?.localId || "").trim()).filter(Boolean));
    const conv = conversations[k];
    if (!Array.isArray(conv) || !conv.length) continue;
    const idxs: number[] = [];
    for (let i = 0; i < conv.length; i += 1) {
      const m = conv[i];
      if (m.kind !== "out") continue;
      if (m.id !== undefined && m.id !== null) continue;
      if (typeof m.localId !== "string" || !lids.has(m.localId)) continue;
      if (m.status === "queued") continue;
      idxs.push(i);
    }
    if (!idxs.length) continue;
    convChanged = true;
    const nextConv = [...conv];
    for (const i of idxs) nextConv[i] = { ...nextConv[i], status: "queued" as const };
    conversations = { ...conversations, [k]: nextConv };
  }

  const next = prev.authed ? { ...prev, authed: false } : prev;
  if (!outboxChanged && !convChanged) return next;
  return { ...next, outbox, conversations };
}

function isDesktopBridgeRuntime(): boolean {
  try {
    return typeof window !== "undefined" && Boolean((window as any).yagodkaDesktop);
  } catch {
    return false;
  }
}

function shouldUseMultiplexGateway(): boolean {
  if (isCapacitorNativeRuntime()) return false;
  if (isDesktopBridgeRuntime()) return false;
  if (isStandaloneDisplayMode()) return false;
  return (
    typeof window !== "undefined" &&
    typeof BroadcastChannel === "function" &&
    typeof navigator !== "undefined" &&
    Boolean((navigator as any)?.locks?.request)
  );
}

export function createGatewayClientFeature(deps: Deps): GatewayClientFeature {
  let lastConn: ConnStatus = "connecting";
  let gateway: GatewayTransport;

  const setStoreIfChanged = (reducer: (prev: AppState) => AppState): boolean => {
    const prev = deps.store.get();
    const next = reducer(prev);
    if (Object.is(next, prev)) return false;
    deps.store.set(() => next);
    return true;
  };

  const onRole = (role: GatewayRole) => {
    setStoreIfChanged((prev) => {
      const netLeader = role === "solo" || role === "leader";
      return prev.netLeader === netLeader ? prev : { ...prev, netLeader };
    });
  };

  const onMessage: MsgHandler = (msg) => {
    const t = String((msg as any)?.type ?? "");
    if (t === "search_result") {
      if (deps.handleSearchResultMessage?.(msg)) return;
    }
    if (t === "history_result") {
      deps.handleHistoryResultMessage?.(msg);
    }
    if (t === "error") deps.clearPendingHistoryRequests();
    if (deps.handleCallsMessage?.(msg)) return;
    if (deps.handleFileUploadMessage?.(msg)) return;
    if (deps.handleFileMessage?.(msg)) return;

    deps.dispatchServerMessage(msg, gateway);

    if (
      t === "message_delivered" ||
      t === "message_queued" ||
      t === "message_blocked" ||
      t === "error" ||
      t === "history_result"
    ) {
      deps.scheduleSaveOutbox();
    }

    if (t === "auth_ok" || t === "register_ok") {
      if (deps.store.get().netLeader) deps.onAuthed();
    }
  };

  const onStatus: StatusHandler = (conn, detail) => {
    const base =
      conn === "connected" ? "Связь с сервером установлена" : conn === "connecting" ? "Подключение…" : "Нет соединения";
    const nextStatus = detail ? `${base}: ${detail}` : base;
    setStoreIfChanged((prev) => {
      if (conn === "connecting" && prev.conn === "disconnected" && prev.modal?.kind === "auth") return prev;
      const clearWelcome = conn === "connected" && prev.modal?.kind === "welcome";
      const preserveLogoutStatus = prev.modal?.kind === "logout" || (prev.modal?.kind === "auth" && prev.status.startsWith("Вы вышли"));
      const status = preserveLogoutStatus ? prev.status : nextStatus;
      if (!clearWelcome && prev.conn === conn && prev.status === status) return prev;
      return {
        ...prev,
        conn,
        status,
        ...(clearWelcome ? { modal: null } : {}),
      };
    });

    const prevConn = lastConn;
    lastConn = conn;

    if (conn !== "connected") {
      if (prevConn === "connected") deps.onDisconnected?.();
      const outboxChanged = setStoreIfChanged(requeueSendingOutboxOnDisconnect);
      if (outboxChanged) deps.scheduleSaveOutbox();
      return;
    }

    // New socket: even if UI thought we were authed, we must re-auth on reconnect.
    if (prevConn !== "connected") {
      setStoreIfChanged((prev) => (prev.authed ? { ...prev, authed: false } : prev));
    }

    deps.maybeAutoAuthOnConnected?.();
  };

  const url = deps.getGatewayUrl();
  const canMultiplex = shouldUseMultiplexGateway();

  gateway = canMultiplex ? new MultiplexGatewayClient(url, onMessage, onStatus, { onRole }) : new GatewayClient(url, onMessage, onStatus);

  try {
    onRole(typeof gateway.getRole === "function" ? gateway.getRole() : "solo");
  } catch {
    // ignore
  }

  return { gateway };
}
