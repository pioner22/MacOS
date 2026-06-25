export type JitsiCallMode = "audio" | "video";

export interface JitsiMediaHints {
  mobile: boolean;
  saveData: boolean;
  effectiveType: string;
  deviceMemoryGb: number | null;
}

const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readJitsiMediaHints(nav: Navigator | null = typeof navigator !== "undefined" ? navigator : null): JitsiMediaHints {
  const navAny = nav as any;
  const connection = navAny?.connection || navAny?.mozConnection || navAny?.webkitConnection || {};
  const ua = String(navAny?.userAgent || "");
  return {
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(ua),
    saveData: Boolean(connection?.saveData),
    effectiveType: String(connection?.effectiveType || "").toLowerCase(),
    deviceMemoryGb: asFiniteNumber(navAny?.deviceMemory),
  };
}

function shouldConstrainVideo(hints: JitsiMediaHints): boolean {
  if (hints.saveData) return true;
  if (SLOW_EFFECTIVE_TYPES.has(hints.effectiveType)) return true;
  return hints.deviceMemoryGb !== null && hints.deviceMemoryGb <= 2;
}

function preferredVideoHeight(mode: JitsiCallMode, hints: JitsiMediaHints): number {
  if (mode === "audio") return 180;
  if (shouldConstrainVideo(hints)) return 360;
  return hints.mobile ? 480 : 720;
}

function standardVideoBitrate(height: number): number {
  if (height <= 180) return 150_000;
  if (height <= 360) return 450_000;
  if (height <= 480) return 900_000;
  return 1_500_000;
}

export function buildJitsiMediaPolicy(mode: JitsiCallMode, hints: JitsiMediaHints = readJitsiMediaHints()): Record<string, unknown> {
  const height = preferredVideoHeight(mode, hints);
  const standard = standardVideoBitrate(height);
  return {
    prejoinPageEnabled: false,
    prejoinConfig: {
      enabled: false,
    },
    disableDeepLinking: true,
    enableWelcomePage: false,
    requireDisplayName: false,
    disableInviteFunctions: true,
    notifications: [],
    hideConferenceSubject: true,
    hideConferenceTimer: true,
    disableModeratorIndicator: true,
    disablePolls: true,
    disableReactions: true,
    disableSelfViewSettings: true,
    disableShowMoreStats: true,
    disableThirdPartyRequests: true,
    startWithVideoMuted: mode === "audio",
    startWithAudioMuted: false,
    toolbarButtons: [],
    buttonsWithNotifyClick: [],
    constraints: {
      video: {
        height: {
          ideal: height,
          max: height,
        },
      },
    },
    videoQuality: {
      maxBitratesVideo: {
        low: Math.min(200_000, standard),
        standard,
        high: Math.max(standard, 900_000),
      },
    },
    maxFullResolutionParticipants: shouldConstrainVideo(hints) ? 1 : 2,
    enableLayerSuspension: true,
  };
}
