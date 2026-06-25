import { getOrCreateInstanceId } from "../../helpers/device/clientTags";
import type { ConnStatus } from "../../stores/types";
import { GatewayClient, type GatewayRole, type GatewayTransport, type MsgHandler, type StatusHandler } from "./gatewayClient";

type WireMessage =
  | { t: "hello"; from: string; ts: number; conn: ConnStatus; detail?: string }
  | { t: "status"; from: string; ts: number; conn: ConnStatus; detail?: string }
  | { t: "msg"; from: string; ts: number; msg: any }
  | { t: "send"; from: string; ts: number; payload: any }
  | { t: "connect"; from: string; ts: number };

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function nowMs(): number {
  return Date.now();
}

function docHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState !== "visible";
  } catch {
    return false;
  }
}

function supportsBroadcastChannel(): boolean {
  try {
    return typeof BroadcastChannel === "function";
  } catch {
    return false;
  }
}

function supportsWebLocks(): boolean {
  try {
    return typeof navigator !== "undefined" && Boolean((navigator as any)?.locks?.request);
  } catch {
    return false;
  }
}

export type MultiplexGatewayOptions = {
  channelName?: string;
  lockName?: string;
  heartbeatMs?: number;
  onRole?: (role: GatewayRole) => void;
};

export class MultiplexGatewayClient implements GatewayTransport {
  private readonly instanceId: string;
  private readonly channelName: string;
  private readonly lockName: string;
  private readonly heartbeatMs: number;
  private readonly leaderStaleMs: number;
  private readonly followerWatchdogMs: number;

  private role: GatewayRole = "follower";
  private inner: GatewayClient | null = null;
  private channel: BroadcastChannel | null = null;

  private wantConnected = false;
  private disposed = false;

  private releaseLeader: (() => void) | null = null;
  private leaderHeartbeatTimer: number | null = null;
  private followerWatchdogTimer: number | null = null;
  private leaderAcquireInFlight = false;

  private lastLeaderSeenAt = 0;
  private lastLeaderId = "";

  private followerSendQueue: any[] = [];
  private leaderSendQueue: any[] = [];

  private lastConn: ConnStatus = "connecting";
  private lastDetail: string | undefined = undefined;

  private visibilityHandler: (() => void) | null = null;
  private pageHideHandler: (() => void) | null = null;
  private focusHandler: (() => void) | null = null;
  private pageShowHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private readonly onRole: ((role: GatewayRole) => void) | null;

  constructor(
    private url: string,
    private onMessage: MsgHandler,
    private onStatus: StatusHandler,
    opts: MultiplexGatewayOptions = {}
  ) {
    this.instanceId = getOrCreateInstanceId();
    this.channelName = opts.channelName || "yagodka_gateway_bus_v1";
    this.lockName = opts.lockName || "yagodka_gateway_leader_v1";
    this.heartbeatMs = Math.max(500, Math.min(10_000, Math.trunc(Number(opts.heartbeatMs ?? 2000) || 2000)));
    this.leaderStaleMs = Math.max(this.heartbeatMs * 3, 6500);
    this.followerWatchdogMs = Math.max(1000, Math.min(3000, Math.trunc(this.heartbeatMs * 1.5)));
    this.onRole = typeof opts.onRole === "function" ? opts.onRole : null;

    if (!supportsBroadcastChannel() || !supportsWebLocks() || typeof window === "undefined") {
      // Fallback to solo mode when required primitives are missing (or in tests/SSR).
      this.role = "solo";
      this.inner = new GatewayClient(url, onMessage, onStatus);
      this.onRole?.("solo");
      return;
    }

    try {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.addEventListener("message", (ev) => {
        const msg = (ev as MessageEvent<any>).data as WireMessage | null;
        this.handleWire(msg);
      });
    } catch {
      this.channel = null;
    }

    this.visibilityHandler = () => this.onVisibilityChanged();
    this.pageHideHandler = () => this.onVisibilityChanged();
    this.focusHandler = () => this.onRuntimeWake();
    this.pageShowHandler = () => this.onRuntimeWake();
    this.onlineHandler = () => this.onRuntimeWake();
    try {
      document.addEventListener("visibilitychange", this.visibilityHandler);
      window.addEventListener("pagehide", this.pageHideHandler);
      window.addEventListener("focus", this.focusHandler);
      window.addEventListener("pageshow", this.pageShowHandler);
      window.addEventListener("online", this.onlineHandler);
    } catch {
      // ignore
    }

    this.onRole?.(this.role);
    this.onVisibilityChanged();
  }

  getRole(): GatewayRole {
    return this.role;
  }

  connect(): void {
    this.wantConnected = true;
    if (this.role === "solo") {
      this.inner?.connect();
      return;
    }
    if (this.role === "leader") {
      this.inner?.connect();
      return;
    }
    this.post({ t: "connect", from: this.instanceId, ts: nowMs() });
    // Optimistically show "connecting" until we hear from leader.
    this.onStatus("connecting");
    this.startFollowerWatchdog();
    this.onVisibilityChanged();
  }

