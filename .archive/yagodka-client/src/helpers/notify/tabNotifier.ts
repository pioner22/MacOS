const CHANNEL_NAME = "yagodka_notify_bus_v1";
const STORAGE_EVENT_KEY = "yagodka_notify_bus_v1";
const NOTIFIED_STORAGE_KEY = "yagodka_notify_notified_v1";
const NOTIFIED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PRESENCE_TTL_MS = 12_000;
const PRESENCE_BROADCAST_EVERY_MS = 4_000;
const LEADER_STALE_MS = 12_000;
const LEADER_REFRESH_EVERY_MS = 5_000;
const NOTIFIED_TTL_MS = 120_000;
const MAX_NOTIFIED_KEYS = 800;

type PresencePayload = {
  instance_id: string;
  visible: boolean;
  focused: boolean;
  ts: number;
};

type WireMessage =
  | { type: "presence"; payload: PresencePayload }
  | { type: "notified"; payload: { key: string; ts: number } }
  | { type: "leader"; payload: { instance_id: string; ts: number } }
  | { type: "want_leader"; payload: { instance_id: string; ts: number; visible: boolean } };

function nowMs(): number {
  return Date.now();
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function docHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState !== "visible";
  } catch {
    return false;
  }
}

function docFocused(): boolean {
  try {
    if (typeof document === "undefined") return false;
    if (typeof document.hasFocus !== "function") return false;
    return Boolean(document.hasFocus());
  } catch {
    return false;
  }
}

