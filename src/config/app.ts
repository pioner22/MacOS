export const APP_NAME = "Yagodka";
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
export const ANDROID_APP_VERSION_NAME =
  typeof __ANDROID_APP_VERSION_NAME__ === "string" ? __ANDROID_APP_VERSION_NAME__ : "";
export const ANDROID_APP_VERSION_CODE =
  typeof __ANDROID_APP_VERSION_CODE__ !== "undefined" && Number.isFinite(Number(__ANDROID_APP_VERSION_CODE__))
    ? Math.trunc(Number(__ANDROID_APP_VERSION_CODE__))
    : 0;
export const APP_MSG_MAX_LEN = 4000;
