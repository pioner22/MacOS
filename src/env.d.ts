/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __ANDROID_APP_VERSION_NAME__: string;
declare const __ANDROID_APP_VERSION_CODE__: number | string;

interface YagodkaDesktopBridge {
  config?: {
    gatewayUrl?: unknown;
    publicBaseUrl?: unknown;
    meetBaseUrl?: unknown;
  };
  features?: {
    touchId?: unknown;
    mediaPermissions?: unknown;
    desktopUpdates?: unknown;
  };
  getInfo?: () => Promise<unknown>;
  updates?: {
    getStatus?: () => Promise<unknown>;
    check?: () => Promise<unknown>;
    download?: () => Promise<unknown>;
    install?: () => Promise<unknown>;
    onStatus?: (callback: (status: unknown) => void) => (() => void) | void;
  };
  mediaPermissions?: {
    getStatus?: (kinds: Array<"camera" | "microphone">) => Promise<unknown>;
    request?: (kinds: Array<"camera" | "microphone">) => Promise<unknown>;
    openSettings?: (kind: "camera" | "microphone") => Promise<unknown>;
  };
  saveSessionToken?: (token: string) => Promise<{ ok?: boolean; reason?: string }>;
  hasSessionToken?: () => Promise<{ ok?: boolean; available?: boolean; touchId?: boolean }>;
  unlockSession?: (reason: string) => Promise<{ ok?: boolean; token?: string; reason?: string }>;
  clearSessionToken?: () => Promise<{ ok?: boolean }>;
  setUnreadCount?: (count: number) => void;
}

interface YagodkaNativeBridge {
  config?: {
    gatewayUrl?: unknown;
    publicBaseUrl?: unknown;
    meetBaseUrl?: unknown;
  };
}

interface Window {
  yagodkaDesktop?: YagodkaDesktopBridge;
  yagodkaNative?: YagodkaNativeBridge;
  Capacitor?: {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
  };
}
