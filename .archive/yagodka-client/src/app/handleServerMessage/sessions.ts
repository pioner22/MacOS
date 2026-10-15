import type { GatewayTransport } from "../../lib/net/gatewayClient";
import type { AppState, SessionDeviceEntry } from "../../stores/types";

function normalizeSessionEntry(raw: any): SessionDeviceEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const toNumber = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    current: Boolean(raw.current),
    online: Boolean(raw.online),
    client_kind: typeof raw.client_kind === "string" ? raw.client_kind : null,
    client_version: typeof raw.client_version === "string" ? raw.client_version : null,
    user_agent: typeof raw.user_agent === "string" ? raw.user_agent : null,
    ip_masked: typeof raw.ip_masked === "string" ? raw.ip_masked : null,
    issued_at: toNumber(raw.issued_at),
    last_used_at: toNumber(raw.last_used_at),
    expires_at: toNumber(raw.expires_at),
  };
}

function sessionsStatusText(entries: SessionDeviceEntry[]): string {
  const total = entries.length;
  const others = entries.filter((entry) => !entry.current).length;
  if (!total) return "Активных сессий пока не найдено.";
  if (!others) return "Активна только текущая сессия.";
  return `Активно сессий: ${total}. Других устройств: ${others}.`;
}

export function handleSessionDevicesMessage(
  t: string,
  msg: any,
  state: AppState,
  gateway: GatewayTransport,
  patch: (p: Partial<AppState> | ((prev: AppState) => AppState)) => void
): boolean {
  if (t === "sessions_list") {
    const entries = Array.isArray(msg?.entries) ? msg.entries.map(normalizeSessionEntry).filter(Boolean) : [];
    patch({
      sessionDevices: entries as SessionDeviceEntry[],
      sessionDevicesStatus: sessionsStatusText(entries as SessionDeviceEntry[]),
    });
    return true;
  }
  if (t === "sessions_logout_others_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason || "").trim();
      const message = reason === "no_current_session" ? "Не удалось определить текущую сессию для этого устройства." : "Не удалось отключить другие устройства.";
      patch({ status: message, sessionDevicesStatus: message });
      return true;
    }
    const count = Math.max(0, Math.trunc(Number(msg?.count) || 0));
    const message = count > 0 ? `Другие устройства отключены: ${count}.` : "Других активных устройств не найдено.";
    patch({ status: message, sessionDevicesStatus: message });
    return true;
  }

  void state;
  void gateway;
  return false;
}