function currentPresence(instanceId: string): PresencePayload {
  return {
    instance_id: instanceId,
    visible: !docHidden(),
    focused: docFocused(),
    ts: nowMs(),
  };
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeStringifyJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
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

function pruneMap<K>(map: Map<K, number>, maxSize: number): void {
  if (map.size <= maxSize) return;
  const entries = Array.from(map.entries()).sort((a, b) => a[1] - b[1]);
  const removeCount = Math.max(0, entries.length - maxSize);
  for (let i = 0; i < removeCount; i += 1) {
    map.delete(entries[i][0]);
  }
}

export class TabNotifier {
  readonly instanceId: string;
  private installed = false;
  private channel: BroadcastChannel | null = null;
  private peers = new Map<string, PresencePayload>();
  private notified = new Map<string, number>();
  private leaderId: string | null = null;
  private leaderTs = 0;
  private isLeader = false;
  private releaseLeaderLock: (() => void) | null = null;
  private presenceTimer: number | null = null;
  private leaderTimer: number | null = null;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    this.peers.set(this.instanceId, currentPresence(this.instanceId));
    this.restoreNotifiedFromStorage();

    const onWireMessage = (msg: WireMessage) => {
      try {
        this.handleWireMessage(msg);
      } catch {
        // ignore
      }
    };

    if (supportsBroadcastChannel()) {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.addEventListener("message", (ev) => {
          const msg = (ev as MessageEvent<any>).data as WireMessage | null;
          if (!msg || typeof msg !== "object") return;
          onWireMessage(msg);
        });
      } catch {
        this.channel = null;
      }
    }

    if (!this.channel) {
      try {
        window.addEventListener("storage", (ev) => {
          if (!ev || ev.key !== STORAGE_EVENT_KEY) return;
          const raw = typeof ev.newValue === "string" ? ev.newValue : "";
          if (!raw) return;
          const msg = safeParseJson<WireMessage>(raw);
          if (!msg || typeof msg !== "object") return;
          onWireMessage(msg);
        });
      } catch {
        // ignore
      }
    }

    const update = () => this.broadcastPresence();
    try {
      document.addEventListener("visibilitychange", update);
      window.addEventListener("focus", update);
      window.addEventListener("blur", update);
      window.addEventListener("pagehide", update);
    } catch {
      // ignore
    }

    this.broadcastPresence();
    this.presenceTimer = window.setInterval(() => this.broadcastPresence(), PRESENCE_BROADCAST_EVERY_MS);

    if (supportsWebLocks()) {
      void this.tryAcquireLeaderLock();
      this.leaderTimer = window.setInterval(() => this.refreshLeader(), LEADER_REFRESH_EVERY_MS);
    } else {
      this.leaderTimer = window.setInterval(() => this.refreshLeader(), LEADER_REFRESH_EVERY_MS);
      this.refreshLeader();
    }
  }

  getSnapshot(): { anyVisible: boolean; anyFocused: boolean; leader: boolean } {
    const now = nowMs();
    let anyVisible = false;
    let anyFocused = false;
    const staleIds: string[] = [];
    for (const p of this.peers.values()) {
      if (now - (p.ts || 0) > PRESENCE_TTL_MS) {
        // Keep a small TTL window to tolerate GC pauses / throttled timers.
        if (now - (p.ts || 0) > PRESENCE_TTL_MS * 3) staleIds.push(p.instance_id);
        continue;
      }
      if (p.visible) anyVisible = true;
      if (p.focused) anyFocused = true;
      if (anyVisible && anyFocused) break;
    }
    for (const id of staleIds) this.peers.delete(id);
    return { anyVisible, anyFocused, leader: this.isLeader };
  }

  shouldAndMark(kind: "toast" | "sound" | "system", notifKey: string, ttlMs = NOTIFIED_TTL_MS): boolean {
    const key = `${kind}:${String(notifKey || "").trim()}`;
    if (!key || key.endsWith(":")) return false;
    const now = nowMs();
    const prev = this.notified.get(key) || 0;
    if (prev && now - prev < ttlMs) return false;
    this.notified.set(key, now);
    pruneMap(this.notified, MAX_NOTIFIED_KEYS);
    this.persistNotifiedToStorage();
    this.broadcast({ type: "notified", payload: { key, ts: now } });
    return true;
  }

  shouldShowToast(notifKey: string, ttlMs = NOTIFIED_TTL_MS): boolean {
    if (docHidden()) return false;
    if (!docFocused()) return false;
    return this.shouldAndMark("toast", notifKey, ttlMs);
  }

  shouldPlaySound(notifKey: string, ttlMs = NOTIFIED_TTL_MS): boolean {
    const focused = docFocused();
    const snapshot = this.getSnapshot();

    // Foreground: sound only in a focused tab.
    if (focused) return this.shouldAndMark("sound", notifKey, ttlMs);

    // Background: only one leader tab, and only when no tabs are focused.
    if (this.isLeader && !snapshot.anyFocused) return this.shouldAndMark("sound", notifKey, ttlMs);
    return false;
  }

  shouldShowSystemNotification(notifKey: string, ttlMs = NOTIFIED_TTL_MS): boolean {
    if (docFocused()) return false;
    const snapshot = this.getSnapshot();
    if (!this.isLeader) return false;
    if (snapshot.anyFocused) return false;
    return this.shouldAndMark("system", notifKey, ttlMs);
  }

  private broadcastPresence(): void {
    const payload = currentPresence(this.instanceId);
    this.peers.set(this.instanceId, payload);
    this.broadcast({ type: "presence", payload });
  }

  private broadcast(msg: WireMessage): void {
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
        return;
      } catch {
        // ignore
      }
    }
    const ls = safeLocalStorage();
    if (!ls) return;
    const raw = safeStringifyJson(msg);
    if (!raw) return;
    try {
      ls.setItem(STORAGE_EVENT_KEY, raw);
      // Clean up to avoid unlimited growth and to ensure events fire again with same payload.
      ls.removeItem(STORAGE_EVENT_KEY);
    } catch {
      // ignore
    }
  }

  private handleWireMessage(msg: WireMessage): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "presence") {
      const p = msg.payload;
      if (!p || typeof p !== "object") return;
      const id = String(p.instance_id || "").trim();
      if (!id || id === this.instanceId) return;
      this.peers.set(id, { ...p, instance_id: id });
      return;
    }
    if (msg.type === "notified") {
      const key = String(msg.payload?.key ?? "").trim();
      const ts = Number(msg.payload?.ts ?? 0) || 0;
      if (!key) return;
      const prev = this.notified.get(key) || 0;
      if (!prev || ts > prev) this.notified.set(key, ts || nowMs());
      pruneMap(this.notified, MAX_NOTIFIED_KEYS);
      this.persistNotifiedToStorage();
      return;
    }
    if (msg.type === "leader") {
      const id = String(msg.payload?.instance_id ?? "").trim();
      const ts = Number(msg.payload?.ts ?? 0) || nowMs();
      if (!id) return;
      this.leaderId = id;
      this.leaderTs = ts;
      this.isLeader = id === this.instanceId;
      return;
    }
    if (msg.type === "want_leader") {
      const id = String(msg.payload?.instance_id ?? "").trim();
      const visible = Boolean(msg.payload?.visible);
      if (!id || id === this.instanceId) return;
      // If a visible tab wants to become leader and we're currently a hidden leader, yield.
      if (visible && this.isLeader && docHidden()) this.releaseLockIfAny();
      return;
    }
  }

  private refreshLeader(): void {
    const now = nowMs();
    if (this.isLeader) {
      this.leaderId = this.instanceId;
      this.leaderTs = now;
      this.broadcast({ type: "leader", payload: { instance_id: this.instanceId, ts: now } });
      return;
    }

    if (supportsWebLocks()) {
      // If leader is stale, ask for leadership (lock takeover is handled by locks).
      if (!this.leaderId || now - this.leaderTs > LEADER_STALE_MS) {
        this.broadcast({ type: "want_leader", payload: { instance_id: this.instanceId, ts: now, visible: !docHidden() } });
        void this.tryAcquireLeaderLock();
      }
      return;
    }

    // Fallback: localStorage election (very small + robust).
    const ls = safeLocalStorage();
    if (!ls) return;
    const raw = ls.getItem("yagodka_notify_leader_v1");
    const parsed = raw ? safeParseJson<{ instance_id: string; ts: number }>(raw) : null;
    const leaderId = String(parsed?.instance_id || "").trim();
    const leaderTs = Number(parsed?.ts ?? 0) || 0;
    if (!leaderId || now - leaderTs > LEADER_STALE_MS) {
      const next = safeStringifyJson({ instance_id: this.instanceId, ts: now });
      if (!next) return;
      try {
        ls.setItem("yagodka_notify_leader_v1", next);
      } catch {
        return;
      }
    }
    const curRaw = ls.getItem("yagodka_notify_leader_v1");
    const cur = curRaw ? safeParseJson<{ instance_id: string; ts: number }>(curRaw) : null;
    const curId = String(cur?.instance_id || "").trim();
    const curTs = Number(cur?.ts ?? 0) || now;
    this.leaderId = curId || null;
    this.leaderTs = curTs;
    this.isLeader = curId === this.instanceId;
    if (this.isLeader) this.broadcast({ type: "leader", payload: { instance_id: this.instanceId, ts: now } });
  }

  private async tryAcquireLeaderLock(): Promise<void> {
    if (!supportsWebLocks()) return;
    if (this.isLeader) return;
    // If we already have a pending lock request, avoid queue explosion.
    if (this.releaseLeaderLock) return;
    try {
      const locks = (navigator as any).locks;
      await locks.request(
        "yagodka_notify_leader_v1",
        { mode: "exclusive", ifAvailable: true },
        async (lock: unknown) => {
          if (!lock) return;
          this.isLeader = true;
          this.leaderId = this.instanceId;
          this.leaderTs = nowMs();
          return await new Promise<void>((resolve) => {
            this.releaseLeaderLock = () => resolve();
            this.broadcast({ type: "leader", payload: { instance_id: this.instanceId, ts: nowMs() } });
          });
        }
      );
    } catch {
      // ignore
    }
  }

  private releaseLockIfAny(): void {
    if (!this.isLeader) return;
    if (!this.releaseLeaderLock) return;
    try {
      this.releaseLeaderLock();
    } catch {
      // ignore
    }
    this.releaseLeaderLock = null;
    this.isLeader = false;
    this.leaderId = null;
    this.leaderTs = 0;
  }

  private restoreNotifiedFromStorage(): void {
    const ls = safeLocalStorage();
    if (!ls) return;
    const raw = ls.getItem(NOTIFIED_STORAGE_KEY);
    if (!raw) return;
    const parsed = safeParseJson<Record<string, number>>(raw);
    if (!parsed || typeof parsed !== "object") return;
    const cutoff = nowMs() - NOTIFIED_MAX_AGE_MS;
    for (const [key, ts] of Object.entries(parsed)) {
      if (!key) continue;
      const t = typeof ts === "number" && Number.isFinite(ts) ? Math.trunc(ts) : Math.trunc(Number(ts) || 0);
      if (t <= 0 || t < cutoff) continue;
      this.notified.set(key, t);
    }
    pruneMap(this.notified, MAX_NOTIFIED_KEYS);
  }

  private persistNotifiedToStorage(): void {
    const ls = safeLocalStorage();
    if (!ls) return;
    const cutoff = nowMs() - NOTIFIED_MAX_AGE_MS;
    for (const [key, ts] of Array.from(this.notified.entries())) {
      if (!key || !ts || ts < cutoff) this.notified.delete(key);
    }
    pruneMap(this.notified, MAX_NOTIFIED_KEYS);
    const obj: Record<string, number> = {};
    for (const [key, ts] of this.notified.entries()) obj[key] = ts;
    const raw = safeStringifyJson(obj);
    if (!raw) return;
    try {
      ls.setItem(NOTIFIED_STORAGE_KEY, raw);
    } catch {
      // ignore
    }
  }
}

let singleton: TabNotifier | null = null;

export function getTabNotifier(getInstanceId: () => string): TabNotifier {
  if (!singleton) {
    const instanceId = String(getInstanceId() || "").trim();
    singleton = new TabNotifier(instanceId || `tab-${nowMs()}`);
  }
  return singleton;
}
