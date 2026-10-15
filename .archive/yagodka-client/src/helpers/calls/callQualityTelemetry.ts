export type CallQualityLevel = "unknown" | "connecting" | "good" | "unstable" | "failed";

export interface CallQualitySnapshot {
  level: CallQualityLevel;
  label: string;
  detail: string;
  participants: number | null;
  p2p: boolean | null;
  videoQuality: number | null;
  updatedAt: number;
}

export const CALL_QUALITY_UNKNOWN: CallQualitySnapshot = {
  level: "unknown",
  label: "сеть: —",
  detail: "Метрики звонка пока недоступны",
  participants: null,
  p2p: null,
  videoQuality: null,
  updatedAt: 0,
};

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function qualityLabel(level: CallQualityLevel): string {
  if (level === "connecting") return "сеть: подключение";
  if (level === "good") return "сеть: хорошее";
  if (level === "unstable") return "сеть: нестабильно";
  if (level === "failed") return "сеть: сбой";
  return "сеть: —";
}

function buildDetail(snapshot: CallQualitySnapshot): string {
  const parts = [snapshot.detail].filter(Boolean);
  if (snapshot.participants !== null) parts.push(`участников: ${snapshot.participants}`);
  if (snapshot.p2p !== null) parts.push(snapshot.p2p ? "P2P" : "JVB");
  if (snapshot.videoQuality !== null) parts.push(`video: ${snapshot.videoQuality}p`);
  return parts.join(" · ");
}

export function formatCallQualityLabel(snapshot: CallQualitySnapshot): string {
  return snapshot.label || qualityLabel(snapshot.level);
}

export function formatCallQualityTitle(snapshot: CallQualitySnapshot): string {
  return buildDetail(snapshot) || CALL_QUALITY_UNKNOWN.detail;
}

export function watchJitsiQuality(api: any, onChange: (snapshot: CallQualitySnapshot) => void): () => void {
  let active = true;
  let snapshot: CallQualitySnapshot = {
    ...CALL_QUALITY_UNKNOWN,
    level: "connecting",
    label: qualityLabel("connecting"),
    detail: "Jitsi подключается",
    updatedAt: Date.now(),
  };
  const disposers: Array<() => void> = [];

  const emit = (patch: Partial<CallQualitySnapshot>) => {
    if (!active) return;
    snapshot = {
      ...snapshot,
      ...patch,
      label: patch.label || qualityLabel(patch.level || snapshot.level),
      updatedAt: Date.now(),
    };
    onChange(snapshot);
  };

  const on = (event: string, handler: (payload?: any) => void) => {
    try {
      api?.addEventListener?.(event, handler);
      disposers.push(() => {
        try {
          api?.removeEventListener?.(event, handler);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  };

  const refreshRoomsInfo = async () => {
    try {
      const info = await api?.getRoomsInfo?.();
      const rooms = Array.isArray(info?.rooms) ? info.rooms : [];
      const participants = rooms.reduce((sum: number, room: any) => {
        const list = Array.isArray(room?.participants) ? room.participants : [];
        return sum + list.length;
      }, 0);
      emit({ participants });
    } catch {
      // ignore
    }
  };

  const refreshP2p = async () => {
    try {
      const p2p = await api?.isP2pActive?.();
      emit({ p2p: typeof p2p === "boolean" ? p2p : null });
    } catch {
      // ignore
    }
  };

  emit(snapshot);
  on("videoConferenceJoined", () => {
    emit({ level: "good", detail: "конференция подключена" });
    void refreshRoomsInfo();
    void refreshP2p();
  });
  on("participantJoined", () => void refreshRoomsInfo());
  on("participantLeft", () => void refreshRoomsInfo());
  on("p2pStatusChanged", (e) => emit({ p2p: typeof e?.isP2p === "boolean" ? e.isP2p : null }));
  on("videoQualityChanged", (e) => emit({ videoQuality: asNumber(e?.videoQuality) }));
  on("suspendDetected", () => emit({ level: "unstable", detail: "браузер приостанавливал звонок" }));
  on("errorOccurred", () => emit({ level: "unstable", detail: "Jitsi сообщил об ошибке" }));
  on("peerConnectionFailure", () => emit({ level: "failed", detail: "сбой PeerConnection" }));

  return () => {
    active = false;
    for (const dispose of disposers.splice(0)) dispose();
  };
}
