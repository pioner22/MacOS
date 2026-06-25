import type { AppState } from "../../stores/types";

function cleanLabel(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 72);
}

export function resolveCallDisplayName(state: Pick<AppState, "selfId" | "authRememberedId" | "profiles" | "profileDraftDisplayName">): string {
  const selfId = cleanLabel(state.selfId);
  const profile = selfId ? state.profiles?.[selfId] : null;
  return cleanLabel(profile?.display_name) || cleanLabel(state.profileDraftDisplayName) || cleanLabel(profile?.handle) || selfId || cleanLabel(state.authRememberedId) || "Ягодка";
}
