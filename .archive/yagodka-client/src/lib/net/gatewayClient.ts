import type { ConnStatus } from "../../stores/types";

export type MsgHandler = (msg: any) => void;
export type StatusHandler = (st: ConnStatus, detail?: string) => void;

export type GatewayRole = "solo" | "leader" | "follower";

export interface GatewayTransport {
  connect: () => void;
  send: (obj: unknown) => boolean;
  close: () => void;
  getRole?: () => GatewayRole;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stableTimer: number | null = null;
  private pingTimer: number | null = null;
  private connectTimeoutTimer: number | null = null;
  private readonly pingIntervalMs = 10_000;
  private readonly connectTimeoutMs = 12_000;
  private readonly heartbeatStaleMs = 45_000;
  private readonly heartbeatMaxMisses = 3;
  private readonly reconnectBaseMs = 400;
  private readonly reconnectMaxMs = 30_000;
  private attempts = 0;
  private manualClose = false;
  private lastConnectStartedAt = 0;
  private lastOpenAt = 0;
  private lastCloseAt = 0;
  private lastMessageAt = 0;
  private missedHeartbeats = 0;
  private waitingOnline = false;
  private waitingVisible = false;
  private onlineHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private lifecycleInstalled = false;
  private lifecycleOnlineHandler: (() => void) | null = null;
  private lifecycleOfflineHandler: (() => void) | null = null;
  private lifecycleFocusHandler: (() => void) | null = null;
  private lifecyclePageShowHandler: (() => void) | null = null;
  private lifecycleVisibilityHandler: (() => void) | null = null;

  constructor(
    private url: string,
    private onMessage: MsgHandler,
    private onStatus: StatusHandler
  ) {
    this.installLifecycleHandlers();
  }

  getRole(): GatewayRole {
    return "solo";
  }