  send(obj: unknown): boolean {
    if (this.role === "solo") return this.inner?.send(obj) ?? false;
    if (this.role === "leader") {
      const ok = this.inner?.send(obj) ?? false;
      if (!ok) this.enqueueLeaderSend(obj);
      return ok;
    }
    const payload = obj as any;
    const posted = this.post({ t: "send", from: this.instanceId, ts: nowMs(), payload });
    if (!posted) {
      this.enqueueFollowerSend(payload);
      return false;
    }
    return true;
  }

  close(): void {
    this.wantConnected = false;
    this.disposed = true;
    this.stopLeaderHeartbeat();
    this.stopFollowerWatchdog();
    this.releaseLeader?.();
    this.releaseLeader = null;
    this.inner?.close();
    this.inner = null;
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // ignore
      }
      this.channel = null;
    }
    if (this.visibilityHandler) {
      try {
        document.removeEventListener("visibilitychange", this.visibilityHandler);
      } catch {
        // ignore
      }
      this.visibilityHandler = null;
    }
    if (this.pageHideHandler) {
      try {
        window.removeEventListener("pagehide", this.pageHideHandler);
      } catch {
        // ignore
      }
      this.pageHideHandler = null;
    }
    if (this.focusHandler) {
      try {
        window.removeEventListener("focus", this.focusHandler);
      } catch {
        // ignore
      }
      this.focusHandler = null;
    }
    if (this.pageShowHandler) {
      try {
        window.removeEventListener("pageshow", this.pageShowHandler);
      } catch {
        // ignore
      }
      this.pageShowHandler = null;
    }
    if (this.onlineHandler) {
      try {
        window.removeEventListener("online", this.onlineHandler);
      } catch {
        // ignore
      }
      this.onlineHandler = null;
    }
  }

  private onVisibilityChanged(): void {
    if (this.disposed) return;
    if (this.role === "solo") return;

    // Yield leadership when hidden to keep the lock in a visible tab.
    if (docHidden()) {
      if (this.role === "leader") this.releaseLeader?.();
      this.stopFollowerWatchdog();
      return;
    }

    // Visible tab: always queue a leader lock request (it will run when available).
    if (this.role === "follower" && this.wantConnected) this.startFollowerWatchdog();
    void this.tryAcquireLeader();
  }

  private onRuntimeWake(): void {
    if (this.disposed) return;
    if (this.role === "solo") return;
    this.onVisibilityChanged();
    if (docHidden()) return;
    if (this.role === "leader") {
      if (this.wantConnected) this.inner?.connect();
      return;
    }
    if (this.role === "follower" && this.wantConnected) {
      this.checkLeaderHealth();
    }
  }

  private become(role: GatewayRole): void {
    if (this.role === role) return;
    this.role = role;
    if (role === "follower" && this.wantConnected && !docHidden()) this.startFollowerWatchdog();
    else this.stopFollowerWatchdog();
    this.onRole?.(role);
    try {
      // Expose leader/follower state to the app via a global hook for debugging.
      (globalThis as any).__yagodka_net_role = role;
    } catch {
      // ignore
    }
  }

  private async tryAcquireLeader(): Promise<void> {
    if (this.disposed) return;
    if (this.role === "solo" || this.role === "leader") return;
    if (docHidden()) return;
    if (this.leaderAcquireInFlight) return;
    if (!supportsWebLocks()) return;
    const locks: any = (navigator as any).locks;
    if (!locks || typeof locks.request !== "function") return;

    this.leaderAcquireInFlight = true;
    try {
      await locks.request(this.lockName, async () => {
        if (this.disposed) return;
        if (docHidden()) return;
        const rel = deferred<void>();
        this.releaseLeader = () => rel.resolve();

        this.become("leader");
        this.installInnerIfMissing();
        this.postStatus("connecting");
        this.startLeaderHeartbeat();
        if (this.wantConnected) this.inner?.connect();
        this.flushFollowerSendQueueToLeader();

        try {
          await rel.promise;
        } finally {
          this.releaseLeader = null;
          this.stopLeaderHeartbeat();
          this.inner?.close();
          this.inner = null;
          this.become("follower");
          this.postStatus("disconnected", "handoff");
        }
      });
    } catch {
      // ignore
    } finally {
      this.leaderAcquireInFlight = false;
      if (!this.disposed && this.role === "follower" && this.wantConnected && !docHidden()) {
        this.startFollowerWatchdog();
      }
    }
  }

  private installInnerIfMissing(): void {
    if (this.inner) return;
    this.inner = new GatewayClient(
      this.url,
      (msg) => {
        this.onMessage(msg);
        this.post({ t: "msg", from: this.instanceId, ts: nowMs(), msg });
      },
      (conn, detail) => {
        this.lastConn = conn;
        this.lastDetail = detail;
        this.onStatus(conn, detail);
        this.post({ t: "status", from: this.instanceId, ts: nowMs(), conn, ...(detail ? { detail } : {}) });
        if (conn === "connected") this.flushLeaderSendQueue();
      }
    );
  }

  private startLeaderHeartbeat(): void {
    if (this.leaderHeartbeatTimer !== null) return;
    const tick = () => {
      if (this.disposed) return;
      if (this.role !== "leader") return;
      this.post({ t: "hello", from: this.instanceId, ts: nowMs(), conn: this.lastConn, ...(this.lastDetail ? { detail: this.lastDetail } : {}) });
    };
    tick();
    this.leaderHeartbeatTimer = window.setInterval(tick, this.heartbeatMs);
  }

  private stopLeaderHeartbeat(): void {
    if (this.leaderHeartbeatTimer === null) return;
    try {
      window.clearInterval(this.leaderHeartbeatTimer);
    } catch {
      // ignore
    }
    this.leaderHeartbeatTimer = null;
  }

  private startFollowerWatchdog(): void {
    if (this.disposed) return;
    if (this.role !== "follower") return;
    if (!this.wantConnected) return;
    if (docHidden()) return;
    if (this.followerWatchdogTimer !== null) return;
    this.followerWatchdogTimer = window.setInterval(() => this.checkLeaderHealth(), this.followerWatchdogMs);
  }

  private stopFollowerWatchdog(): void {
    if (this.followerWatchdogTimer === null) return;
    try {
      window.clearInterval(this.followerWatchdogTimer);
    } catch {
      // ignore
    }
    this.followerWatchdogTimer = null;
  }

  private checkLeaderHealth(): void {
    if (this.disposed) return;
    if (this.role !== "follower") return;
    if (!this.wantConnected) return;
    if (docHidden()) return;
    const age = this.lastLeaderSeenAt > 0 ? nowMs() - this.lastLeaderSeenAt : Number.POSITIVE_INFINITY;
    if (age < this.leaderStaleMs) return;
    this.lastLeaderId = "";
    this.onStatus("connecting", this.lastLeaderSeenAt > 0 ? "leader_recovery" : "leader_discovery");
    this.post({ t: "connect", from: this.instanceId, ts: nowMs() });
    void this.tryAcquireLeader();
  }

  private handleWire(msg: WireMessage | null): void {
    if (this.disposed) return;
    if (!msg || typeof msg !== "object") return;
    const from = String((msg as any).from || "").trim();
    if (!from || from === this.instanceId) return;

    if (msg.t === "hello" || msg.t === "status") {
      this.lastLeaderSeenAt = nowMs();
      this.lastLeaderId = from;
      if (this.role === "follower") {
        const detail = typeof msg.detail === "string" ? msg.detail : undefined;
        if (this.lastConn !== msg.conn || this.lastDetail !== detail) {
          this.lastConn = msg.conn;
          this.lastDetail = detail;
          this.onStatus(msg.conn, detail);
        }
        if (this.wantConnected) this.flushFollowerSendQueueToLeader();
      }
      return;
    }

    if (msg.t === "msg") {
      this.onMessage(msg.msg);
      return;
    }

    if (msg.t === "connect") {
      if (this.role === "leader") {
        this.installInnerIfMissing();
        this.inner?.connect();
        this.post({ t: "status", from: this.instanceId, ts: nowMs(), conn: this.lastConn, ...(this.lastDetail ? { detail: this.lastDetail } : {}) });
      }
      return;
    }

    if (msg.t === "send") {
      if (this.role !== "leader") return;
      this.installInnerIfMissing();
      const ok = this.inner?.send(msg.payload) ?? false;
      if (!ok) this.enqueueLeaderSend(msg.payload);
      return;
    }
  }

  private post(msg: WireMessage): boolean {
    if (!this.channel) return false;
    try {
      this.channel.postMessage(msg);
      return true;
    } catch {
      return false;
    }
  }

  private postStatus(conn: ConnStatus, detail?: string): void {
    this.lastConn = conn;
    this.lastDetail = detail;
    this.post({ t: "status", from: this.instanceId, ts: nowMs(), conn, ...(detail ? { detail } : {}) });
  }

  private enqueueFollowerSend(payload: any): void {
    this.followerSendQueue.push(payload);
    if (this.followerSendQueue.length > 64) this.followerSendQueue.splice(0, this.followerSendQueue.length - 64);
    void this.tryAcquireLeader();
  }

  private flushFollowerSendQueueToLeader(): void {
    if (!this.followerSendQueue.length) return;
    const queued = [...this.followerSendQueue];
    this.followerSendQueue.length = 0;
    for (const payload of queued) {
      const ok = this.post({ t: "send", from: this.instanceId, ts: nowMs(), payload });
      if (!ok) {
        this.enqueueFollowerSend(payload);
        return;
      }
    }
  }

  private enqueueLeaderSend(payload: any): void {
    this.leaderSendQueue.push(payload);
    if (this.leaderSendQueue.length > 128) this.leaderSendQueue.splice(0, this.leaderSendQueue.length - 128);
  }

  private flushLeaderSendQueue(): void {
    if (!this.inner) return;
    if (!this.leaderSendQueue.length) return;
    const queued = [...this.leaderSendQueue];
    this.leaderSendQueue.length = 0;
    for (const payload of queued) {
      const ok = this.inner.send(payload);
      if (!ok) {
        this.enqueueLeaderSend(payload);
        break;
      }
    }
  }
}
