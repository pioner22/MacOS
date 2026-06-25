import { splitBuildId } from "../version/buildId";

export function shouldReloadForBuild(appVersion: unknown, buildId: unknown): boolean {
  const current = splitBuildId(appVersion);
  const next = splitBuildId(buildId);
  if (!current.version || !next.version) return false;
  if (current.version !== next.version) return true;
  if (current.build && next.build && current.build !== next.build) return true;
  return false;
}
