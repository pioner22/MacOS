export type EnvOs = "ios" | "android" | "windows" | "macos" | "linux" | "unknown";
export type EnvBrowser = "safari" | "chrome" | "edge" | "firefox" | "opera" | "samsung" | "yandex" | "unknown";
export type EnvEngine = "webkit" | "chromium" | "gecko" | "unknown";
export type EnvDevice = "mobile" | "tablet" | "desktop";
export type EnvDisplay = "browser" | "standalone" | "fullscreen";

export type EnvSnapshot = {
  os: EnvOs;
  browser: EnvBrowser;
  engine: EnvEngine;
  device: EnvDevice;
  display: EnvDisplay;
  touch: boolean;
  width: number;
  height: number;
};

export type EnvInput = {
  userAgent?: string;
  platform?: string;
  vendor?: string;
  maxTouchPoints?: number;
  brands?: string[];
  pointerCoarse?: boolean;
  hoverNone?: boolean;
  innerWidth?: number;
  innerHeight?: number;
  standalone?: boolean;
  fullscreen?: boolean;
  displayMode?: EnvDisplay;
};

function normalizeBrands(brands: string[] | undefined): string {
  if (!brands || !brands.length) return "";
  return brands.join(" ").toLowerCase();
}

export function detectEnvironment(input: EnvInput = {}): EnvSnapshot {
  const ua = String(input.userAgent || "");
  const uaLower = ua.toLowerCase();
  const platform = String(input.platform || "").toLowerCase();
  const vendor = String(input.vendor || "").toLowerCase();
  const maxTouchPoints = Number.isFinite(input.maxTouchPoints) ? Number(input.maxTouchPoints) : 0;
  const brands = normalizeBrands(input.brands);
  const pointerCoarse = Boolean(input.pointerCoarse);
  const hoverNone = Boolean(input.hoverNone);
  const width = Number.isFinite(input.innerWidth) ? Math.max(0, Math.trunc(input.innerWidth as number)) : 0;
  const height = Number.isFinite(input.innerHeight) ? Math.max(0, Math.trunc(input.innerHeight as number)) : 0;

  const isIPadOS = /macintosh/.test(uaLower) && maxTouchPoints > 1;
  const isIPad = /ipad/.test(uaLower) || isIPadOS;
  const isIPhone = /iphone|ipod/.test(uaLower);
  const isIOS = isIPad || isIPhone;
  const isAndroid = /android/.test(uaLower);
  const isWindows = /windows/.test(uaLower) || platform.includes("win");
  const isMac = /mac os x|macintosh/.test(uaLower) || platform.includes("mac");
  const isLinux = /linux/.test(uaLower) || platform.includes("linux");

  const os: EnvOs = isIOS
    ? "ios"
    : isAndroid
      ? "android"
      : isWindows
        ? "windows"
        : isMac
          ? "macos"
          : isLinux
            ? "linux"
            : "unknown";

  const isEdge = /edg|edge/.test(uaLower) || brands.includes("edge");
  const isSamsung = /samsungbrowser/.test(uaLower) || brands.includes("samsung");
  const isYandex = /yabrowser/.test(uaLower) || brands.includes("yandex");
  const isOpera = /opr|opera/.test(uaLower) || brands.includes("opera");
  const isFirefox = /firefox|fxios/.test(uaLower) || brands.includes("firefox");
  const isChrome = /chrome|crios/.test(uaLower) || brands.includes("chrome") || brands.includes("chromium");
  const isSafari =
    /safari/.test(uaLower) &&
    !/chrome|crios|edg|opr|samsungbrowser|yabrowser|fxios/.test(uaLower);

  const browser: EnvBrowser = isEdge
    ? "edge"
    : isSamsung
      ? "samsung"
      : isYandex
        ? "yandex"
        : isOpera
          ? "opera"
          : isFirefox
            ? "firefox"
            : isChrome
              ? "chrome"
              : isSafari
                ? "safari"
                : "unknown";

  let engine: EnvEngine =
    browser === "firefox"
      ? "gecko"
      : browser === "safari"
        ? "webkit"
        : ["chrome", "edge", "opera", "samsung", "yandex"].includes(browser)
          ? "chromium"
          : /applewebkit/.test(uaLower)
            ? "webkit"
            : /gecko/.test(uaLower)
              ? "gecko"
              : "unknown";

  if (os === "ios") engine = "webkit";

  const coarse = pointerCoarse || hoverNone;
  const isMobile =
    isIPhone ||
    (isAndroid && /mobile/.test(uaLower)) ||
    (coarse && width > 0 && width <= 600);
  const isTablet =
    isIPad ||
    (isAndroid && !/mobile/.test(uaLower)) ||
    (coarse && width > 600 && width <= 1024);
  const device: EnvDevice = isMobile ? "mobile" : isTablet ? "tablet" : "desktop";

  const display: EnvDisplay =
    input.displayMode ||
    (input.fullscreen ? "fullscreen" : input.standalone ? "standalone" : "browser");

  const touch = maxTouchPoints > 0 || coarse;

  return {
    os,
    browser,
    engine,
    device,
    display,
    touch,
    width,
    height,
  };
}

