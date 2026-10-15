import { getMeetBaseUrl } from "../../config/env";
import { safeUrl } from "../security/safeUrl";

export type CallMode = "audio" | "video";

function stripTrailingSlashes(value: string): string {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeDisplayName(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 72);
}

function buildMeetJoinUrlRaw(baseUrl: string, roomName: string, mode: CallMode, displayName?: string | null): string | null {
  const base = stripTrailingSlashes(baseUrl);
  const room = String(roomName || "").trim();
  if (!base || !room) return null;

  const name = normalizeDisplayName(displayName);
  const hash = new URLSearchParams();
  hash.set("config.disableDeepLinking", "true");
  hash.set("config.enableWelcomePage", "false");
  hash.set("config.requireDisplayName", "false");
  hash.set("config.prejoinPageEnabled", "false");
  hash.set("config.prejoinConfig.enabled", "false");
  hash.set("config.startWithAudioMuted", "false");
  hash.set("config.startWithVideoMuted", mode === "audio" ? "true" : "false");
  hash.set("config.disableInviteFunctions", "true");
  hash.set("config.notifications", "[]");
  hash.set("config.toolbarButtons", "[]");
  hash.set("config.buttonsWithNotifyClick", "[]");
  hash.set("config.hideConferenceSubject", "true");
  hash.set("config.hideConferenceTimer", "true");
  hash.set("config.disableModeratorIndicator", "true");
  hash.set("config.disablePolls", "true");
  hash.set("config.disableReactions", "true");
  hash.set("config.disableSelfViewSettings", "true");
  hash.set("config.disableShowMoreStats", "true");
  hash.set("config.disableThirdPartyRequests", "true");
  hash.set("interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS", "true");
  hash.set("interfaceConfig.MOBILE_APP_PROMO", "false");
  hash.set("interfaceConfig.SHOW_JITSI_WATERMARK", "false");
  hash.set("interfaceConfig.SHOW_BRAND_WATERMARK", "false");
  hash.set("interfaceConfig.SHOW_WATERMARK_FOR_GUESTS", "false");
  hash.set("interfaceConfig.VIDEO_QUALITY_LABEL_DISABLED", "true");
  hash.set("interfaceConfig.CONNECTION_INDICATOR_DISABLED", "true");
  if (name) {
    hash.set("config.defaultLocalDisplayName", name);
    hash.set("userInfo.displayName", name);
  }
  const hashText = hash.toString();
  const safeRoom = encodeURIComponent(room);
  return `${base}/${safeRoom}${hashText ? `#${hashText}` : ""}`;
}

export function buildMeetJoinUrl(roomName: string, mode: CallMode, displayName?: string | null): string | null {
  const baseUrl = getMeetBaseUrl();
  const raw = buildMeetJoinUrlRaw(baseUrl, roomName, mode, displayName);
  if (!raw) return null;
  const base = typeof location !== "undefined" ? location.href : "http://localhost/";
  return safeUrl(raw, { base, allowedProtocols: ["https:", "http:"] });
}
