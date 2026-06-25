import { ANDROID_APP_VERSION_CODE, ANDROID_APP_VERSION_NAME } from "../../config/app";

export interface AndroidAppVersionInfo {
  versionName: string;
  versionCode: number | null;
}

export function parseAndroidAppVersionCode(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

export function getCurrentAndroidAppVersionInfo(): AndroidAppVersionInfo {
  return {
    versionName: String(ANDROID_APP_VERSION_NAME || "").trim(),
    versionCode: parseAndroidAppVersionCode(ANDROID_APP_VERSION_CODE),
  };
}