function replacePrefixedClass(root: HTMLElement, prefix: string, value: string) {
  const cls = root.classList;
  for (const name of Array.from(cls)) {
    if (name.startsWith(prefix)) cls.remove(name);
  }
  if (value) cls.add(`${prefix}${value}`);
}

function applyEnvironment(root: HTMLElement, env: EnvSnapshot) {
  root.dataset.envOs = env.os;
  root.dataset.envBrowser = env.browser;
  root.dataset.envEngine = env.engine;
  root.dataset.envDevice = env.device;
  root.dataset.envDisplay = env.display;
  root.dataset.envTouch = env.touch ? "1" : "0";

  replacePrefixedClass(root, "env-os-", env.os);
  replacePrefixedClass(root, "env-browser-", env.browser);
  replacePrefixedClass(root, "env-engine-", env.engine);
  replacePrefixedClass(root, "env-device-", env.device);
  replacePrefixedClass(root, "env-display-", env.display);

  root.classList.toggle("env-touch", env.touch);
}

function collectEnvInput(): EnvInput {
  if (typeof window === "undefined") return {};
  const uaData: any = (navigator as any)?.userAgentData;
  const brands = Array.isArray(uaData?.brands) ? uaData.brands.map((b: any) => String(b?.brand || "")).filter(Boolean) : [];
  const match = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  const pointerCoarse = Boolean(match?.("(pointer: coarse)")?.matches || match?.("(any-pointer: coarse)")?.matches);
  const hoverNone = Boolean(match?.("(hover: none)")?.matches || match?.("(any-hover: none)")?.matches);
  const standalone = Boolean(
    (navigator as any)?.standalone ||
      match?.("(display-mode: standalone)")?.matches
  );
  const fullscreen = Boolean(
    document.fullscreenElement ||
      match?.("(display-mode: fullscreen)")?.matches
  );
  const displayMode: EnvDisplay | undefined = fullscreen ? "fullscreen" : standalone ? "standalone" : "browser";
  return {
    userAgent: String(navigator?.userAgent || ""),
    platform: String((navigator as any)?.platform || ""),
    vendor: String((navigator as any)?.vendor || ""),
    maxTouchPoints: Number((navigator as any)?.maxTouchPoints || 0),
    brands,
    pointerCoarse,
    hoverNone,
    innerWidth: Number(window.innerWidth || 0),
    innerHeight: Number(window.innerHeight || 0),
    standalone,
    fullscreen,
    displayMode,
  };
}

export function installEnvironmentAgent(root?: HTMLElement): () => void {
  if (typeof window === "undefined") return () => {};
  const docEl = root?.ownerDocument?.documentElement || document.documentElement;
  let raf = 0;
  const update = () => {
    raf = 0;
    applyEnvironment(docEl, detectEnvironment(collectEnvInput()));
  };
  const schedule = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(update);
  };
  update();

  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.addEventListener("pageshow", schedule);
  window.addEventListener("focus", schedule);
  document.addEventListener("fullscreenchange", schedule);

  const match = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  const standaloneMq = match?.("(display-mode: standalone)") || null;
  const fullscreenMq = match?.("(display-mode: fullscreen)") || null;
  const listen = (mq: MediaQueryList | null) => {
    if (!mq) return () => {};
    const handler = () => schedule();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    if (typeof mq.addListener === "function") {
      mq.addListener(handler);
      return () => mq.removeListener(handler);
    }
    return () => {};
  };
  const unlistenStandalone = listen(standaloneMq);
  const unlistenFullscreen = listen(fullscreenMq);

  return () => {
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.removeEventListener("pageshow", schedule);
    window.removeEventListener("focus", schedule);
    document.removeEventListener("fullscreenchange", schedule);
    unlistenStandalone();
    unlistenFullscreen();
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