  connect() {
    this.installLifecycleHandlers();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.clearReconnect();
    this.clearStable();
    this.clearPing();
    this.clearConnectTimeout();
    this.clearWaiters();
    this.manualClose = false;
    if (this.deferIfOffline(true) || this.deferIfHidden(true)) return;
    this.onStatus("connecting");

    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      this.lastConnectStartedAt = Date.now();
      this.connectTimeoutTimer = window.setTimeout(() => {
        if (this.ws !== ws || ws.readyState !== WebSocket.CONNECTING) return;
        this.forceReconnect("connect_timeout", ws);
      }, this.connectTimeoutMs);
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.clearConnectTimeout();
        this.lastOpenAt = Date.now();
        this.lastMessageAt = this.lastOpenAt;
        this.missedHeartbeats = 0;
        this.onStatus("connected");
        this.startPing();
        // Reset exponential backoff only after the connection stays up for a bit.
        this.stableTimer = window.setTimeout(() => {
          this.attempts = 0;
          this.stableTimer = null;
        }, 10_000);
      };
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.clearConnectTimeout();
        this.clearStable();
        this.clearPing();
        this.missedHeartbeats = 0;
        this.lastCloseAt = Date.now();
        const code = typeof ev?.code === "number" ? ev.code : 0;
        const reason = typeof ev?.reason === "string" ? ev.reason : "";
        const baseDetail = code ? `code=${code}${reason ? ` reason=${reason}` : ""}` : "";
        const offlineNote = this.isOffline() ? "offline" : "";
        const hiddenNote = this.isHidden() ? "background" : "";
        const notes = [baseDetail, offlineNote, hiddenNote].filter(Boolean).join("; ");
        const detail = notes || undefined;
        this.onStatus("disconnected", detail);
        if (!this.manualClose) this.scheduleReconnect();
      };
      ws.onerror = () => {
        // onclose will follow in most browsers
      };
      ws.onmessage = (ev) => {
        try {
          const data = typeof ev.data === "string" ? ev.data : "";
          const msg = JSON.parse(data);
          this.lastMessageAt = Date.now();
          this.missedHeartbeats = 0;
          try {
            const hook = (globalThis as any).__yagodka_debug_on_gateway_in;
            if (typeof hook === "function") hook(msg);
          } catch {
            // ignore
          }
          this.onMessage(msg);
        } catch {
          // ignore
        }
      };
    } catch (e) {
      this.ws = null;
      this.onStatus("disconnected", String(e));
      this.scheduleReconnect();
    }
  }

  send(obj: unknown) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.manualClose = true;
    this.clearReconnect();
    this.clearStable();
    this.clearPing();
    this.clearConnectTimeout();
    this.clearWaiters();
    this.clearLifecycleHandlers();
    try {
      this.ws?.close();
    } catch {
      // ignore
    } finally {
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    this.clearReconnect();
    if (this.deferIfOffline(false) || this.deferIfHidden(false)) return;
    const now = Date.now();
    const lastUp = this.lastOpenAt ? now - this.lastOpenAt : 0;
    let delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** Math.min(7, this.attempts++));
    if (lastUp > 0 && lastUp < 1200) delay = Math.max(delay, 2000);
    const jitter = 0.85 + Math.random() * 0.3;
    delay = Math.round(delay * jitter);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearStable() {
    if (this.stableTimer !== null) {
      window.clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private startPing() {
    if (this.pingTimer !== null) return;
    this.sendHeartbeatPing();
    this.pingTimer = window.setInterval(() => {
      this.sendHeartbeatPing();
    }, this.pingIntervalMs);
  }

  private clearPing() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearConnectTimeout() {
    if (this.connectTimeoutTimer !== null) {
      window.clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
  }

  private sendHeartbeatPing() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const staleByTime = this.lastMessageAt > 0 && now - this.lastMessageAt > this.heartbeatStaleMs;
    if (staleByTime || this.missedHeartbeats >= this.heartbeatMaxMisses) {
      this.forceReconnect("heartbeat_timeout", ws);
      return;
    }
    this.missedHeartbeats += 1;
    if (!this.send({ type: "ping" })) {
      this.forceReconnect("heartbeat_send_failed", ws);
    }
  }

  private forceReconnect(detail: string, expected?: WebSocket) {
    if (expected && this.ws !== expected) return;
    const ws = this.ws;
    this.ws = null;
    this.clearConnectTimeout();
    this.clearStable();
    this.clearPing();
    this.missedHeartbeats = 0;
    this.lastCloseAt = Date.now();
    try {
      ws?.close();
    } catch {
      // ignore
    }
    this.onStatus("disconnected", detail);
    if (!this.manualClose) this.scheduleReconnect();
  }

  private installLifecycleHandlers() {
    if (this.lifecycleInstalled) return;
    if (typeof window === "undefined") return;
    this.lifecycleInstalled = true;
    this.lifecycleOnlineHandler = () => this.resumeConnection("online");
    this.lifecycleOfflineHandler = () => this.handleOffline();
    this.lifecycleFocusHandler = () => this.resumeConnection("focus");
    this.lifecyclePageShowHandler = () => this.resumeConnection("pageshow");
    this.lifecycleVisibilityHandler = () => {
      if (!this.isHidden()) this.resumeConnection("visible");
    };
    try {
      window.addEventListener("online", this.lifecycleOnlineHandler);
      window.addEventListener("offline", this.lifecycleOfflineHandler);
      window.addEventListener("focus", this.lifecycleFocusHandler);
      window.addEventListener("pageshow", this.lifecyclePageShowHandler);
      document.addEventListener("visibilitychange", this.lifecycleVisibilityHandler);
    } catch {
      // ignore
    }
  }

  private clearLifecycleHandlers() {
    if (!this.lifecycleInstalled) return;
    this.lifecycleInstalled = false;
    try {
      if (this.lifecycleOnlineHandler) window.removeEventListener("online", this.lifecycleOnlineHandler);
      if (this.lifecycleOfflineHandler) window.removeEventListener("offline", this.lifecycleOfflineHandler);
      if (this.lifecycleFocusHandler) window.removeEventListener("focus", this.lifecycleFocusHandler);
      if (this.lifecyclePageShowHandler) window.removeEventListener("pageshow", this.lifecyclePageShowHandler);
      if (this.lifecycleVisibilityHandler) document.removeEventListener("visibilitychange", this.lifecycleVisibilityHandler);
    } catch {
      // ignore
    }
    this.lifecycleOnlineHandler = null;
    this.lifecycleOfflineHandler = null;
    this.lifecycleFocusHandler = null;
    this.lifecyclePageShowHandler = null;
    this.lifecycleVisibilityHandler = null;
  }

  private resumeConnection(_reason: string) {
    if (this.manualClose) return;
    if (this.deferIfOffline(false) || this.deferIfHidden(false)) return;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const staleByTime = this.lastMessageAt > 0 && Date.now() - this.lastMessageAt > this.heartbeatStaleMs;
      if (staleByTime || this.missedHeartbeats >= this.heartbeatMaxMisses) {
        this.forceReconnect("heartbeat_timeout", ws);
        return;
      }
      this.sendHeartbeatPing();
      return;
    }
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      const startedAt = this.lastConnectStartedAt || Date.now();
      if (Date.now() - startedAt > this.connectTimeoutMs) this.forceReconnect("connect_timeout", ws);
      return;
    }
    this.clearReconnect();
    this.connect();
  }

  private handleOffline() {
    if (this.manualClose) return;
    const ws = this.ws;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      this.forceReconnect("offline", ws);
      return;
    }
    this.onStatus("disconnected", "offline");
    this.waitForOnline();
  }

  private isOffline(): boolean {
    try {
      if (typeof navigator !== "undefined" && "onLine" in navigator) return navigator.onLine === false;
    } catch {
      // ignore
    }
    return false;
  }

  private isHidden(): boolean {
    try {
      return typeof document !== "undefined" && document.visibilityState === "hidden";
    } catch {
      return false;
    }
  }

  private deferIfOffline(announce: boolean): boolean {
    if (!this.isOffline()) return false;
    if (announce) this.onStatus("disconnected", "offline");
    this.waitForOnline();
    return true;
  }

  private deferIfHidden(announce: boolean): boolean {
    if (!this.isHidden()) return false;
    if (announce) this.onStatus("disconnected", "background");
    this.waitForVisible();
    return true;
  }

  private waitForOnline() {
    if (this.waitingOnline) return;
    this.waitingOnline = true;
    try {
      this.onlineHandler = () => {
        this.waitingOnline = false;
        this.clearWaiters();
        this.connect();
      };
      window.addEventListener("online", this.onlineHandler, { once: true });
    } catch {
      // ignore
    }
  }

  private waitForVisible() {
    if (this.waitingVisible) return;
    this.waitingVisible = true;
    try {
      this.visibilityHandler = () => {
        if (document.visibilityState !== "visible") return;
        this.waitingVisible = false;
        this.clearWaiters();
        this.connect();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    } catch {
      // ignore
    }
  }

  private clearWaiters() {
    if (this.onlineHandler) {
      try {
        window.removeEventListener("online", this.onlineHandler);
      } catch {
        // ignore
      }
      this.onlineHandler = null;
    }
    if (this.visibilityHandler) {
      try {
        document.removeEventListener("visibilitychange", this.visibilityHandler);
      } catch {
        // ignore
      }
      this.visibilityHandler = null;
    }
    this.waitingOnline = false;
    this.waitingVisible = false;
  }
}
